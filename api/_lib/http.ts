// /api 공용 응답 헬퍼: 오류는 항상 { code, message }로 정규화한다.
import type { ApiError, ApiErrorCode } from '../../src/types/video.js';

export class ApiFailure extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** 업스트림(YouTube·Gemini)이 준 원래 사유. 응답에는 싣지 않고 분기용으로만 사용 */
  readonly reason?: string;

  constructor(code: ApiErrorCode, message: string, status: number, reason?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

export const CACHE_NONE = 'no-store';

export function json(data: unknown, init: { status?: number; cache?: string } = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': init.cache ?? CACHE_NONE,
    },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiFailure) {
    const body: ApiError = { code: err.code, message: err.message };
    return json(body, { status: err.status });
  }
  // 예외 원문에 인증 URL·요청 메타데이터가 포함될 수 있어 로그하지 않는다.
  console.error('[api] unexpected error');
  const body: ApiError = {
    code: 'INTERNAL_ERROR',
    message: '서버에서 알 수 없는 오류가 발생했습니다.',
  };
  return json(body, { status: 500 });
}
