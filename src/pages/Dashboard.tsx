import { useEffect, useMemo } from 'react';
import { useVideos } from '../hooks/useVideos';
import { ErrorView, LoadingPanel } from '../components/StatusView';
import { summarizeList } from '../lib/stats';
import { formatCount } from '../lib/format';
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

const percent = (value: number | null) =>
  value === null ? '정보 없음' : `${Math.round(value * 100)}%`;

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

/** 현재 YouTube 인기 목록을 공용 통계로 요약한다. 모든 수치는 lib/stats 결과만 사용한다. */
export default function Dashboard({ resolveCategoryNames }: Props) {
  const { state, reload } = useVideos(POPULAR_QUERY);
  const videos = state.status === 'success' ? state.videos : undefined;
  const now = state.status === 'success' ? state.fetchedAt : 0;
  const summary = useMemo(() => (videos ? summarizeList(videos, now) : null), [videos, now]);
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
      )}
    </div>
  );
}
