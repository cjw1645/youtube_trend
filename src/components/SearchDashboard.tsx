import { useEffect, useState } from 'react';
import TrendPanel from './TrendPanel';
import PopularCompareSection, { CompareEngagement } from './PopularCompareSection';
import OwnHistorySection from './OwnHistorySection';
import { toApiRequestError } from '../lib/api';
import type { useSearchSlots } from '../hooks/useSearchSlots';
import type {
  OwnHistory,
  PopularCompare,
  SlotView,
  StoredVideo,
  TrendResult,
} from '../types/trend';

interface Props {
  view: SlotView;
  call: ReturnType<typeof useSearchSlots>['call'];
  categoryNames: ReadonlyMap<string, string>;
  resolveCategoryNames: (ids: readonly string[]) => void;
  onOpenVideo: (videoId: string) => void;
  onSearchKeyword: (keyword: string) => void;
  onImport: (videos: readonly StoredVideo[], label: string, slot: 1 | 2) => void;
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
  const [compare, setCompare] = useState<{ key: string; value: PopularCompare | null } | null>(
    null,
  );

  const [history, setHistory] = useState<{ key: string; value: OwnHistory | null } | null>(null);

  // 평소 대비 판정과 인기 차트와의 비교는 각각 실패해도 나머지 대시보드를 막지 않는다.
  useEffect(() => {
    setCompare(null);
    setHistory(null);
    if (!key) return;
    let active = true;
    call<{ compare: PopularCompare | null }>(`/api/search-compare?slot=${slot}`, 'GET')
      .then((result) => active && setCompare({ key, value: result.compare }))
      .catch(() => active && setCompare({ key, value: null }));
    call<{ history: OwnHistory | null }>(`/api/search-history?slot=${slot}`, 'GET')
      .then((result) => active && setHistory({ key, value: result.history }))
      .catch(() => active && setHistory({ key, value: null }));
    return () => {
      active = false;
    };
  }, [key, slot, call]);

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
          관측 시작 {new Date(view.observation_started_at).toLocaleString('ko-KR')} · 같은
          검색어·조건으로 다시 추가하면 이전 기록에 이어지고, 검색어나 조건을 바꾸면 새로
          관측합니다.
        </p>
      )}
      {failed && (
        <p role="alert" className="trend-warning">
          마지막 수집 시도({new Date(attempt.scheduled_for).toLocaleString('ko-KR')})가 완료되지
          못했습니다.
        </p>
      )}
      {view.snapshot && view.snapshot.item_count === 0 && (
        <p role="status" className="trend-warning">
          YouTube가 이 검색어에 결과를 돌려주지 않았습니다(0개). 일시적일 수 있어 내일 04:00(KST)
          갱신에서 다시 조회합니다. 지금 바로 보려면 이 검색어를 해제하고 비슷한 표현(예: 한 단어를
          더 붙인 검색어)으로 다시 추가해 보세요.
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
      {history?.key === key && history.value && (
        <OwnHistorySection
          history={history.value}
          trend={detail?.key === key ? detail.trend : null}
          onOpenVideo={onOpenVideo}
          onSearchKeyword={onSearchKeyword}
        />
      )}
      {compare?.key === key && compare.value && (
        <PopularCompareSection
          secondary={!!(history?.key === key && history.value)}
          compare={compare.value}
          categoryNames={categoryNames}
          onSearchKeyword={onSearchKeyword}
        />
      )}
      {compare?.key === key && compare.value && !(detail?.key === key && detail.trend) && (
        <CompareEngagement compare={compare.value} />
      )}
      {detail?.key === key && detail.trend && (
        <>
          <TrendPanel
            key={detail.key}
            afterSpotlight={
              compare?.key === key && compare.value ? (
                <CompareEngagement compare={compare.value} />
              ) : undefined
            }
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
