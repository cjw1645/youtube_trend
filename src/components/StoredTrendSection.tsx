import { useEffect } from 'react';
import { useApiResource } from '../hooks/useApiResource';
import { ErrorView } from './StatusView';
import TrendPanel from './TrendPanel';
import type { PopularSnapshotResponse, StoredVideo, TrendResult } from '../types/trend';

const CACHE_MS = 5 * 60_000;

/** 마지막 완료 수집으로부터 지난 시간. 1시간 미만은 분으로 표시한다. */
const lagText = (minutes: number) =>
  minutes < 60 ? `${Math.max(minutes, 1)}분 전` : `${Math.round(minutes / 60)}시간 전`;

interface Props {
  categoryNames: ReadonlyMap<string, string>;
  resolveCategoryNames: (ids: readonly string[]) => void;
  onOpenVideo: (videoId: string) => void;
  onSearchKeyword: (keyword: string) => void;
  onImport: (videos: readonly StoredVideo[]) => 'set' | 'kept';
}

/** 서버가 저장한 공통 인기 목록 수집 기록으로 계산한 변화. 위쪽의 실시간 인기 목록과 별개의 원천이다. */
export default function StoredTrendSection({
  categoryNames,
  resolveCategoryNames,
  onOpenVideo,
  onSearchKeyword,
  onImport,
}: Props) {
  const trend = useApiResource<{ trend: TrendResult | null }>('/api/trend', { cacheMs: CACHE_MS });
  const snapshot = useApiResource<PopularSnapshotResponse>('/api/snapshot', {
    cacheMs: CACHE_MS,
  });
  const result = trend.state.status === 'success' ? trend.state.data.trend : null;
  useEffect(() => {
    if (result) resolveCategoryNames(result.current.categories.map((row) => row.categoryId));
  }, [result, resolveCategoryNames]);

  const data = snapshot.state.status === 'success' ? snapshot.state.data : null;
  const attempt = data?.last_attempt;
  const failedLast = !!attempt && attempt.status !== 'complete' && attempt.status !== 'running';

  return (
    <section className="stored-trend" aria-labelledby="stored-trend-title">
      <header className="stored-trend-head">
        <h2 id="stored-trend-title">수집 기록으로 본 변화</h2>
        <p>서버가 매시간 저장한 한국 인기 목록(API 반환 최대 200개)끼리 비교합니다</p>
      </header>
      {trend.state.status === 'loading' && (
        <p role="status" className="dash-empty">
          저장된 수집 기록을 불러오는 중…
        </p>
      )}
      {trend.state.status === 'error' && (
        <ErrorView
          compact
          title="수집 기록을 불러오지 못했습니다"
          error={trend.state.error}
          onRetry={trend.reload}
        />
      )}
      {trend.state.status === 'success' && !result && (
        <p role="status" className="dash-empty">
          아직 저장된 수집 목록이 없습니다. 수집이 시작되어 완료되면 이 자리에서 변화를 볼 수
          있습니다.
          {failedLast && ' 마지막 수집 시도는 완료되지 못했습니다.'}
        </p>
      )}
      {result && (
        <>
          {failedLast && attempt && (
            <p role="alert" className="trend-warning">
              마지막 수집 시도({new Date(attempt.scheduled_for).toLocaleString('ko-KR')})가 완료되지
              못했습니다. 아래는 {data?.lag_minutes != null ? lagText(data.lag_minutes) : '이전'}{' '}
              완료된 수집 기준입니다.
            </p>
          )}
          <TrendPanel
            trend={result}
            videos={data?.snapshot?.videos ?? null}
            categoryNames={categoryNames}
            scope="공통 인기 목록"
            onSelectVideo={onOpenVideo}
            onSearchKeyword={onSearchKeyword}
            onImport={onImport}
            showSpotlight={false}
          />
        </>
      )}
    </section>
  );
}
