// AI·검색 호출 전 원자적 예약. 실제 외부 호출(Gemini/YouTube) 이전에 예약하고 끝나면 정산한다.
import { ApiFailure } from './http.js';
import { serviceRpc } from './supabase.js';

type ReserveRow = { status: string; reservation_id: string | null; retry_after_seconds?: number };

function first(body: unknown): ReserveRow {
  const row: unknown = Array.isArray(body) ? body[0] : null;
  if (!row || typeof (row as ReserveRow).status !== 'string')
    throw new ApiFailure('UPSTREAM_ERROR', '사용량 저장소 응답이 올바르지 않습니다.', 502);
  return row as ReserveRow;
}

const BLOCKED: Record<string, string> = {
  in_flight: '이전 질문을 처리 중입니다. 완료된 뒤 다시 시도해 주세요.',
  daily_limit: '오늘 사용할 수 있는 횟수를 모두 사용했습니다.',
  global_limit: '서비스 전체 무료 사용량이 소진되었습니다. 나중에 다시 시도해 주세요.',
};

/**
 * 사용자별 하루 한도. DB 함수 reserve_ai_request·reserve_search의 p_daily_limit 기본값과 같아야 한다
 * (tests/test-usage-summary.ts가 SQL 기본값과 같은지 확인한다). 화면의 남은 횟수 표시에만 쓰고 차단은 DB가 한다.
 */
export const AI_DAILY_LIMIT = 10;
export const SEARCH_DAILY_LIMIT = 40;

export interface UsageSummary {
  ai: { used: number; limit: number };
  search: { used: number; limit: number };
}

/** 오늘(Asia/Seoul) 이 사용자가 쓴 AI 질문·검색 횟수와 하루 한도. */
export async function getUsageSummary(
  userId: string,
  now: Date = new Date(),
): Promise<UsageSummary> {
  const raw = (await serviceRpc('get_usage_summary', {
    p_user: userId,
    p_now: now.toISOString(),
  })) as { aiUsed?: unknown; searchUsed?: unknown } | null;
  if (!raw || typeof raw.aiUsed !== 'number' || typeof raw.searchUsed !== 'number')
    throw new ApiFailure('UPSTREAM_ERROR', '사용량을 읽지 못했습니다.', 502);
  return {
    ai: { used: raw.aiUsed, limit: AI_DAILY_LIMIT },
    search: { used: raw.searchUsed, limit: SEARCH_DAILY_LIMIT },
  };
}

export type Reservation = { id: string; duplicate: boolean };

function allowed(row: ReserveRow): Reservation | null {
  return row.status === 'ok' || row.status === 'duplicate'
    ? { id: row.reservation_id as string, duplicate: row.status === 'duplicate' }
    : null;
}

/** 허용되면 예약 id를 반환한다. 한도·간격·진행 중 차단은 429로 구분 안내한다. 저장소 장애면 예외를 던져 외부 호출을 막는다. */
export async function reserveAi(userId: string, requestId: string): Promise<Reservation> {
  const row = first(
    await serviceRpc('reserve_ai_request', { p_user: userId, p_request: requestId }),
  );
  const ok = allowed(row);
  if (ok) return ok;
  if (row.status === 'too_soon')
    throw new ApiFailure(
      'QUOTA_EXCEEDED',
      `다음 질문까지 ${row.retry_after_seconds ?? 30}초 기다려 주세요.`,
      429,
    );
  throw new ApiFailure('QUOTA_EXCEEDED', BLOCKED[row.status] ?? '요청을 처리할 수 없습니다.', 429);
}

export async function reserveSearch(
  userId: string,
  requestId: string,
  units = 1,
  now: Date = new Date(),
): Promise<Reservation> {
  const row = first(
    await serviceRpc('reserve_search', {
      p_user: userId,
      p_request: requestId,
      p_units: units,
      p_now: now.toISOString(),
    }),
  );
  const ok = allowed(row);
  if (ok) return ok;
  throw new ApiFailure('QUOTA_EXCEEDED', BLOCKED[row.status] ?? '요청을 처리할 수 없습니다.', 429);
}

/** settled=호출함, released=확실히 호출 전 실패(사용량 반환), failed_unknown=호출 여부 불명(사용량 유지) */
export async function settleUsage(
  userId: string,
  reservationId: string,
  status: 'settled' | 'released' | 'failed_unknown',
): Promise<void> {
  await serviceRpc('settle_usage', {
    p_user: userId,
    p_reservation: reservationId,
    p_status: status,
  });
}

/** 한도 초과를 예외로 바꾸지 않고 상태를 돌려준다(일괄 갱신에서 사용자별로 계속 진행하기 위함). */
export async function tryReserveSearch(
  userId: string,
  requestId: string,
  units: number,
  chargeGlobal: boolean,
  now: Date = new Date(),
): Promise<{ status: string; id: string | null }> {
  const row = first(
    await serviceRpc('reserve_search', {
      p_user: userId,
      p_request: requestId,
      p_units: units,
      p_now: now.toISOString(),
      p_charge_global: chargeGlobal,
    }),
  );
  return { status: row.status, id: row.reservation_id };
}
