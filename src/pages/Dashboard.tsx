import { type ReactNode, useEffect, useId, useMemo } from 'react';
import { useVideos } from '../hooks/useVideos';
import { ErrorView, LoadingPanel } from '../components/StatusView';
import {
  aggregateKeywords,
  categoryDistribution,
  summarizeList,
  topBy,
  viewsPerHour,
} from '../lib/stats';
import { formatCount, formatRelativeDate } from '../lib/format';
import type { ChatTarget } from '../lib/chat-session';
import type { Video } from '../types/video';

const POPULAR_QUERY = { q: '', categoryId: '', order: '' } as const;

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

/** 위젯 공통 틀: 제목과 계산 기준을 함께 보여준다. */
function DashCard({
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
    <section className={`dash-card ${className}`} aria-labelledby={id}>
      <header>
        <h2 id={id}>{title}</h2>
        <p>{basis}</p>
      </header>
      {children}
    </section>
  );
}

/** 막대 길이는 같은 위젯 안 최댓값 대비 비율이다. */
function BarRow({
  label,
  value,
  max,
  valueLabel,
  onClick,
  actionLabel,
}: {
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

/** 썸네일·제목과 수치 한 줄로 된 순위 목록. 누르면 영상 상세를 연다. */
function VideoRankList({
  entries,
  metric,
  onSelect,
}: {
  entries: { item: Video; score: number }[];
  metric: (entry: { item: Video; score: number }) => string;
  onSelect: (video: Video) => void;
}) {
  return (
    <ol className="rank-list">
      {entries.map((entry, index) => (
        <li key={entry.item.id}>
          <button
            type="button"
            className="rank-row"
            onClick={() => onSelect(entry.item)}
            aria-label={`${index + 1}위 ${entry.item.title} 상세 보기, ${metric(entry)}`}
          >
            <span className="rank-number" aria-hidden="true">
              {index + 1}
            </span>
            <img src={entry.item.thumbnailUrl} alt="" loading="lazy" />
            <span className="rank-text">
              <span className="rank-title">{entry.item.title}</span>
              <span className="rank-metric">{metric(entry)}</span>
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
}: Props) {
  const { state, reload } = useVideos(POPULAR_QUERY);
  const videos = state.status === 'success' ? state.videos : undefined;
  const now = state.status === 'success' ? state.fetchedAt : 0;
  const summary = useMemo(() => (videos ? summarizeList(videos, now) : null), [videos, now]);
  const keywords = useMemo(() => (videos ? aggregateKeywords(videos) : []), [videos]);
  const categories = useMemo(
    () => (videos ? categoryDistribution(videos, (video) => video.categoryId) : []),
    [videos],
  );
  const fastest = useMemo(
    () => (videos ? topBy(videos, (video) => viewsPerHour(video, now), 5) : []),
    [videos, now],
  );
  useEffect(() => {
    if (videos) resolveCategoryNames(videos.map((video) => video.categoryId));
  }, [videos, resolveCategoryNames]);

  return (
    <div className="dashboard flex flex-col gap-6">
      <header className="page-heading">
        <h1>대시보드</h1>
        <p className="dash-scope">
          {videos
            ? `현재 YouTube 인기 목록 ${videos.length}개 기준 · ${new Date(now).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 조회`
            : '현재 YouTube 인기 목록 기준'}
        </p>
      </header>
      {state.status === 'loading' && <LoadingPanel label="대시보드를 불러오는 중" />}
      {state.status === 'error' && (
        <ErrorView title="인기 목록을 불러오지 못했습니다" error={state.error} onRetry={reload} />
      )}
      {summary && videos && (
        <>
          <dl className="dash-stats" aria-label="인기 목록 요약">
            <StatTile
              label="인기 영상"
              value={`${summary.count}개`}
              note="YouTube API 제공 인기 목록"
            />
            <StatTile
              label="24시간 내 업로드"
              value={percent(summary.recentShare)}
              note={`${summary.count}개 중 업로드 후 24시간 미만`}
            />
            <StatTile
              label="중앙값 조회수"
              value={summary.medianViews === null ? '정보 없음' : formatCount(summary.medianViews)}
              note="조회수 비공개 영상 제외"
            />
            <StatTile
              label="쇼츠 비율"
              value={percent(summary.shortsShare)}
              note="3분 이하 영상 기준"
            />
          </dl>
          <div className="dash-grid">
            <DashCard
              title="지금 뜨는 소재"
              basis="태그·제목 단어가 등장한 채널 수 · 2곳 이상, 상위 10개 · 누르면 영상 검색"
              className="dash-keywords"
            >
              {keywords.length ? (
                <ol className="bar-list">
                  {keywords.map(({ keyword, channels }) => (
                    <BarRow
                      key={keyword}
                      label={keyword}
                      value={channels}
                      max={keywords[0].channels}
                      valueLabel={`채널 ${channels}곳`}
                      onClick={() => onSearchKeyword(keyword)}
                      actionLabel={`${keyword} 영상 검색 (현재 목록의 채널 ${channels}곳에 등장)`}
                    />
                  ))}
                </ol>
              ) : (
                <p className="dash-empty">2개 이상 채널에 공통으로 나온 키워드가 없습니다.</p>
              )}
            </DashCard>
            <DashCard
              title="빠르게 조회수를 모으는 영상 Top 5"
              basis="업로드 후 시간당 조회수 = 누적 조회수 ÷ 업로드 후 경과 시간(최소 1시간)"
            >
              {fastest.length ? (
                <VideoRankList
                  entries={fastest}
                  onSelect={onSelect}
                  metric={({ item, score }) =>
                    `업로드 후 시간당 조회수 ${formatCount(Math.round(score))} · ${formatRelativeDate(item.publishedAt, new Date(now))} 업로드`
                  }
                />
              ) : (
                <p className="dash-empty">조회수가 공개된 영상이 없습니다.</p>
              )}
            </DashCard>
            <DashCard
              title="카테고리 분포"
              basis="막대는 영상 수 · 조회수 비중은 목록 전체 조회수 합계 대비"
              className="dash-categories"
            >
              <ol className="bar-list">
                {categories.map(({ key, count, viewShare }) => (
                  <BarRow
                    key={key}
                    label={categoryNames.get(key) ?? '카테고리 정보 없음'}
                    value={count}
                    max={categories[0].count}
                    valueLabel={`${count}개 · 조회수 ${percent(viewShare)}`}
                  />
                ))}
              </ol>
            </DashCard>
          </div>
        </>
      )}
    </div>
  );
}
