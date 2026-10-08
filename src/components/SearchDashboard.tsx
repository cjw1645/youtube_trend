import { useEffect, useState } from 'react';
import TrendPanel from './TrendPanel';
import { toApiRequestError } from '../lib/api';
import type { useSearchSlots } from '../hooks/useSearchSlots';
import type { SlotView, StoredVideo, TrendResult } from '../types/trend';

interface Props {
  view: SlotView;
  call: ReturnType<typeof useSearchSlots>['call'];
  categoryNames: ReadonlyMap<string, string>;
  resolveCategoryNames: (ids: readonly string[]) => void;
  onOpenVideo: (videoId: string) => void;
  onSearchKeyword: (keyword: string) => void;
  onImport: (videos: readonly StoredVideo[], label: string, slot: 1 | 2) => 'set' | 'kept';
}

/** 선택한 검색어 한 개의 저장된 검색 결과 대시보드. */
export default function SearchDashboard({
  view,
  call,
  categoryNames,
  resolveCategoryNames,
  onOpenVideo,
  onSearchKeyword,
  onImport,
}: Props) {
  const slot = view.slot;
  const key = view.snapshot ? `${slot}:${view.snapshot.run_id}` : null;
  const [detail, setDetail] = useState<{
    key: string;
    trend: TrendResult | null;
    videos: StoredVideo[] | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!key) {
      setDetail(null);
      return;
    }
    let active = true;
    Promise.all([
      call<{ trend: TrendResult | null }>(`/api/search-trend?slot=${slot}`, 'GET'),
      call<{ slots: SlotView[] }>(`/api/search-snapshot?slot=${slot}`, 'GET'),
    ])
      .then(([trend, snapshot]) => {
        if (!active) return;
        setDetail({ key, trend: trend.trend, videos: snapshot.slots[0]?.snapshot?.videos ?? null });
        if (trend.trend)
          resolveCategoryNames(trend.trend.current.categories.map((row) => row.categoryId));
      })
      .catch((failure: unknown) => {
        if (active) setError(toApiRequestError(failure).message);
      });
    return () => {
      active = false;
    };
  }, [key, slot, call, resolveCategoryNames]);

  const attempt = view.last_attempt;
  const failed = attempt && attempt.status !== 'complete' && attempt.status !== 'running';
  const query = view.conditions.query;
  return (
    <div className="search-dashboard">
      {view.observation_started_at && (
        <p className="trend-note">
          관측 시작 {new Date(view.observation_started_at).toLocaleString('ko-KR')} · 검색어를
          해제하고 다시 추가하면 새 관측이 시작되며 이전 기록과 이어지지 않습니다.
        </p>
      )}
      {failed && (
        <p role="alert" className="trend-warning">
          마지막 수집 시도({new Date(attempt.scheduled_for).toLocaleString('ko-KR')})가 완료되지
          못했습니다.
        </p>
      )}
      {!view.snapshot && (
        <p className="dash-empty" role="status">
          아직 완료된 수집이 없어 보여줄 집계가 없습니다. 조회가 끝나면 이곳에 표시됩니다.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {detail?.key === key && detail.trend && (
        <>
          <TrendPanel
            key={detail.key}
            trend={detail.trend}
            videos={detail.videos}
            categoryNames={categoryNames}
            scope={`'${query}' 검색 결과`}
            onSelectVideo={onOpenVideo}
            onSearchKeyword={onSearchKeyword}
            onImport={(videos) => onImport(videos, `'${query}' 검색 결과 상위 20개`, slot)}
          />
          <p className="trend-note">
            검색 결과 순서는 YouTube 인기 순위가 아니며, 전체 YouTube를 대표하는 표본이 아닙니다.
          </p>
        </>
      )}
    </div>
  );
}
