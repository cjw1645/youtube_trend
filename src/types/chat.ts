/** 분석 대상 출처. popular만 YouTube 인기 순위가 있다. */
export type RankingSource = 'popular' | 'search' | 'favorites' | 'selection' | 'detail';
export const RANKING_SOURCES: readonly RankingSource[] = [
  'popular',
  'search',
  'favorites',
  'selection',
  'detail',
];

export interface ChatRequest {
  question: string;
  videoIds: string[];
  /** 「인기순」 상위 3개 기준을 정할 출처 */
  source?: RankingSource;
  /** source=popular일 때 videoIds와 같은 순서의 YouTube 인기 순위(1부터) */
  popularRanks?: number[];
}

/** Gemini에 전달한 서버 조회 메타데이터. null은 정보 없음이며 0과 구분한다. */
export interface AnalysisVideo {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category: string | null;
  publishedAt: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  channelTitle: string;
  /** 키워드 채널 수 집계용. 이전에 저장된 응답에는 없을 수 있다. */
  channelId?: string;
  subscriberCount: number | null;
}

export interface AnalysisContext {
  requestedIds: string[];
  analyzedIds: string[];
  excludedIds: string[];
  videos: AnalysisVideo[];
}

export interface ChatResponse {
  answer: string;
  model: string;
  question: string;
  context: AnalysisContext;
  /** 서버가 계산한 「인기순」 상위 영상(근거 데이터 순서). 이전에 저장된 응답에는 없다. */
  ranking?: { basisLabel: string; ids: string[] };
}
