// 로그인 사용자 검색어 대시보드: 슬롯 등록/변경(즉시 1회 조회)과 매일 일괄 갱신.
// 조회 1회 = search.list 최대 4회. 사용자별 일일 한도(기본 40)와 서비스 전체 검색 예산을 호출 전에 예약한다.
import { createHash } from 'node:crypto';
import { buildPayload, kstDay, scheduledHour } from './collect.js';
import { ApiFailure } from './http.js';
import { serviceRpc } from './supabase.js';
import { reserveSearch, settleUsage, tryReserveSearch } from './usage.js';
import { collectSearchSnapshot, type PopularSnapshot, type SearchConditions } from './youtube.js';

/** 신규 조회 1회가 소비하는 검색 호출 수(최대 4페이지) */
export const SEARCH_UNITS = 4;
/** 같은 조건의 집합에 이 시간 안의 완료 수집이 있으면 새로 조회하지 않고 재사용(임시값) */
export const SHARE_FRESH_HOURS = 6;
/** 서비스 전체 하루 검색 호출 상한(운영자 내부 기준: 알파 2명×40회. 공식 기본 한도는 100회/일) */
const DEFAULT_SEARCH_CAP = 80;
const DEFAULT_YOUTUBE_CAP = 1000;
/** 영상·채널 보완 호출 예약(최대 4+4) */
const RESERVED_UNITS = 8;
/** 한 번의 일괄 호출에서 처리하는 집합 수(함수 실행시간 제한 대비). 나머지는 다음 호출이 이어받는다. */
export const BATCH_LIMIT = 8;

const ORDERS = ['relevance', 'date', 'viewCount'] as const;
const WINDOWS = ['', '1d', '7d', '30d'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SlotInput extends SearchConditions {
  slot: 1 | 2;
  requestId: string;
}

const bad = (message: string) => new ApiFailure('BAD_REQUEST', message, 400);

/** 검색어는 공백을 정리하고 소문자로 맞춘다(같은 조건의 집합을 공유하기 위함). */
export function normalizeQuery(value: unknown): string {
  if (typeof value !== 'string') throw bad('검색어를 입력해 주세요.');
  const query = value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const length = Array.from(query).length;
  if (length < 1 || length > 100) throw bad('검색어는 1~100자로 입력해 주세요.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(query)) throw bad('검색어에 사용할 수 없는 문자가 있습니다.');
  return query;
}

export function parseSlotInput(body: unknown): SlotInput {
  if (!body || typeof body !== 'object') throw bad('요청 형식이 올바르지 않습니다.');
  const {
    slot,
    query,
    order = 'relevance',
    window = '',
    requestId,
  } = body as Record<string, unknown>;
  if (slot !== 1 && slot !== 2) throw bad('슬롯은 1 또는 2여야 합니다.');
  if (!ORDERS.includes(order as never)) throw bad('정렬 값이 올바르지 않습니다.');
  if (!WINDOWS.includes(window as never)) throw bad('게시 기간 값이 올바르지 않습니다.');
  if (typeof requestId !== 'string' || !UUID.test(requestId))
    throw bad('요청 ID가 올바르지 않습니다.');
  return {
    slot,
    query: normalizeQuery(query),
    order: order as SlotInput['order'],
    window: window as SlotInput['window'],
    requestId: requestId.toLowerCase(),
  };
}

export type SearchCollect = (
  conditions: SearchConditions,
  now: Date,
) => Promise<PopularSnapshot & { searchCalls: number }>;

function rows<T>(body: unknown): T[] {
  if (!Array.isArray(body))
    throw new ApiFailure('UPSTREAM_ERROR', '데이터 저장소 응답이 올바르지 않습니다.', 502);
  return body as T[];
}

async function ensureBudgets(now: Date): Promise<void> {
  const day = kstDay(now);
  await serviceRpc('ensure_quota_row', {
    p_kind: 'search',
    p_day: day,
    p_cap: Number(process.env.SEARCH_DAILY_CAP) || DEFAULT_SEARCH_CAP,
  });
  await serviceRpc('ensure_quota_row', {
    p_kind: 'youtube_units',
    p_day: day,
    p_cap: Number(process.env.YOUTUBE_DAILY_UNIT_CAP) || DEFAULT_YOUTUBE_CAP,
  });
}

export interface SetResult {
  state:
    | 'complete'
    | 'done'
    | 'busy'
    | 'storage_hold'
    | 'inactive'
    | 'budget_exhausted'
    | 'incomplete'
    | 'store_failed';
  runId: number | null;
  items?: number;
  errorCode?: string;
  /** YouTube를 한 번이라도 호출했는지(정산에 사용) */
  called: boolean;
}

/** 한 검색 집합의 수집(시작 → 예산 → 수집 → 적재/실패 기록). 사용자 예약은 호출하는 쪽이 정산한다. */
export async function collectSet(
  setId: number,
  conditions: SearchConditions,
  now: Date,
  collect: SearchCollect = collectSearchSnapshot,
): Promise<SetResult> {
  const scheduledFor = scheduledHour(now).toISOString();
  const [started] = rows<{ state: string; run_id: number | null }>(
    await serviceRpc('start_search_run', {
      p_set: setId,
      p_scheduled_for: scheduledFor,
      p_now: now.toISOString(),
    }),
  );
  if (!started)
    throw new ApiFailure('UPSTREAM_ERROR', '데이터 저장소 응답이 올바르지 않습니다.', 502);
  if (started.state !== 'started')
    return { state: started.state as SetResult['state'], runId: started.run_id, called: false };
  const runId = started.run_id as number;
  const fail = async (status: 'partial' | 'failed', code: string, pages: number, units: number) => {
    await serviceRpc('fail_search_run', {
      p_run: runId,
      p_status: status,
      p_error: code,
      p_pages: pages,
      p_units: units,
      p_now: new Date().toISOString(),
    }).catch(() => undefined);
  };

  try {
    const granted = await serviceRpc('try_consume_quota', {
      p_kind: 'youtube_units',
      p_day: kstDay(now),
      p_units: RESERVED_UNITS,
    });
    if (granted !== true) {
      await fail('failed', 'BUDGET_EXHAUSTED', 0, 0);
      return { state: 'budget_exhausted', runId, called: false };
    }
  } catch {
    await fail('failed', 'BUDGET_ERROR', 0, 0);
    return { state: 'store_failed', runId, errorCode: 'BUDGET_ERROR', called: false };
  }

  const snapshot = await collect(conditions, now);
  const called = snapshot.searchCalls > 0 || snapshot.units > 0;
  if (!snapshot.complete) {
    await fail(
      snapshot.pagesFetched > 0 ? 'partial' : 'failed',
      snapshot.errorCode ?? 'INTERNAL_ERROR',
      snapshot.pagesFetched,
      snapshot.units + snapshot.searchCalls,
    );
    return { state: 'incomplete', runId, errorCode: snapshot.errorCode, called };
  }
  const finishedAt = new Date().toISOString();
  try {
    await serviceRpc('finish_search_run', {
      p_run: runId,
      p_payload: buildPayload(
        { ...snapshot, units: snapshot.units + snapshot.searchCalls },
        now.toISOString(),
        finishedAt,
      ),
      p_now: finishedAt,
    });
  } catch {
    await fail(
      'failed',
      'STORE_ERROR',
      snapshot.pagesFetched,
      snapshot.units + snapshot.searchCalls,
    );
    return { state: 'store_failed', runId, errorCode: 'STORE_ERROR', called };
  }
  return { state: 'complete', runId, items: snapshot.videos.length, called };
}

export interface RegisterResult {
  slot: 1 | 2;
  setId: number;
  /** shared_fresh: 최근 수집을 재사용(검색 호출 없음), duplicate: 같은 요청 ID의 재전송 */
  state: SetResult['state'] | 'shared_fresh' | 'duplicate';
  items?: number;
  errorCode?: string;
}

/**
 * 슬롯 등록·변경. 순서: (재사용 가능?) → 한도 예약(실패하면 슬롯 변경 없음) → 슬롯 저장 → 즉시 1회 수집 → 정산.
 * 검색어를 바꾸면 새 집합이 되어 이전 시계열과 이어지지 않는다.
 */
export async function registerSearchSlot(
  userId: string,
  input: SlotInput,
  now: Date = new Date(),
  collect: SearchCollect = collectSearchSnapshot,
): Promise<RegisterResult> {
  const setSlot = async () =>
    Number(
      await serviceRpc('set_search_slot', {
        p_user: userId,
        p_slot: input.slot,
        p_query: input.query,
        p_region: 'KR',
        p_language: 'ko',
        p_order: input.order,
        p_window: input.window,
      }),
    );

  const [fresh] = rows<{ set_id: number | null; fresh: boolean }>(
    await serviceRpc('search_set_freshness', {
      p_query: input.query,
      p_language: 'ko',
      p_order: input.order,
      p_window: input.window,
      p_now: now.toISOString(),
      p_fresh_hours: SHARE_FRESH_HOURS,
    }),
  );
  if (fresh?.fresh) {
    const setId = await setSlot();
    return { slot: input.slot, setId, state: 'shared_fresh' };
  }

  await ensureBudgets(now);
  const reservation = await reserveSearch(userId, input.requestId, SEARCH_UNITS, now);
  if (reservation.duplicate) {
    // 같은 요청의 재전송은 다시 호출하지 않는다. 결과는 조회 API로 확인한다.
    return { slot: input.slot, setId: await setSlot(), state: 'duplicate' };
  }
  let outcome: 'settled' | 'released' | 'failed_unknown' = 'failed_unknown';
  try {
    const setId = await setSlot();
    const result = await collectSet(setId, input, now, collect);
    outcome = result.called ? 'settled' : 'released';
    return {
      slot: input.slot,
      setId,
      state: result.state,
      items: result.items,
      errorCode: result.errorCode,
    };
  } finally {
    // 호출 여부를 알 수 없는 예외는 사용량을 유지한다.
    await settleUsage(userId, reservation.id, outcome).catch(() => undefined);
  }
}

function requestIdFor(setId: number, scheduledFor: string, userId: string): string {
  const h = createHash('sha256').update(`${setId}:${scheduledFor}:${userId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface BatchSummary {
  scheduledFor: string;
  sets: {
    setId: number;
    state: SetResult['state'] | 'quota_skipped';
    items?: number;
    errorCode?: string;
  }[];
  remaining: number;
}

/**
 * 매일 일괄 갱신. 활성 집합마다 한 번만 수집하고, 비용(검색 4회)은 구독 사용자 각자의 하루 한도에서 차감한다.
 * 서비스 전체 검색 예산은 집합당 한 번만 소비한다. 아무도 부담할 수 없으면 건너뛴다.
 */
export async function runSearchBatch(
  now: Date = new Date(),
  collect: SearchCollect = collectSearchSnapshot,
): Promise<BatchSummary> {
  const scheduledFor = scheduledHour(now).toISOString();
  const active = rows<{
    set_id: number;
    query_norm: string;
    order_by: SearchConditions['order'];
    published_window: SearchConditions['window'];
    users: string[];
  }>(await serviceRpc('list_active_search_sets', { p_scheduled_for: scheduledFor }));
  const summary: BatchSummary = {
    scheduledFor,
    sets: [],
    remaining: Math.max(active.length - BATCH_LIMIT, 0),
  };
  if (!active.length) return summary;
  await ensureBudgets(now);

  for (const set of active.slice(0, BATCH_LIMIT)) {
    const reservations: { userId: string; id: string }[] = [];
    let globalPaid = false;
    let budgetGone = false;
    for (const userId of set.users) {
      const reserved = await tryReserveSearch(
        userId,
        requestIdFor(set.set_id, scheduledFor, userId),
        SEARCH_UNITS,
        !globalPaid,
        now,
      );
      if (reserved.status === 'global_limit') {
        budgetGone = true;
        break;
      }
      if (reserved.status === 'ok' || reserved.status === 'duplicate') {
        if (reserved.id) reservations.push({ userId, id: reserved.id });
        if (reserved.status === 'ok' && !globalPaid) globalPaid = true;
        // 재시도에서 이미 예약된 사용자가 전역을 부담했다고 가정하지 않는다: duplicate는 새 소비가 없다.
      }
    }
    if (!globalPaid && !reservations.length) {
      summary.sets.push({
        setId: set.set_id,
        state: budgetGone ? 'budget_exhausted' : 'quota_skipped',
      });
      if (budgetGone) break;
      continue;
    }
    let outcome: 'settled' | 'released' | 'failed_unknown' = 'failed_unknown';
    try {
      const result = await collectSet(
        set.set_id,
        { query: set.query_norm, order: set.order_by, window: set.published_window },
        now,
        collect,
      );
      outcome = result.called ? 'settled' : 'released';
      summary.sets.push({
        setId: set.set_id,
        state: result.state,
        items: result.items,
        errorCode: result.errorCode,
      });
    } finally {
      for (const reservation of reservations)
        await settleUsage(reservation.userId, reservation.id, outcome).catch(() => undefined);
    }
  }
  return summary;
}
