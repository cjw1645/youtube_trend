import { ApiFailure } from './http.js';

export function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
    || (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'production');
}

/** 로컬/Preview 전용. 공개 요청 파라미터와 실제 Key는 사용하지 않는다. */
export function injectTestFailure(provider: 'youtube' | 'gemini'): void {
  if (isProduction()) return;
  const mode = provider === 'youtube' ? process.env.API_TEST_YOUTUBE_ERROR : process.env.API_TEST_GEMINI_ERROR;
  if (mode === 'quota') throw new ApiFailure('QUOTA_EXCEEDED', `${provider === 'youtube' ? 'YouTube 조회' : 'Gemini 무료'} 할당량을 초과했습니다. 잠시 후 다시 시도해 주세요.`, 429);
  if (mode === 'timeout') throw new ApiFailure('TIMEOUT', '분석 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.', 504);
  if (mode === 'upstream') throw new ApiFailure('UPSTREAM_ERROR', '외부 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 502);
}
