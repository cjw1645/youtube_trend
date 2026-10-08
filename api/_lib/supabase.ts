// Supabase REST(PostgREST)·Auth 관리자 호출. 서버 전용: service role 키는 브라우저로 나가지 않는다.
import './env.js';
import { ApiFailure } from './http.js';

interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
}

export function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  if (!url) throw new ApiFailure('CONFIG_ERROR', '서버에 Supabase 설정이 없습니다.', 500);
  return url;
}

function config(needs: 'anon' | 'service'): SupabaseConfig {
  const url = supabaseUrl();
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if ((needs === 'anon' && !anonKey) || (needs === 'service' && !serviceKey))
    throw new ApiFailure('CONFIG_ERROR', '서버에 Supabase 설정이 없습니다.', 500);
  return { url, anonKey, serviceKey };
}

const TIMEOUT_MS = 8000;

async function call(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    const body: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) {
      // DB 오류 원문은 응답에 싣지 않는다.
      if (res.status === 401 || res.status === 403)
        throw new ApiFailure('UNAUTHORIZED', '로그인이 필요하거나 만료되었습니다.', 401);
      if (res.status >= 400 && res.status < 500)
        throw new ApiFailure('BAD_REQUEST', '요청을 처리할 수 없습니다.', 400);
      throw new ApiFailure('UPSTREAM_ERROR', '데이터 저장소에 연결하지 못했습니다.', 502);
    }
    return body;
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    if (controller.signal.aborted)
      throw new ApiFailure('TIMEOUT', '데이터 저장소 응답 시간이 초과되었습니다.', 504);
    throw new ApiFailure('UPSTREAM_ERROR', '데이터 저장소에 연결하지 못했습니다.', 502);
  } finally {
    clearTimeout(timer);
  }
}

/** 사용자 토큰으로 호출해 RLS가 적용된다. userId는 토큰에서만 정해진다. */
export function userRest(
  token: string,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<unknown> {
  const { url, anonKey } = config('anon');
  return call(`${url}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** service role로 서버 전용 SQL 함수를 호출한다(예약·정산·슬롯). */
export function serviceRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { url, serviceKey } = config('service');
  return call(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
}

export function deleteAuthUser(userId: string): Promise<unknown> {
  const { url, serviceKey } = config('service');
  return call(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
}
