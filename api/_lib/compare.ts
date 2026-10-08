// 내 검색어 결과와 인기 차트 비교. DB 함수는 원자료만 돌려주고, 비율·순위·정렬은 여기서 계산한다(DB 없이 합성 입력으로 테스트 가능).
import { median } from '../../src/lib/stats/metrics.js';
import { videoKeywords } from '../../src/lib/stats/keywords.js';
import type {
  CompareCategoryRow,
  CompareEngagementRow,
  CompareKeywordRow,
  CompareRun,
  PopularCompare,
} from '../../src/types/trend.js';
import { ApiFailure } from './http.js';
import { serviceRpc } from './supabase.js';

const KEYWORD_LIMIT = 10;
const POSITION_LIMIT = 8;
const CATEGORY_LIMIT = 5;
/** 조회수·좋아요 비교에 올릴 인기 차트 핫 키워드 수 */
const HOT_KEYWORD_LIMIT = 5;

export interface RawCompare {
  query: string;
  slotRunId: number;
  slotScheduledFor: string;
  slotItemCount: number;
  popularRunId: number | null;
  popularScheduledFor?: string;
  popularItemCount?: number;
  slotKeywords?: { keyword: string; videoCount: number }[];
  popularKeywords?: { keyword: string; videoCount: number }[];
  slotCategories?: { categoryId: string; videoCount: number }[];
  popularCategories?: { categoryId: string; videoCount: number }[];
  videoOverlap?: { videoId: string; slotPosition: number; popularPosition: number }[];
  slotVideos?: { viewCount: number | null; likeCount: number | null }[];
  popularVideos?: {
    title: string;
    tags: string[] | null;
    viewCount: number | null;
    likeCount: number | null;
  }[];
}

/** 수집 때 저장하는 키워드와 같은 규칙(제목 단어 정규화·불용어·회차 제외)으로 검색어를 토큰으로 나눈다. */
export function tokenizeQuery(query: string): string[] {
  return [...videoKeywords({ title: query, tags: [] })];
}

const share = (count: number, total: number) => (total > 0 ? count / total : null);

function keywordRow(
  keyword: string,
  slot: number | undefined,
  popular: number | undefined,
  slotTotal: number,
  popularTotal: number,
): CompareKeywordRow {
  const slotShare = slot === undefined ? null : share(slot, slotTotal);
  const popularShare = popular === undefined ? null : share(popular, popularTotal);
  return {
    keyword,
    slotCount: slot ?? null,
    slotShare,
    popularCount: popular ?? null,
    popularShare,
    deltaPp: slotShare !== null && popularShare !== null ? (slotShare - popularShare) * 100 : null,
  };
}

export function buildCompare(raw: RawCompare, tokens: readonly string[]): PopularCompare {
  const slot: CompareRun = {
    runId: raw.slotRunId,
    scheduledFor: raw.slotScheduledFor,
    itemCount: raw.slotItemCount,
  };
  if (raw.popularRunId === null || raw.popularScheduledFor === undefined)
    return { available: false, query: raw.query, slot };
  const popular: CompareRun = {
    runId: raw.popularRunId,
    scheduledFor: raw.popularScheduledFor,
    itemCount: raw.popularItemCount ?? 0,
  };

  const slotKeywords = new Map((raw.slotKeywords ?? []).map((k) => [k.keyword, k.videoCount]));
  const popularList = raw.popularKeywords ?? [];
  const popularKeywords = new Map(popularList.map((k) => [k.keyword, k.videoCount]));

  const exposure = {
    noTokens: tokens.length === 0,
    tokens: tokens.map((keyword) => {
      const count = popularKeywords.get(keyword);
      return {
        keyword,
        popularCount: count ?? null,
        popularShare: count === undefined ? null : share(count, popular.itemCount),
        rank: count === undefined ? null : popularList.findIndex((k) => k.keyword === keyword) + 1,
      };
    }),
  };

  const row = (keyword: string) =>
    keywordRow(
      keyword,
      slotKeywords.get(keyword),
      popularKeywords.get(keyword),
      slot.itemCount,
      popular.itemCount,
    );
  const common = [...slotKeywords.keys()].filter((k) => popularKeywords.has(k)).map(row);
  common.sort(
    (a, b) => (b.slotShare ?? 0) - (a.slotShare ?? 0) || a.keyword.localeCompare(b.keyword),
  );
  const slotOnly = [...slotKeywords.keys()].filter((k) => !popularKeywords.has(k)).map(row);
  slotOnly.sort(
    (a, b) => (b.slotCount ?? 0) - (a.slotCount ?? 0) || a.keyword.localeCompare(b.keyword),
  );
  const popularOnly = [...popularKeywords.keys()].filter((k) => !slotKeywords.has(k)).map(row);
  popularOnly.sort(
    (a, b) => (b.popularCount ?? 0) - (a.popularCount ?? 0) || a.keyword.localeCompare(b.keyword),
  );

  const overlap = raw.videoOverlap ?? [];
  const sortedOverlap = [...overlap].sort((a, b) => a.popularPosition - b.popularPosition);

  const slotCats = new Map((raw.slotCategories ?? []).map((c) => [c.categoryId, c.videoCount]));
  const popCats = new Map((raw.popularCategories ?? []).map((c) => [c.categoryId, c.videoCount]));
  const categories: CompareCategoryRow[] = [...new Set([...slotCats.keys(), ...popCats.keys()])]
    .map((categoryId) => {
      const slotShare = share(slotCats.get(categoryId) ?? 0, slot.itemCount) ?? 0;
      const popularShare = share(popCats.get(categoryId) ?? 0, popular.itemCount) ?? 0;
      return { categoryId, slotShare, popularShare, deltaPp: (slotShare - popularShare) * 100 };
    })
    .sort(
      (a, b) =>
        Math.abs(b.deltaPp) - Math.abs(a.deltaPp) || a.categoryId.localeCompare(b.categoryId),
    )
    .slice(0, CATEGORY_LIMIT);

  // 조회수·좋아요 중앙값: 내 검색 결과, 인기 차트 전체, 인기 차트의 핫 키워드(영상 수 상위) 영상 묶음
  const medianOf = (values: (number | null)[]) =>
    median(values.flatMap((v) => (v === null ? [] : [v])));
  const popularVideos = raw.popularVideos ?? [];
  const slotVideos = raw.slotVideos ?? [];
  const engagement: CompareEngagementRow[] = [
    {
      kind: 'search',
      label: raw.query,
      videos: slotVideos.length,
      medianViews: medianOf(slotVideos.map((v) => v.viewCount)),
      medianLikes: medianOf(slotVideos.map((v) => v.likeCount)),
    },
    {
      kind: 'popular',
      label: '인기 차트 전체',
      videos: popularVideos.length,
      medianViews: medianOf(popularVideos.map((v) => v.viewCount)),
      medianLikes: medianOf(popularVideos.map((v) => v.likeCount)),
    },
    ...popularList
      .filter((k) => !tokens.includes(k.keyword))
      .slice(0, HOT_KEYWORD_LIMIT)
      .map((k): CompareEngagementRow => {
        const group = popularVideos.filter((v) =>
          videoKeywords({ title: v.title, tags: v.tags ?? [] }).has(k.keyword),
        );
        return {
          kind: 'hot',
          label: k.keyword,
          videos: group.length,
          medianViews: medianOf(group.map((v) => v.viewCount)),
          medianLikes: medianOf(group.map((v) => v.likeCount)),
        };
      }),
  ];

  return {
    available: true,
    query: raw.query,
    slot,
    popular,
    exposure,
    keywords: {
      commonTotal: common.length,
      common: common.slice(0, KEYWORD_LIMIT),
      slotOnly: slotOnly.slice(0, KEYWORD_LIMIT),
      popularOnly: popularOnly.slice(0, KEYWORD_LIMIT),
    },
    videos: {
      count: overlap.length,
      share: share(overlap.length, slot.itemCount),
      bestPosition: sortedOverlap[0]?.popularPosition ?? null,
      positions: sortedOverlap.slice(0, POSITION_LIMIT),
    },
    categories,
    engagement,
    slotKeywordCount: slotKeywords.size,
  };
}

/** 본인 슬롯의 최신 검색 수집을 가장 가까운 인기 차트 수집과 비교한다. 완료된 검색 수집이 없으면 null. */
export async function loadSlotCompare(userId: string, slot: 1 | 2): Promise<PopularCompare | null> {
  const raw = await serviceRpc('get_slot_popular_compare', { p_user: userId, p_slot: slot });
  if (raw === null) return null;
  const data = raw as Partial<RawCompare> | undefined;
  if (typeof raw !== 'object' || typeof data?.query !== 'string' || data.slotRunId === undefined)
    throw new ApiFailure('UPSTREAM_ERROR', '비교 데이터를 읽지 못했습니다.', 502);
  return buildCompare(data as RawCompare, tokenizeQuery(data.query));
}

/** 0–1 비율을 퍼센트(소수 1자리)로. 1% 미만도 0으로 보이지 않게 한다. */
const percent = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 10);

/** AI 입력용 요약. 표본 크기가 다르므로 비율 위주로 담고, 카테고리 이름은 호출한 쪽이 붙인다. */
export function summarizeCompare(
  compare: PopularCompare,
  nameOf: (categoryId: string) => string,
): unknown {
  if (!compare.available)
    return {
      available: false,
      note: '검색 수집 시각 근처에 완료된 인기 차트 수집이 없어 비교하지 않음',
    };
  return {
    available: true,
    basis: `검색 결과 ${compare.slot.itemCount}개(${compare.slot.scheduledFor}) vs 인기 차트 ${compare.popular.itemCount}개(${compare.popular.scheduledFor})`,
    searchTokensInPopular: compare.exposure.noTokens
      ? '검색어에서 비교할 키워드 토큰이 없음'
      : compare.exposure.tokens.map((t) => ({
          keyword: t.keyword,
          popularVideos: t.popularCount,
          popularSharePercent: percent(t.popularShare),
          popularKeywordRank: t.rank,
          ...(t.popularCount === null
            ? { note: '인기 차트 키워드 집계에 없음(2개 미만이거나 상위 100개 밖)' }
            : {}),
        })),
    sharedKeywordCount: compare.keywords.commonTotal,
    sharedKeywordsTop5: compare.keywords.common.slice(0, 5).map((r) => ({
      keyword: r.keyword,
      searchSharePercent: percent(r.slotShare),
      popularSharePercent: percent(r.popularShare),
    })),
    videosInBoth: {
      count: compare.videos.count,
      shareOfSearchResultsPercent: percent(compare.videos.share),
      bestPopularPosition: compare.videos.bestPosition,
    },
    medianViewsAndLikes: compare.engagement.map((row) => ({
      group:
        row.kind === 'search'
          ? '내 검색 결과'
          : row.kind === 'popular'
            ? '인기 차트 전체'
            : `인기 차트 핫 키워드 '${row.label}'`,
      videos: row.videos,
      medianViews: row.medianViews,
      medianLikes: row.medianLikes,
    })),
    categoryDifferencesTop3: compare.categories.slice(0, 3).map((c) => ({
      category: nameOf(c.categoryId),
      searchSharePercent: percent(c.slotShare),
      popularSharePercent: percent(c.popularShare),
    })),
  };
}
