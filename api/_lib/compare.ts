// 내 검색어 결과와 인기 차트 비교. DB 함수는 원자료만 돌려주고, 비율·순위·정렬은 여기서 계산한다(DB 없이 합성 입력으로 테스트 가능).
import { median } from '../../src/lib/stats/metrics.js';
import { videoKeywords } from '../../src/lib/stats/keywords.js';
import type {
  CompareAgeBand,
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
/** 나이대 비교에서 배율을 내기 위한 한쪽 최소 영상 수 */
export const AGE_BAND_MIN_VIDEOS = 3;
/** 업로드 후 경과 시간 구간(시간 단위, 하한 포함·상한 미포함) */
const AGE_BANDS: { key: CompareAgeBand['key']; label: string; from: number; to: number }[] = [
  { key: 'under3d', label: '3일 미만', from: 0, to: 72 },
  { key: '3to30d', label: '3~30일', from: 72, to: 720 },
  { key: 'over30d', label: '30일 이상', from: 720, to: Infinity },
];

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
  /** 약 24시간 전 비교 실행 시각(Stage 12). 없거나 이전 DB 함수면 null/undefined */
  slotPrevScheduledFor?: string | null;
  popularPrevScheduledFor?: string | null;
  slotVideos?: {
    viewCount: number | null;
    likeCount: number | null;
    dailyGain?: number | null;
    /** 관측 시점의 업로드 후 경과 시간(Stage 12) */
    ageHours?: number | null;
  }[];
  popularVideos?: {
    title: string;
    tags: string[] | null;
    viewCount: number | null;
    likeCount: number | null;
    dailyGain?: number | null;
    ageHours?: number | null;
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

  // 조회수·좋아요 중앙값: 내 검색 결과, 인기 차트 전체, 인기 차트의 핫 키워드(영상 수 상위) 영상 묶음.
  // 누적 조회수는 영상 나이에 좌우되므로 비교의 주 지표는 약 24시간 전 수집 대비 하루 증가(dailyGain)다.
  const medianOf = (values: (number | null | undefined)[]) =>
    median(values.flatMap((v) => (v == null ? [] : [v])));
  const gainRow = (group: { dailyGain?: number | null }[]) => {
    const gains = group.flatMap((v) => (v.dailyGain == null ? [] : [v.dailyGain]));
    return { medianDailyGain: median(gains), gainVideos: gains.length };
  };
  const popularVideos = raw.popularVideos ?? [];
  const slotVideos = raw.slotVideos ?? [];
  const engagement: CompareEngagementRow[] = [
    {
      kind: 'search',
      label: raw.query,
      videos: slotVideos.length,
      medianViews: medianOf(slotVideos.map((v) => v.viewCount)),
      medianLikes: medianOf(slotVideos.map((v) => v.likeCount)),
      ...gainRow(slotVideos),
    },
    {
      kind: 'popular',
      label: '인기 차트 전체',
      videos: popularVideos.length,
      medianViews: medianOf(popularVideos.map((v) => v.viewCount)),
      medianLikes: medianOf(popularVideos.map((v) => v.likeCount)),
      ...gainRow(popularVideos),
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
          ...gainRow(group),
        };
      }),
  ];

  // 같은 나이대끼리 누적 조회수 비교. 경과 시간이나 조회수를 모르는 영상은 뺀다.
  type Aged = { viewCount: number | null; ageHours?: number | null };
  const inBand = (videos: Aged[], from: number, to: number) =>
    videos.flatMap((v) =>
      v.ageHours == null || v.viewCount === null || v.ageHours < from || v.ageHours >= to
        ? []
        : [v.viewCount],
    );
  const ageBands: CompareAgeBand[] = AGE_BANDS.map(({ key, label, from, to }) => {
    const mineViews = inBand(slotVideos, from, to);
    const popularViews = inBand(popularVideos, from, to);
    const slotMedianViews = median(mineViews);
    const popularMedianViews = median(popularViews);
    const enough =
      mineViews.length >= AGE_BAND_MIN_VIDEOS && popularViews.length >= AGE_BAND_MIN_VIDEOS;
    return {
      key,
      label,
      slotVideos: mineViews.length,
      popularVideos: popularViews.length,
      slotMedianViews,
      popularMedianViews,
      ratio:
        enough && slotMedianViews !== null && popularMedianViews
          ? slotMedianViews / popularMedianViews
          : null,
    };
  });

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
    gainBasis: {
      slotPrev: raw.slotPrevScheduledFor ?? null,
      popularPrev: raw.popularPrevScheduledFor ?? null,
    },
    ageBands,
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
      medianDailyViewGain: row.medianDailyGain,
      dailyGainVideos: row.gainVideos,
    })),
    viewsNote:
      '누적 조회수(medianViews)는 오래된 영상일수록 크다. 지금의 인기 비교에는 약 24시간 전 수집 대비 하루 조회수 증가(medianDailyViewGain)를 쓴다. null이면 이전 수집이 없어 판단할 수 없다.',
    dailyGainBasis: compare.gainBasis,
    viewsByUploadAge: compare.ageBands.map((band) => ({
      uploadAge: band.label,
      searchVideos: band.slotVideos,
      popularVideos: band.popularVideos,
      searchMedianViews: band.slotMedianViews,
      popularMedianViews: band.popularMedianViews,
      searchToPopularRatio: band.ratio === null ? null : Math.round(band.ratio * 100) / 100,
    })),
    viewsByUploadAgeNote: `같은 업로드 후 경과 기간의 영상끼리 누적 조회수 중앙값을 비교한 것이다. 한쪽 영상이 ${AGE_BAND_MIN_VIDEOS}개 미만이면 배율(searchToPopularRatio)은 null이다.`,
    categoryDifferencesTop3: compare.categories.slice(0, 3).map((c) => ({
      category: nameOf(c.categoryId),
      searchSharePercent: percent(c.slotShare),
      popularSharePercent: percent(c.popularShare),
    })),
  };
}
