// 영상 목록의 공개 메타데이터로 계산하는 순수 통계. 대시보드와 AI 서버가 같은 숫자를 쓴다.

const HOUR_MS = 3_600_000;
const DAY_HOURS = 24;
/**
 * 길이 구간 경계(초). API에는 쇼츠 여부 필드가 없어 길이로 쇼츠를 단정하지 않고 구간으로만 나눈다.
 * 저장된 집계(DB run_profile)의 구간과 같은 경계를 쓴다.
 */
export const LENGTH_BUCKETS = [
  { key: 'u60', label: '1분 이하', maxSeconds: 60 },
  { key: 'u180', label: '1~3분', maxSeconds: 180 },
  { key: 'u600', label: '3~10분', maxSeconds: 600 },
  { key: 'o600', label: '10분 초과', maxSeconds: Infinity },
] as const;
export type LengthBucketKey = (typeof LENGTH_BUCKETS)[number]['key'];
/** 참여율은 조회수가 너무 적으면 비율이 크게 튀므로 기준 미만을 제외한다. */
export const ENGAGEMENT_MIN_VIEWS = 1_000;

interface Timed {
  publishedAt: string;
  viewCount: number | null;
}

/** 업로드 후 경과 시간(시간). 미래 시각은 0으로 본다. */
export function hoursSinceUpload(publishedAt: string, now: number): number {
  return Math.max(0, (now - Date.parse(publishedAt)) / HOUR_MS);
}

/** 업로드 후 일평균 조회수 = 조회수 ÷ max(경과일, 1). 조회수 null이면 null. */
export function viewsPerDay(video: Timed, now: number): number | null {
  if (video.viewCount === null) return null;
  return video.viewCount / Math.max(hoursSinceUpload(video.publishedAt, now) / DAY_HOURS, 1);
}

/** 업로드 후 시간당 조회수 = 조회수 ÷ max(경과 시간, 1). 조회수 null이면 null. */
export function viewsPerHour(video: Timed, now: number): number | null {
  if (video.viewCount === null) return null;
  return video.viewCount / Math.max(hoursSinceUpload(video.publishedAt, now), 1);
}

/** 정렬된 값의 중앙값. 값이 없으면 null. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** 길이 구간. 길이를 알 수 없으면(0초 이하·null) null. */
export function lengthBucket(video: { durationSeconds: number | null }): LengthBucketKey | null {
  const seconds = video.durationSeconds;
  if (seconds === null || !(seconds > 0)) return null;
  return LENGTH_BUCKETS.find((bucket) => seconds <= bucket.maxSeconds)!.key;
}

/** 참여율(%) = (좋아요 + 댓글) ÷ 조회수 × 100. 통계 null·조회수 기준 미만이면 null. */
export function engagementRate(
  video: { viewCount: number | null; likeCount: number | null; commentCount: number | null },
  minViews = ENGAGEMENT_MIN_VIEWS,
): number | null {
  const { viewCount, likeCount, commentCount } = video;
  if (viewCount === null || likeCount === null || commentCount === null) return null;
  if (viewCount < minViews || viewCount === 0) return null;
  return ((likeCount + commentCount) / viewCount) * 100;
}

export interface CategoryShare {
  key: string;
  count: number;
  /** 영상 수 비율(0–1) */
  share: number;
  /** 조회수 합계(null 제외) */
  views: number;
  /** 조회수 합계 비중(0–1). 전체 조회수 합이 0이면 null */
  viewShare: number | null;
}

/** 카테고리별 영상 수·비율·조회수 비중. 영상 수 → 조회수 → 목록 등장 순서로 정렬한다. */
export function categoryDistribution<T extends { viewCount: number | null }>(
  videos: readonly T[],
  keyOf: (video: T) => string,
): CategoryShare[] {
  const groups = new Map<string, { count: number; views: number }>();
  let totalViews = 0;
  for (const video of videos) {
    const group = groups.get(keyOf(video)) ?? { count: 0, views: 0 };
    group.count += 1;
    group.views += video.viewCount ?? 0;
    totalViews += video.viewCount ?? 0;
    groups.set(keyOf(video), group);
  }
  return [...groups]
    .map(([key, { count, views }], order) => ({
      key,
      count,
      share: count / videos.length,
      views,
      viewShare: totalViews > 0 ? views / totalViews : null,
      order,
    }))
    .sort((a, b) => b.count - a.count || b.views - a.views || a.order - b.order)
    .map(({ order: _order, ...rest }) => rest);
}

export interface ListSummary {
  count: number;
  /** 24시간 안에 업로드된 영상 비율(0–1). 목록이 비면 null */
  recentShare: number | null;
  /** 조회수 중앙값(null 제외) */
  medianViews: number | null;
}

export function summarizeList(videos: readonly Timed[], now: number): ListSummary {
  const recent = videos.filter((v) => hoursSinceUpload(v.publishedAt, now) < DAY_HOURS).length;
  return {
    count: videos.length,
    recentShare: videos.length ? recent / videos.length : null,
    medianViews: median(videos.flatMap((v) => (v.viewCount === null ? [] : [v.viewCount]))),
  };
}

/**
 * 길이 구간별 영상 수, 길이를 아는 영상 중 비율(0–1), 조회수 중앙값.
 * 길이를 모르는 영상은 unknown으로 세고 비율에서 뺀다.
 */
export function lengthDistribution(
  videos: readonly (Timed & { durationSeconds: number | null })[],
) {
  const known = videos.filter((v) => lengthBucket(v) !== null).length;
  return {
    buckets: LENGTH_BUCKETS.map(({ key, label }) => {
      const items = videos.filter((v) => lengthBucket(v) === key);
      return {
        key,
        label,
        count: items.length,
        share: known ? items.length / known : null,
        medianViews: median(items.flatMap((v) => (v.viewCount === null ? [] : [v.viewCount]))),
      };
    }),
    unknown: videos.length - known,
  };
}

export type { RankingSource } from '../../types/chat.js';
import type { RankingSource } from '../../types/chat.js';

export interface TopRanking {
  basis: 'popularRank' | 'viewsPerDay';
  /** 화면·답변에 그대로 쓰는 기준 이름 */
  basisLabel: string;
  items: { id: string; rank: number; viewsPerDay: number | null }[];
}

/**
 * 출처별 「인기순」 상위 목록.
 * - popular: YouTube 인기 순위(popularRank, 없으면 화면 순서). 화면 정렬과 무관하다.
 * - 그 밖: 업로드 후 일평균 조회수. null은 제외, 동률은 조회수 → 화면 순서.
 */
export function topRanking<T extends Timed & { id: string }>(
  videos: readonly T[],
  source: RankingSource,
  now: number,
  { popularRank, limit = 3 }: { popularRank?: ReadonlyMap<string, number>; limit?: number } = {},
): TopRanking {
  const indexed = videos.map((video, order) => ({ video, order, perDay: viewsPerDay(video, now) }));
  if (source === 'popular') {
    const rankOf = (entry: (typeof indexed)[number]) =>
      popularRank?.get(entry.video.id) ?? Number.MAX_SAFE_INTEGER;
    return {
      basis: 'popularRank',
      basisLabel: 'YouTube 인기 순위',
      items: [...indexed]
        .sort((a, b) => rankOf(a) - rankOf(b) || a.order - b.order)
        .slice(0, limit)
        .map(({ video, perDay }, index) => ({
          id: video.id,
          rank: index + 1,
          viewsPerDay: perDay,
        })),
    };
  }
  return {
    basis: 'viewsPerDay',
    basisLabel: '업로드 후 일평균 조회수',
    items: indexed
      .filter((entry) => entry.perDay !== null)
      .sort(
        (a, b) =>
          b.perDay! - a.perDay! || b.video.viewCount! - a.video.viewCount! || a.order - b.order,
      )
      .slice(0, limit)
      .map(({ video, perDay }, index) => ({ id: video.id, rank: index + 1, viewsPerDay: perDay })),
  };
}

/** score가 큰 순서로 상위 limit개. null은 제외하고 동률은 목록 순서를 따른다. */
export function topBy<T>(
  items: readonly T[],
  score: (item: T) => number | null,
  limit: number,
): { item: T; score: number }[] {
  return items
    .map((item, order) => ({ item, score: score(item), order }))
    .filter((entry): entry is { item: T; score: number; order: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score }));
}

export interface MetricAggregate {
  /** 대상 영상 수 */
  total: number;
  /** 값이 null이라 계산에서 뺀 영상 수 */
  nullExcluded: number;
  /** 값이 있는 영상의 합계. 값이 하나도 없으면 null */
  sum: number | null;
  /** 합계 ÷ (total − nullExcluded), 정수 반올림 */
  average: number | null;
  median: number | null;
  /** 동률이면 목록에서 먼저 나온 영상 */
  max: { value: number; id: string } | null;
  min: { value: number; id: string } | null;
}

/** 한 지표의 합계·평균·중앙값·최댓값·최솟값. null은 제외하고 0은 유효한 값으로 센다. */
export function aggregateMetric<T extends { id: string }>(
  items: readonly T[],
  valueOf: (item: T) => number | null,
): MetricAggregate {
  const entries = items.flatMap((item) => {
    const value = valueOf(item);
    return value === null ? [] : [{ id: item.id, value }];
  });
  const total = items.length;
  if (!entries.length)
    return {
      total,
      nullExcluded: total,
      sum: null,
      average: null,
      median: null,
      max: null,
      min: null,
    };
  const sum = entries.reduce((acc, entry) => acc + entry.value, 0);
  const pick = (better: (a: number, b: number) => boolean) =>
    entries.reduce((best, entry) => (better(entry.value, best.value) ? entry : best));
  return {
    total,
    nullExcluded: total - entries.length,
    sum,
    average: Math.round(sum / entries.length),
    median: median(entries.map((entry) => entry.value)),
    max: pick((a, b) => a > b),
    min: pick((a, b) => a < b),
  };
}

/**
 * AI 통계 질문용 집계: 조회수·좋아요·댓글·업로드 후 일평균 조회수.
 * 일평균 조회수는 영상별로 정수 반올림한 값(답변의 영상별 값과 같은 값)을 모은다.
 */
export function aggregates(
  videos: readonly (Timed & {
    id: string;
    likeCount: number | null;
    commentCount: number | null;
  })[],
  now: number,
) {
  return {
    viewCount: aggregateMetric(videos, (video) => video.viewCount),
    likeCount: aggregateMetric(videos, (video) => video.likeCount),
    commentCount: aggregateMetric(videos, (video) => video.commentCount),
    viewsPerDay: aggregateMetric(videos, (video) => {
      const value = viewsPerDay(video, now);
      return value === null ? null : Math.round(value);
    }),
  };
}
