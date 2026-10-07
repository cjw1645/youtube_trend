// 클라이언트와 /api가 공유하는 응답 타입 (api에서는 type import로만 사용)

export interface Video {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  /** ISO 8601 업로드 시각 */
  publishedAt: string;
  categoryId: string;
  durationSeconds: number;
  /** 비공개 처리된 통계는 null */
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  /** 목록 키워드 집계용 공개 태그 (관심 영상 저장에는 포함하지 않음) */
  tags?: string[];
  /** 인기 목록(chart=mostPopular)의 API 제공 순서(1부터). 검색 결과에는 없다. */
  popularRank?: number;
}

export interface VideoDetail extends Video {
  description: string;
  tags: string[];
  channelThumbnailUrl: string;
  /** 구독자 수 비공개 채널은 null */
  subscriberCount: number | null;
}

export interface Category {
  id: string;
  title: string;
}

/** 목록 정렬: 지정하지 않으면 YouTube 기본 순서(인기 순위 / 검색 관련도) */
export type SortOrder = 'viewCount' | 'date';

export type ApiErrorCode =
  | 'QUOTA_EXCEEDED'
  | 'CONFIG_ERROR'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'EMPTY_RESPONSE'
  | 'INTERNAL_ERROR'
  /** 클라이언트 전용: /api에 연결하지 못함 */
  | 'NETWORK_ERROR'
  /** 클라이언트 전용: 새로고침 후 결과 수신 중단 */
  | 'INTERRUPTED';

/** /api 오류 응답 본문 */
export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export interface VideosResponse {
  items: Video[];
}

export interface CategoriesResponse {
  items: Category[];
}
