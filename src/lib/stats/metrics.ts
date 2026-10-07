// 영상 목록의 공개 메타데이터로 계산하는 순수 통계. 대시보드와 AI 서버가 같은 숫자를 쓴다.

const HOUR_MS = 3_600_000;
const DAY_HOURS = 24;
/** API에 쇼츠 여부 필드가 없어 3분 이하 영상을 쇼츠로 분류한다. */
export const SHORTS_MAX_SECONDS = 180;
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

/** 쇼츠(3분 이하) 여부. 길이를 알 수 없으면(0초) null. */
export function isShorts(video: { durationSeconds: number }): boolean | null {
  if (!(video.durationSeconds > 0)) return null;
  return video.durationSeconds <= SHORTS_MAX_SECONDS;
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
  /** 길이를 아는 영상 중 쇼츠(3분 이하) 비율(0–1) */
  shortsShare: number | null;
}

export function summarizeList(
  videos: readonly (Timed & { durationSeconds: number })[],
  now: number,
): ListSummary {
  const recent = videos.filter((v) => hoursSinceUpload(v.publishedAt, now) < DAY_HOURS).length;
  const known = videos.map(isShorts).filter((value): value is boolean => value !== null);
  return {
    count: videos.length,
    recentShare: videos.length ? recent / videos.length : null,
    medianViews: median(videos.flatMap((v) => (v.viewCount === null ? [] : [v.viewCount]))),
    shortsShare: known.length ? known.filter(Boolean).length / known.length : null,
  };
}

/** 쇼츠·롱폼 그룹별 영상 수와 조회수 중앙값. 길이를 모르는 영상은 unknown으로 센다. */
export function formatSplit(videos: readonly (Timed & { durationSeconds: number })[]) {
  const group = (shorts: boolean) => {
    const items = videos.filter((v) => isShorts(v) === shorts);
    return {
      count: items.length,
      medianViews: median(items.flatMap((v) => (v.viewCount === null ? [] : [v.viewCount]))),
    };
  };
  return {
    shorts: group(true),
    long: group(false),
    unknown: videos.filter((v) => isShorts(v) === null).length,
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
