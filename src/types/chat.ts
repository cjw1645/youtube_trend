export interface ChatRequest {
  question: string;
  videoIds: string[];
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
}
