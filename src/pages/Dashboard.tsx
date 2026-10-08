import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { POPULAR_CACHE_MS } from '../hooks/useVideos';
import { useApiResource } from '../hooks/useApiResource';
import { ErrorView, LoadingPanel } from '../components/StatusView';
import {
  aggregateKeywords,
  categoryDistribution,
  ENGAGEMENT_MIN_VIEWS,
  engagementRate,
  formatSplit,
  summarizeList,
  topBy,
  viewsPerHour,
} from '../lib/stats';
import { formatCount, formatRelativeDate } from '../lib/format';
import { popularChartTarget, type ChatTarget } from '../lib/chat-session';
import type { Video, VideosResponse } from '../types/video';

/** 전체 인기 차트를 pageToken으로 끝까지 수집한 목록. 카테고리 탭은 이 목록 안에서만 거른다. */
export const CHART_PATH = '/api/videos?chart=popular&all=1';
/** 이 개수 미만이면 비율·순위 해석에 주의 문구를 붙인다. */
const SMALL_SAMPLE = 10;

interface Props {
  categoryNames: ReadonlyMap<string, string>;
  resolveCategoryNames: (ids: readonly string[]) => void;
  onSelect: (video: Video) => void;
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

/** 구역 공통 틀: 상자 없이 제목과 계산 기준을 한 줄에 둔다. */
function DashSection({
  title,
  basis,
  children,
  className = '',
}: {
  title: string;
  basis: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={`dash-section ${className}`} aria-labelledby={id}>
      <header>
        <h2 id={id}>{title}</h2>
        <p>{basis}</p>
      </header>
      {children}
    </section>
  );
}

/** 막대 길이는 같은 구역 안 최댓값 대비 비율이다. 첫 행만 강조색을 쓴다. */
function BarRow({
  rank,
  label,
  value,
  max,
  valueLabel,
  onClick,
  actionLabel,
}: {
  rank: number;
  label: string;
  value: number;
  max: number;
  valueLabel: string;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const width = max > 0 ? Math.max((value / max) * 100, 2) : 0;
  const content = (
    <>
      <span className="bar-rank" aria-hidden="true">
        {rank}
      </span>
      <span className="bar-label">{label}</span>
      <span className="bar-track" aria-hidden="true">
        <span className="bar-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="bar-value">{valueLabel}</span>
    </>
  );
  return (
    <li>
      {onClick ? (
        <button type="button" className="bar-row" onClick={onClick} aria-label={actionLabel}>
          {content}
        </button>
      ) : (
        <div className="bar-row">{content}</div>
      )}
    </li>
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

/** 쇼츠·롱폼 영상 수 비율 막대와 그룹별 중앙값 조회수 */
function FormatSplitView({ split }: { split: ReturnType<typeof formatSplit> }) {
  const groups = [
    { name: '쇼츠', range: '3분 이하', ...split.shorts },
    { name: '롱폼', range: '3분 초과', ...split.long },
  ];
  return (
    <>
      {split.shorts.share !== null && (
        <div className="split-bar" aria-hidden="true">
          <span style={{ width: `${split.shorts.share * 100}%` }} />
        </div>
      )}
      <dl className="split-groups">
        {groups.map((group) => (
          <div key={group.name}>
            <dt>
              {group.name} <span>{group.range}</span>
            </dt>
            <dd>
              <span className="split-count">{group.count}개</span>
              <span className="split-median">
                {percent(group.share)} · 중앙값{' '}
                {group.medianViews === null ? '정보 없음' : formatCount(group.medianViews)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {split.unknown > 0 && (
        <p className="dash-empty">길이를 알 수 없는 영상 {split.unknown}개는 제외했습니다.</p>
      )}
    </>
  );
}

/** 카테고리 분포: 영상 수 누적 막대와 범례 목록. 4번째 이후는 같은 회색으로 묶는다. */
function CategoryView({
  categories,
  names,
  activeTab,
  onSelectTab,
}: {
  categories: ReturnType<typeof categoryDistribution>;
  names: ReadonlyMap<string, string>;
  activeTab: string;
  onSelectTab: (id: string) => void;
}) {
  const nameOf = (key: string) => names.get(key) ?? '카테고리 정보 없음';
  return (
    <>
      <div className="stack-bar" aria-hidden="true">
        {categories.map(({ key, count }, index) => (
          <span key={key} className={`tone-${Math.min(index, 3)}`} style={{ flexGrow: count }} />
        ))}
      </div>
      <ol className="legend-list">
        {categories.map(({ key, count, viewShare }, index) => {
          const content = (
            <>
              <span className={`legend-swatch tone-${Math.min(index, 3)}`} aria-hidden="true" />
              <span className="legend-name">{nameOf(key)}</span>
              <span className="legend-count">{count}개</span>
              <span className="legend-share">조회수 {percent(viewShare)}</span>
            </>
          );
          return (
            <li key={key}>
              {activeTab === key ? (
                <div className="legend-row">{content}</div>
              ) : (
                <button
                  type="button"
                  className="legend-row"
                  onClick={() => onSelectTab(key)}
                  aria-label={`${nameOf(key)} 인기 목록 탭으로 보기 (영상 ${count}개, 조회수 비중 ${percent(viewShare)})`}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** 현재 YouTube 인기 목록을 공용 통계로 요약한다. 모든 수치는 lib/stats 결과만 사용한다. */
export default function Dashboard({
  categoryNames,
  resolveCategoryNames,
  onSearchKeyword,
  onSelect,
  onAnalyze,
}: Props) {
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
  const split = useMemo(() => (videos ? formatSplit(videos) : null), [videos]);
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

  return (
    <div className="dashboard">
      <header className="page-heading dash-heading">
        <div>
          <h1>대시보드</h1>
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
          이 데이터로 AI 질문
        </button>
      </header>
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
                summary.count < SMALL_SAMPLE ? '표본이 적어 해석에 주의' : 'YouTube API 인기 차트'
              }
            />
            <StatTile
              label="24시간 내 업로드"
              value={percent(summary.recentShare)}
              note="업로드 후 24시간 미만"
            />
            <StatTile
              label="조회수 중앙값"
              value={summary.medianViews === null ? '정보 없음' : formatCount(summary.medianViews)}
              note="조회수 비공개 제외"
            />
            <StatTile label="쇼츠 비율" value={percent(summary.shortsShare)} note="3분 이하 기준" />
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
                <ol className="bar-list">
                  {keywords.map(({ keyword, videos: count }, index) => (
                    <BarRow
                      key={keyword}
                      rank={index + 1}
                      label={keyword}
                      value={count}
                      max={keywords[0].videos}
                      valueLabel={String(count)}
                      onClick={() => onSearchKeyword(keyword)}
                      actionLabel={`${keyword} 영상 검색 (현재 목록의 영상 ${count}개에 등장)`}
                    />
                  ))}
                </ol>
              ) : (
                <p className="dash-empty">2개 이상 영상에 나온 키워드가 없습니다.</p>
              )}
            </DashSection>
          </div>
          <div className="dash-detail">
            <DashSection
              title="카테고리 분포"
              basis="영상 수 · 조회수 비중 · 누르면 탭 이동"
              className="dash-categories"
            >
              <CategoryView
                categories={categories}
                names={categoryNames}
                activeTab={activeTab}
                onSelectTab={selectTab}
              />
            </DashSection>
            {split && (
              <DashSection
                title="쇼츠 / 롱폼"
                basis="길이 3분 기준 · API에 쇼츠 구분 없음"
                className="dash-split"
              >
                <FormatSplitView split={split} />
              </DashSection>
            )}
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
    </div>
  );
}
