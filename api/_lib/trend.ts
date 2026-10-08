// 저장된 수집 실행끼리의 비교 계산. 입력은 DB의 get_*_trend_inputs 결과이며, 순수 함수만 두어 합성 입력으로 검증한다.
// 비율의 분모는 실제 수집된 영상 수(item_count)이고, 없는 값을 0으로 바꾸지 않는다.

import {
  BASELINE_KINDS,
  LENGTH_KEYS,
  type BaselineKind,
  type Comparison,
  type KeywordChange,
  type LengthKey,
  type ShareChange,
  type TrendResult,
} from '../../src/types/trend.js';

export { BASELINE_KINDS, LENGTH_KEYS };

/** 현재 목록에서 키워드를 표시하려면 필요한 최소 영상 수. 저장 기준(2개)보다 높게 두어 우연한 반복을 줄인다. */
export const KEYWORD_DISPLAY_MIN_VIDEOS = 3;
/** 비교 상대 목록의 영상 수가 이 값 미만이면 비율 변화를 참고용으로만 표시한다. */
export const SMALL_SAMPLE = 10;
const KEYWORD_TREND_LIMIT = 30;

export interface RunProfile {
  run_id: number;
  scheduled_for: string;
  item_count: number;
  expires_at: string;
  has_keywords: boolean;
  video_ids: string[];
  categories: Record<string, number>;
  /** keyword → [영상 수, 고유 채널 수] */
  keywords: Record<string, [number, number]>;
  lengths: Record<LengthKey | 'unknown', number>;
}

export interface TrendInputs {
  current: RunProfile;
  baselines: Record<BaselineKind, RunProfile | null>;
  top_keywords: string[];
  series: { scheduled_for: string; item_count: number; counts: Record<string, number> }[];
}

function change(
  count: number,
  total: number,
  baseCount: number | null,
  baseTotal: number,
): ShareChange {
  const share = total > 0 ? count / total : 0;
  const baseShare = baseCount !== null && baseTotal > 0 ? baseCount / baseTotal : null;
  return {
    count,
    share,
    baseCount,
    baseShare,
    deltaPp: baseShare === null ? null : (share - baseShare) * 100,
  };
}

function categoryRows(cur: RunProfile, base: RunProfile | null) {
  return Object.entries(cur.categories)
    .map(([categoryId, count]) => ({
      categoryId,
      ...change(
        count,
        cur.item_count,
        base ? (base.categories[categoryId] ?? 0) : null,
        base?.item_count ?? 0,
      ),
    }))
    .sort((a, b) => b.count - a.count || (a.categoryId < b.categoryId ? -1 : 1));
}

function keywordRows(cur: RunProfile, base: RunProfile | null): KeywordChange[] {
  return Object.entries(cur.keywords)
    .filter(([, [videos]]) => videos >= KEYWORD_DISPLAY_MIN_VIDEOS)
    .map(([keyword, [videos, channels]]) => {
      const stored = base?.keywords[keyword];
      const row = change(videos, cur.item_count, stored ? stored[0] : null, base?.item_count ?? 0);
      return { keyword, channels, belowBaseline: base !== null && !stored, ...row };
    })
    .sort((a, b) => b.count - a.count || (a.keyword < b.keyword ? -1 : 1))
    .slice(0, KEYWORD_TREND_LIMIT);
}

function lengthTotals(profile: RunProfile) {
  const known = LENGTH_KEYS.reduce((sum, key) => sum + (profile.lengths[key] ?? 0), 0);
  return { known, unknown: profile.lengths.unknown ?? 0 };
}

function lengthRows(cur: RunProfile, base: RunProfile | null) {
  const curKnown = lengthTotals(cur).known;
  const baseKnown = base ? lengthTotals(base).known : 0;
  return LENGTH_KEYS.map((key) => ({
    key,
    ...change(cur.lengths[key] ?? 0, curKnown, base ? (base.lengths[key] ?? 0) : null, baseKnown),
  }));
}

function compare(kind: BaselineKind, cur: RunProfile, base: RunProfile | null): Comparison {
  if (!base) return { kind, available: false, reason: 'no_baseline' };
  const baseIds = new Set(base.video_ids);
  const curIds = new Set(cur.video_ids);
  const retained = cur.video_ids.filter((id) => baseIds.has(id)).length;
  return {
    kind,
    available: true,
    baseline: {
      runId: base.run_id,
      scheduledFor: base.scheduled_for,
      itemCount: base.item_count,
      gapMinutes: Math.round(
        (Date.parse(cur.scheduled_for) - Date.parse(base.scheduled_for)) / 60_000,
      ),
    },
    smallSample: cur.item_count < SMALL_SAMPLE || base.item_count < SMALL_SAMPLE,
    videos: {
      retained,
      entered: curIds.size - retained,
      left: base.video_ids.filter((id) => !curIds.has(id)).length,
      retainedShare: curIds.size ? retained / curIds.size : null,
    },
    categories: categoryRows(cur, base),
    keywords: cur.has_keywords && base.has_keywords ? keywordRows(cur, base) : null,
    lengths: lengthRows(cur, base),
  };
}

export function buildTrend(inputs: TrendInputs): TrendResult {
  const { current: cur } = inputs;
  const totals = lengthTotals(cur);
  return {
    current: {
      runId: cur.run_id,
      scheduledFor: cur.scheduled_for,
      expiresAt: cur.expires_at,
      itemCount: cur.item_count,
      categories: categoryRows(cur, null),
      keywords: cur.has_keywords ? keywordRows(cur, null) : null,
      lengths: {
        counts: Object.fromEntries(
          LENGTH_KEYS.map((key) => [key, cur.lengths[key] ?? 0]),
        ) as Record<LengthKey, number>,
        unknown: totals.unknown,
        known: totals.known,
      },
      smallSample: cur.item_count < SMALL_SAMPLE,
    },
    comparisons: BASELINE_KINDS.map((kind) => compare(kind, cur, inputs.baselines[kind] ?? null)),
    // 시계열 값이 없는 시점은 0이 아니라 null(기준 미만 또는 상위 밖)이다.
    series: inputs.top_keywords.map((keyword) => ({
      keyword,
      points: inputs.series.map((run) => ({
        scheduledFor: run.scheduled_for,
        videoCount: run.counts[keyword] ?? null,
      })),
    })),
  };
}

const KIND_LABEL: Record<BaselineKind, string> = {
  previous: '직전 수집',
  day: '전일 동시간',
  week: '7일 전',
  month: '28일 전',
};
const LENGTH_LABEL: Record<LengthKey, string> = {
  u60: '1분 이하',
  u180: '1~3분',
  u600: '3~10분',
  o600: '10분 초과',
};
const r1 = (value: number) => Math.round(value * 10) / 10;

/** AI 입력용 요약. 표시 비율(%)·퍼센트포인트만 담고 계산 결과를 모델이 다시 계산하지 않게 한다. */
export function summarizeTrend(trend: TrendResult, categoryName: (id: string) => string) {
  const { current } = trend;
  return {
    collectedAt: current.scheduledFor,
    itemCount: current.itemCount,
    smallSample: current.smallSample,
    keywords: current.keywords
      ? current.keywords.slice(0, 10).map((row) => ({
          keyword: row.keyword,
          videoCount: row.count,
          sharePercent: r1(row.share * 100),
          channelCount: row.channels,
        }))
      : null,
    categories: current.categories.slice(0, 5).map((row) => ({
      category: categoryName(row.categoryId),
      videoCount: row.count,
      sharePercent: r1(row.share * 100),
    })),
    lengthSharePercent: current.lengths.known
      ? Object.fromEntries(
          LENGTH_KEYS.map((key) => [
            LENGTH_LABEL[key],
            r1((current.lengths.counts[key] / current.lengths.known) * 100),
          ]),
        )
      : null,
    comparisons: trend.comparisons.flatMap((cmp) =>
      cmp.available && cmp.baseline && cmp.videos
        ? [
            {
              basis: KIND_LABEL[cmp.kind],
              baselineCollectedAt: cmp.baseline.scheduledFor,
              gapMinutes: cmp.baseline.gapMinutes,
              smallSample: cmp.smallSample ?? false,
              videos: {
                retained: cmp.videos.retained,
                entered: cmp.videos.entered,
                left: cmp.videos.left,
              },
              keywordChanges: cmp.keywords
                ? cmp.keywords.slice(0, 8).map((row) => ({
                    keyword: row.keyword,
                    changePp: row.deltaPp === null ? null : r1(row.deltaPp),
                    belowBaseline: row.belowBaseline,
                  }))
                : null,
              categoryChanges: (cmp.categories ?? []).slice(0, 5).map((row) => ({
                category: categoryName(row.categoryId),
                changePp: row.deltaPp === null ? null : r1(row.deltaPp),
              })),
            },
          ]
        : [],
    ),
    unavailableBases: trend.comparisons
      .filter((cmp) => !cmp.available)
      .map((cmp) => KIND_LABEL[cmp.kind]),
  };
}
