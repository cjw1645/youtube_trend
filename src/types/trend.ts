// 저장된 수집 집계의 트렌드 응답 타입. 클라이언트와 /api가 함께 쓴다(api는 계산 결과의 형태로만 사용).

export const BASELINE_KINDS = ['previous', 'day', 'week', 'month'] as const;
export type BaselineKind = (typeof BASELINE_KINDS)[number];
export const LENGTH_KEYS = ['u60', 'u180', 'u600', 'o600'] as const;
export type LengthKey = (typeof LENGTH_KEYS)[number];

export interface ShareChange {
  count: number;
  /** 현재 목록 안 비율(0–1) */
  share: number;
  baseCount: number | null;
  baseShare: number | null;
  /** 비율 변화(퍼센트포인트). 기준 값이 없으면 null */
  deltaPp: number | null;
}

export interface KeywordChange extends ShareChange {
  keyword: string;
  channels: number;
  /** 기준 시점에 2개 미만이거나 상위 100개 밖이라 저장된 값이 없음 */
  belowBaseline: boolean;
}

export interface Comparison {
  kind: BaselineKind;
  available: boolean;
  reason?: 'no_baseline';
  baseline?: { runId: number; scheduledFor: string; itemCount: number; gapMinutes: number };
  smallSample?: boolean;
  videos?: { retained: number; entered: number; left: number; retainedShare: number | null };
  categories?: (ShareChange & { categoryId: string })[];
  /** 기준 쪽에 키워드 집계가 없는 구버전 실행이면 null */
  keywords?: KeywordChange[] | null;
  lengths?: (ShareChange & { key: LengthKey })[];
}

export interface TrendResult {
  current: {
    runId: number;
    scheduledFor: string;
    expiresAt: string;
    itemCount: number;
    categories: (ShareChange & { categoryId: string })[];
    keywords: KeywordChange[] | null;
    lengths: { counts: Record<LengthKey, number>; unknown: number; known: number };
    smallSample: boolean;
  };
  comparisons: Comparison[];
  series: { keyword: string; points: { scheduledFor: string; videoCount: number | null }[] }[];
}

/** 저장된 목록의 영상(근거 탐색·AI 대상 가져오기용). 통계는 수집 시점 값이다. */
export interface StoredVideo {
  position: number;
  video_id: string;
  title: string;
  tags: string[];
  channel_id: string;
  channel_title: string | null;
  thumbnail_url: string | null;
  published_at: string;
  category_id: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  subscriber_count: number | null;
}

export interface LastAttempt {
  status: 'running' | 'complete' | 'partial' | 'failed';
  scheduled_for: string;
  error_code: string | null;
}

/** /api/snapshot: 저장된 최신 공통 인기 목록 */
export interface PopularSnapshotResponse {
  snapshot: {
    run_id: number;
    scheduled_for: string;
    item_count: number;
    pages_fetched: number;
    videos: StoredVideo[];
  } | null;
  lag_minutes?: number;
  last_attempt: LastAttempt | null;
}

export type SearchOrder = 'relevance' | 'date' | 'viewCount';
export type SearchWindow = '' | '1d' | '7d' | '30d';

export interface SlotView {
  slot: 1 | 2;
  conditions: {
    query: string;
    order: SearchOrder;
    window: SearchWindow;
    region: string;
    language: string;
  };
  /** 첫 완료 수집 시각. 없으면 아직 관측이 시작되지 않음 */
  observation_started_at: string | null;
  last_attempt: LastAttempt | null;
  lag_minutes: number | null;
  snapshot: {
    run_id: number;
    scheduled_for: string;
    item_count: number;
    pages_fetched: number;
    videos?: StoredVideo[];
  } | null;
}

export interface SlotsResponse {
  slots: SlotView[];
}

/** 비교에 쓴 수집 실행 한 개 */
export interface CompareRun {
  runId: number;
  scheduledFor: string;
  itemCount: number;
}

/** 키워드 한 개의 양쪽 값. 저장된 집계에 없는 쪽은 null(2개 미만이거나 상위 100개 밖이라 0개와 다르다). */
export interface CompareKeywordRow {
  keyword: string;
  slotCount: number | null;
  slotShare: number | null;
  popularCount: number | null;
  popularShare: number | null;
  /** (검색 비율 − 인기 비율) × 100. 한쪽이 null이면 null */
  deltaPp: number | null;
}

/** 검색어 토큰 한 개가 인기 차트에 나온 정도 */
export interface CompareToken {
  keyword: string;
  popularCount: number | null;
  popularShare: number | null;
  /** 인기 차트 키워드 집계 안의 순위(1부터). 집계에 없으면 null */
  rank: number | null;
}

/** 조회수·좋아요 중앙값 비교의 막대 한 개. 공개되지 않은 값은 제외한 중앙값이며 모두 비공개면 null */
export interface CompareEngagementRow {
  kind: 'search' | 'popular' | 'hot';
  /** search는 검색어, popular는 「인기 차트 전체」, hot은 인기 차트의 핫 키워드 */
  label: string;
  videos: number;
  medianViews: number | null;
  medianLikes: number | null;
  /** 약 24시간 전 수집에도 있던 영상의 하루 조회수 증가(24시간 환산) 중앙값. 이전 수집이 없거나 겹치는 영상이 없으면 null */
  medianDailyGain: number | null;
  /** 하루 증가를 계산한 영상 수(두 수집에 모두 있고 조회수가 공개된 영상) */
  gainVideos: number;
}

/** 업로드 후 경과 시간이 같은 구간의 영상끼리 비교한 누적 조회수 중앙값. 영상 나이가 다른 탓에 생기는 누적 차이를 피한다. */
export interface CompareAgeBand {
  key: 'under3d' | '3to30d' | 'over30d';
  /** 「3일 미만」 「3~30일」 「30일 이상」 */
  label: string;
  slotVideos: number;
  popularVideos: number;
  slotMedianViews: number | null;
  popularMedianViews: number | null;
  /** 검색 ÷ 인기. 양쪽 모두 최소 표본 이상이고 인기 쪽 중앙값이 0보다 클 때만 */
  ratio: number | null;
}

export interface CompareCategoryRow {
  categoryId: string;
  slotShare: number;
  popularShare: number;
  deltaPp: number;
}

/** 내 검색어 수집 하루치. 통계는 그 수집 시점 값이다. */
export interface HistoryDay {
  runId: number;
  scheduledFor: string;
  itemCount: number;
  /** 약 24시간 전 수집에도 있던 영상의 하루 조회수 증가 중앙값. 전날 수집이 없거나 겹친 영상이 적으면 null */
  medianDailyGain: number | null;
  /** 하루 증가를 계산한 영상 수 */
  gainVideos: number;
  /** 수집 시점에 업로드 후 3일이 안 된 영상 수 */
  freshCount: number;
}

/** 내 검색어를 자기 지난 수집(평소)과 비교한 결과 */
export interface OwnHistory {
  query: string;
  /** 오래된 순 */
  days: HistoryDay[];
  /** 가장 최근 수집 */
  latest: HistoryDay;
  /** 평소: 최근 수집 직전의 비교 가능한 수집들(최대 7개)의 중앙값 */
  usual: { medianDailyGain: number | null; freshShare: number | null; days: number };
  /** 평소 판정에 필요한 지난 수집 수 */
  needed: number;
  /** 최근 ÷ 평소 하루 조회수 증가. 판정할 수 없으면 null */
  gainRatio: number | null;
  /** 최근 수집의 새 영상(3일 미만) 비중 */
  freshShare: number | null;
}

/** 슬롯 최신 검색 수집과 가장 가까운 인기 차트 수집의 비교(A 노출·B 키워드·C 영상·D 카테고리) */
export type PopularCompare =
  | { available: false; query: string; slot: CompareRun }
  | {
      available: true;
      query: string;
      slot: CompareRun;
      popular: CompareRun;
      exposure: { tokens: CompareToken[]; noTokens: boolean };
      keywords: {
        commonTotal: number;
        common: CompareKeywordRow[];
        slotOnly: CompareKeywordRow[];
        popularOnly: CompareKeywordRow[];
      };
      videos: {
        count: number;
        share: number | null;
        bestPosition: number | null;
        positions: { videoId: string; slotPosition: number; popularPosition: number }[];
      };
      categories: CompareCategoryRow[];
      /** 내 검색 결과 · 인기 차트 전체 · 핫 키워드별 조회수·좋아요 중앙값 */
      engagement: CompareEngagementRow[];
      /** 하루 증가 계산에 쓴 약 24시간 전 수집 시각. 없으면 null */
      gainBasis: { slotPrev: string | null; popularPrev: string | null };
      /** 업로드 후 3일 미만 · 3~30일 · 30일 이상 구간별 누적 조회수 비교 */
      ageBands: CompareAgeBand[];
      /** 이 검색 수집에 저장된 키워드 집계 수. 0이면 집계에 실패한 것으로 보고 다른 검색어를 안내한다. */
      slotKeywordCount: number;
    };
