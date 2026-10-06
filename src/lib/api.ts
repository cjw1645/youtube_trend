// 클라이언트는 이 모듈을 통해 /api/*만 호출한다 (YouTube·Gemini 직접 호출 금지).
import type { ApiError, ApiErrorCode } from '../types/video';

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
  let res: Response;
  try {
    res = await fetch(path, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiRequestError('NETWORK_ERROR', '서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.', 0);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body as Partial<ApiError> | null;
    throw new ApiRequestError(
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `요청에 실패했습니다. (HTTP ${res.status})`,
      res.status,
    );
  }
  return body as T;
}
