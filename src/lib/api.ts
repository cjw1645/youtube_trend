// 클라이언트는 이 모듈을 통해 /api/*만 호출한다 (YouTube·Gemini 직접 호출 금지).
import type { ApiErrorCode } from '../types/video';
import { isErrorCode, isRecord, matchesChatRequest, validApiResponse } from './api-contract';

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function toApiRequestError(err: unknown): ApiRequestError {
  if (err instanceof ApiRequestError) return err;
  return new ApiRequestError('INTERNAL_ERROR', '알 수 없는 오류가 발생했습니다.', 0);
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { signal });
}

export async function postJson<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
  token?: string,
): Promise<T> {
  const response = await requestJson<T>(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  });
  if (path === '/api/chat' && !matchesChatRequest(body, response)) {
    throw new ApiRequestError(
      'UPSTREAM_ERROR',
      '답변의 질문 또는 대상이 요청과 일치하지 않습니다. 다시 시도해 주세요.',
      502,
    );
  }
  return response;
}

/** 로그인 사용자 전용 호출. 액세스 토큰만 보내며 사용자 id는 서버가 토큰에서 정한다. */
export async function authedJson<T>(
  path: string,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return requestJson<T>(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
}

async function requestJson<T>(path: string, options: RequestInit): Promise<T> {
  const signal = options.signal;
  let res: Response;
  try {
    res = await fetch(path, options);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiRequestError(
      'NETWORK_ERROR',
      '서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.',
      0,
    );
  }

  const body: unknown = await res.json().catch(() => null);
  signal?.throwIfAborted();
  if (!res.ok) {
    const error = isRecord(body) ? body : {};
    throw new ApiRequestError(
      isErrorCode(error.code) ? error.code : 'INTERNAL_ERROR',
      typeof error.message === 'string' && error.message.trim()
        ? error.message
        : `요청에 실패했습니다. (HTTP ${res.status})`,
      res.status,
    );
  }
  if (
    path === '/api/chat' &&
    isRecord(body) &&
    typeof body.answer === 'string' &&
    !body.answer.trim()
  ) {
    throw new ApiRequestError(
      'EMPTY_RESPONSE',
      'AI 답변이 비어 있습니다. 전송 버튼으로 다시 요청해 주세요.',
      502,
    );
  }
  if (!validApiResponse(path, body)) {
    throw new ApiRequestError(
      'INTERNAL_ERROR',
      '서버 응답을 읽지 못했습니다. 다시 시도해 주세요.',
      res.status,
    );
  }
  return body as T;
}
