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
