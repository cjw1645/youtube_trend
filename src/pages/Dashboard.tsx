import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { DashboardIcon } from '@radix-ui/react-icons';
import { CHART_PATH, POPULAR_CACHE_MS } from '../hooks/useVideos';
import { useApiResource } from '../hooks/useApiResource';
import { ErrorView, LoadingPanel } from '../components/StatusView';
import DashSection from '../components/DashSection';
import Spotlight from '../components/Spotlight';
import WordCloud from '../components/WordCloud';
import StoredTrendSection from '../components/StoredTrendSection';
import SearchTabs from '../components/SearchTabs';
import AddSearchPopover, { MAX_SLOTS } from '../components/AddSearchPopover';
import SearchDashboard from '../components/SearchDashboard';
import { useSearchSlots } from '../hooks/useSearchSlots';
import { useAuth } from '../hooks/useAuth';
import {
  aggregateKeywords,
  categoryDistribution,
  ENGAGEMENT_MIN_VIEWS,
  engagementRate,
  summarizeList,
  topBy,
  viewsPerHour,
} from '../lib/stats';
import { formatCount, formatRelativeDate } from '../lib/format';
import { popularChartTarget, type ChatTarget } from '../lib/chat-session';
import type { Video, VideosResponse } from '../types/video';
import type { StoredVideo } from '../types/trend';

/** 이 개수 미만이면 비율·순위 해석에 주의 문구를 붙인다. */
const SMALL_SAMPLE = 10;
const POPULAR_OPEN_KEY = 'youtube-trend:popular-dash-open';

interface Props {
  categoryNames: ReadonlyMap<string, string>;
  resolveCategoryNames: (ids: readonly string[]) => void;
  onSelect: (video: Video) => void;
  onOpenVideo: (videoId: string) => void;
  onImport: (videos: readonly StoredVideo[]) => 'set' | 'kept';
  onImportSearch: (videos: readonly StoredVideo[], label: string, slot: 1 | 2) => 'set' | 'kept';
  onSearchKeyword: (keyword: string) => void;
  onAnalyze: (target: ChatTarget) => void;
}

/** 0–1 비율을 정수 %로. 0보다 크지만 반올림하면 0이 되는 값은 「1% 미만」으로 구분한다. */
const percent = (value: number | null) => {
  if (value === null) return '정보 없음';
  if (value > 0 && value < 0.005) return '1% 미만';
  return `${Math.round(value * 100)}%`;
};

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stat-tile">
      <dt>{label}</dt>
      <dd>
        <span className="stat-value">{value}</span>
        <span className="stat-note">{note}</span>
      </dd>
    </div>
  );
}

interface RankEntry {
  item: Video;
  score: number;
}

/**
 * 썸네일·제목과 오른쪽 수치로 된 순위 목록. 누르면 영상 상세를 연다.
 * lead를 켜면 1위를 큰 썸네일로 보여준다.
 */
function VideoRankList({
  entries,
  value,
  unit,
  meta,
  describe,
  onSelect,
  lead = false,
}: {
  entries: RankEntry[];
  value: (entry: RankEntry) => string;
  unit?: string;
  meta: (entry: RankEntry) => string;
  describe: (entry: RankEntry) => string;
  onSelect: (video: Video) => void;
  lead?: boolean;
}) {
  return (
    <ol className={`rank-list${lead ? ' has-lead' : ''}`}>
      {entries.map((entry, index) => (
        <li key={entry.item.id}>
          <button
            type="button"
            className="rank-row"
            onClick={() => onSelect(entry.item)}
            aria-label={`${index + 1}위 ${entry.item.title} 상세 보기, ${describe(entry)}`}
          >
            <img src={entry.item.thumbnailUrl} alt="" loading="lazy" />
            <span className="rank-number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="rank-text">
              <span className="rank-title">{entry.item.title}</span>
              <span className="rank-meta">{meta(entry)}</span>
            </span>
            <span className="rank-value" aria-hidden="true">
              <strong>{value(entry)}</strong>
              {unit && <small>{unit}</small>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** 현재 YouTube 인기 목록을 공용 통계로 요약한다. 모든 수치는 lib/stats 결과만 사용한다. */
export default function Dashboard({
  categoryNames,
  resolveCategoryNames,
  onSearchKeyword,
  onSelect,
  onOpenVideo,
  onImport,
  onImportSearch,
  onAnalyze,
}: Props) {
  const auth = useAuth();
  const search = useSearchSlots();
  const [searchSlot, setSearchSlot] = useState<1 | 2 | null>(null);
  const selectedSearch = search.slots.find((item) => item.slot === searchSlot);
  // 등록한 검색어가 있으면 첫 번째를 한 번 자동으로 열어 둔다(사용자가 고른 뒤에는 건드리지 않는다).
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || !search.slots.length) return;
    autoSelected.current = true;
    setSearchSlot(search.slots[0].slot);
  }, [search.slots]);
  // 공통 인기 대시보드는 옵션 패널이다. 사용자가 고른 상태를 기억하고, 고른 적이 없으면 로그아웃 상태에서만 열어 둔다.
  const [popularChoice, setPopularChoice] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem(POPULAR_OPEN_KEY);
      return saved === null ? null : saved === '1';
    } catch {
      return null;
    }
  });
  const popularOpen = popularChoice ?? (!auth.loading && !auth.user);
  const togglePopular = () => {
    const next = !popularOpen;
    setPopularChoice(next);
    try {
      localStorage.setItem(POPULAR_OPEN_KEY, next ? '1' : '0');
    } catch {
      /* 저장하지 못해도 이번 화면에서는 동작한다 */
    }
  };
  const popularId = useId();
  const chart = useApiResource<VideosResponse>(CHART_PATH, { cacheMs: POPULAR_CACHE_MS });
  const [tab, setTab] = useState('');
  const chartVideos = chart.state.status === 'success' ? chart.state.data.items : undefined;
  const now = chart.state.status === 'success' ? chart.state.receivedAt : 0;
  // 수집한 목록의 카테고리 분포에 실제로 있는 카테고리만 영상 수 순으로 탭을 만든다.
  const tabs = useMemo(
    () =>
      chartVideos
        ? categoryDistribution(chartVideos, (video) => video.categoryId).map(({ key, count }) => ({
            id: key,
            count,
          }))
        : [],
    [chartVideos],
  );
  const activeTab = tabs.some(({ id }) => id === tab) ? tab : '';
  // 추가 API 호출 없이 전체 차트 순서(popularRank)를 유지한 채 걸러낸다.
  const videos = useMemo(
    () =>
      chartVideos && activeTab
        ? chartVideos.filter((video) => video.categoryId === activeTab)
        : chartVideos,
    [chartVideos, activeTab],
  );
  const reload = chart.reload;
  const tabsId = useId();
  const tabName = activeTab ? (categoryNames.get(activeTab) ?? '카테고리 정보 없음') : '';
  const selectTab = (id: string) => {
    setTab(id);
    document.getElementById(tabsId)?.scrollIntoView({ block: 'nearest' });
  };
  const summary = useMemo(() => (videos ? summarizeList(videos, now) : null), [videos, now]);
  const keywords = useMemo(() => (videos ? aggregateKeywords(videos) : []), [videos]);
  const categories = useMemo(
    () => (videos ? categoryDistribution(videos, (video) => video.categoryId) : []),
    [videos],
  );
  const engaged = useMemo(() => (videos ? topBy(videos, engagementRate, 5) : []), [videos]);
  const fastest = useMemo(
    () => (videos ? topBy(videos, (video) => viewsPerHour(video, now), 5) : []),
    [videos, now],
  );
  useEffect(() => {
    if (chartVideos) resolveCategoryNames(chartVideos.map((video) => video.categoryId));
  }, [chartVideos, resolveCategoryNames]);
  const scope = tabName
    ? `YouTube 인기 차트 ${chartVideos?.length ?? 0}개 중 ${tabName} ${videos?.length ?? 0}개 기준`
    : `YouTube 인기 차트 ${chartVideos?.length ?? 0}개 기준`;

  const timeLabel = new Date(now).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const relative = (iso: string) => formatRelativeDate(iso, new Date(now));

  const emptyText = auth.user
    ? '아직 추가한 검색어가 없습니다. 위의 「검색어 추가」로 시작해 보세요.'
    : auth.enabled
      ? '로그인하고 검색어를 추가하면 이 자리에 검색어별 대시보드가 생깁니다.'
      : '로그인 기능이 설정되지 않아 검색어를 추가할 수 없습니다.';

  return (
    <div className="dashboard">
      <header className="page-heading dash-hero">
        <div>
          <h1>내 검색어로 트렌드 추적</h1>
          <p>
            검색어를 추가하면 매일 YouTube 검색 결과 200개를 저장해 변화를 보여줍니다. 최대{' '}
            {MAX_SLOTS}개.
          </p>
        </div>
        <div className="dash-hero-actions">
          <AddSearchPopover
            full={search.slots.length >= MAX_SLOTS}
            busy={search.busy}
            onAdd={search.add}
            onAdded={setSearchSlot}
          />
          <button
            type="button"
            className={`ghost-button${popularOpen ? ' is-open' : ''}`}
            aria-expanded={popularOpen}
            aria-controls={popularId}
            onClick={togglePopular}
          >
            <DashboardIcon aria-hidden="true" /> 인기 차트 대시보드
          </button>
        </div>
      </header>
      <SearchTabs
        slots={search.slots}
        selected={selectedSearch ? searchSlot : null}
        busy={search.busy}
        message={search.message ?? search.error}
        emptyText={emptyText}
        onSelect={setSearchSlot}
        onRemove={(slot) => {
          if (searchSlot === slot) setSearchSlot(null);
          void search.remove(slot);
        }}
      />
      {selectedSearch && (
        <SearchDashboard
          key={`${selectedSearch.slot}:${selectedSearch.conditions.query}`}
          view={selectedSearch}
          call={search.call}
          categoryNames={categoryNames}
          resolveCategoryNames={resolveCategoryNames}
          onOpenVideo={onOpenVideo}
          onSearchKeyword={onSearchKeyword}
          onImport={onImportSearch}
        />
      )}
      {popularOpen && (
        <div id={popularId} className="popular-dash">
          <header className="popular-dash-head">
            <div>
              <h2>인기 차트 대시보드</h2>
              <p className="dash-scope">
                {videos ? `${scope} · ${timeLabel} 조회` : 'YouTube 인기 차트 기준'}
              </p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={!videos?.length}
              onClick={() => {
                if (!videos) return;
                // 현재 탭 목록의 앞 20개를 전체 차트 순위(popularRank)와 함께 전달한다.
                onAnalyze(popularChartTarget(videos, `대시보드 · ${scope}`, now));
              }}
            >
              상위 20개로 AI 질문
            </button>
          </header>
          {summary && videos && (
            <Spotlight
              title="지금 가장 눈에 띄는 것"
              basis={`${scope} · 현재 인기 차트 기준`}
              video={
                fastest[0]
                  ? {
                      id: fastest[0].item.id,
                      title: fastest[0].item.title,
                      thumbnail: fastest[0].item.thumbnailUrl,
                      channel: fastest[0].item.channelTitle,
                      metric: `시간당 조회 ${formatCount(Math.round(fastest[0].score))}`,
                      note: `${relative(fastest[0].item.publishedAt)} 업로드 · 조회수 증가 속도 1위`,
                    }
                  : null
              }
              tag={
                keywords[0]
                  ? {
                      label: `#${keywords[0].keyword}`,
                      metric: `${keywords[0].videos}개 영상`,
                      note: `현재 인기 목록 ${videos.length}개 중 이 태그·제목이 가장 많이 나왔어요`,
                      onClick: () => onSearchKeyword(keywords[0].keyword),
                    }
                  : null
              }
              field={
                categories[0]
                  ? {
                      label: categoryNames.get(categories[0].key) ?? '카테고리 정보 없음',
                      metric: percent(categories[0].share),
                      note: `인기 목록 ${videos.length}개 중 ${categories[0].count}개가 이 분야예요`,
                    }
                  : null
              }
              onOpenVideo={onOpenVideo}
            />
          )}
          {tabs.length > 0 && (
            <nav id={tabsId} className="dash-tabs" aria-label="카테고리별 인기 차트">
              {[{ id: '', count: chartVideos?.length ?? 0 }, ...tabs].map(({ id, count }) => (
                <button
                  key={id || 'all'}
                  type="button"
                  aria-pressed={activeTab === id}
                  onClick={() => selectTab(id)}
                >
                  {id ? (categoryNames.get(id) ?? '카테고리 정보 없음') : '전체'}
                  <span>{count}</span>
                </button>
              ))}
            </nav>
          )}
          {chart.state.status === 'loading' && <LoadingPanel label="대시보드를 불러오는 중" />}
          {chart.state.status === 'error' && (
            <ErrorView
              title="인기 목록을 불러오지 못했습니다"
              error={chart.state.error}
              onRetry={reload}
            />
          )}
          {summary && videos && (
            <>
              <dl className="dash-stats" aria-label="인기 목록 요약">
                <StatTile
                  label="인기 영상"
                  value={`${summary.count}개`}
                  note={
                    summary.count < SMALL_SAMPLE
                      ? '표본이 적어 해석에 주의'
                      : 'YouTube API 인기 차트'
                  }
                />
                <StatTile
                  label="24시간 내 업로드"
                  value={percent(summary.recentShare)}
                  note="업로드 후 24시간 미만"
                />
                <StatTile
                  label="조회수 중앙값"
                  value={
                    summary.medianViews === null ? '정보 없음' : formatCount(summary.medianViews)
                  }
                  note="조회수 비공개 제외"
                />
              </dl>
              <div className="dash-lead">
                <DashSection
                  title="빠르게 조회수를 모으는 영상"
                  basis="업로드 후 시간당 조회수 · 누적 ÷ 경과 시간(최소 1시간)"
                  className="dash-fastest"
                >
                  {fastest.length ? (
                    <VideoRankList
                      lead
                      entries={fastest}
                      onSelect={onSelect}
                      value={({ score }) => formatCount(Math.round(score))}
                      unit="시간당"
                      meta={({ item }) => `${item.channelTitle} · ${relative(item.publishedAt)}`}
                      describe={({ item, score }) =>
                        `업로드 후 시간당 조회수 ${formatCount(Math.round(score))} · ${relative(item.publishedAt)} 업로드`
                      }
                    />
                  ) : (
                    <p className="dash-empty">조회수가 공개된 영상이 없습니다.</p>
                  )}
                </DashSection>
                <DashSection
                  title="지금 뜨는 소재"
                  basis="태그·제목에 등장한 영상 수 · 누르면 검색"
                  className="dash-keywords"
                >
                  {keywords.length ? (
                    <WordCloud
                      words={keywords.map(({ keyword, videos: count }) => ({
                        key: keyword,
                        label: keyword,
                        weight: count,
                        title: `${keyword} · 현재 목록의 영상 ${count}개에 등장 · 누르면 검색`,
                      }))}
                      selected={null}
                      onSelect={onSearchKeyword}
                    />
                  ) : (
                    <p className="dash-empty">2개 이상 영상에 나온 키워드가 없습니다.</p>
                  )}
                </DashSection>
              </div>
              <div className="dash-detail">
                <DashSection
                  title="참여율 Top 5"
                  basis={`(좋아요+댓글) ÷ 조회수 · 조회수 ${ENGAGEMENT_MIN_VIEWS.toLocaleString('ko-KR')} 미만 제외`}
                  className="dash-engagement"
                >
                  {engaged.length ? (
                    <VideoRankList
                      entries={engaged}
                      onSelect={onSelect}
                      value={({ score }) => `${score.toFixed(1)}%`}
                      meta={({ item }) =>
                        `좋아요 ${formatCount(item.likeCount)} · 댓글 ${formatCount(item.commentCount)}`
                      }
                      describe={({ item, score }) =>
                        `참여율 ${score.toFixed(2)}% · 좋아요 ${formatCount(item.likeCount)} · 댓글 ${formatCount(item.commentCount)} · 조회수 ${formatCount(item.viewCount)}`
                      }
                    />
                  ) : (
                    <p className="dash-empty">기준을 만족하는 영상이 없습니다.</p>
                  )}
                </DashSection>
              </div>
            </>
          )}
          <StoredTrendSection
            categoryNames={categoryNames}
            resolveCategoryNames={resolveCategoryNames}
            onOpenVideo={onOpenVideo}
            onSearchKeyword={onSearchKeyword}
            onImport={onImport}
          />
        </div>
      )}
    </div>
  );
}
