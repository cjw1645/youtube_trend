import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createDb } from './db/harness.mjs';
// 개인 검색 수집(등록·변경·재사용·한도·일괄 갱신)을 서버 코드와 실제 SQL 함수(로컬 PGlite)로 통합 검증한다.
// YouTube와 PostgREST는 모의/브리지이며 데이터는 모두 합성이다. 실제 호출 0회.

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-placeholder';
process.env.YOUTUBE_API_KEY = 'test-placeholder';
const SECRET = 'collect-secret-placeholder-0123456789abcdef';
process.env.COLLECT_SECRET = SECRET;

const db = await createDb();
const CASTS: Record<string, string> = {
  p_payload: 'jsonb',
  p_now: 'timestamptz',
  p_scheduled_for: 'timestamptz',
  p_day: 'date',
};
let youtubeCalls: URL[] = [];
let ytHandler: (url: URL) => Response = () => new Response('{}', { status: 500 });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname === 'www.googleapis.com') {
    youtubeCalls.push(url);
    return ytHandler(url);
  }
  const match = /\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
  if (url.hostname === 'proj.supabase.co' && match) {
    const fn = match[1];
    const args = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const names = Object.keys(args);
    const params = names.map((name) =>
      name === 'p_payload' ? JSON.stringify(args[name]) : args[name],
    );
    const call = names
      .map((name, i) => `${name} := $${i + 1}${CASTS[name] ? `::${CASTS[name]}` : ''}`)
      .join(', ');
    await db.exec('set role service_role');
    try {
      const result = await db.query<Record<string, unknown>>(
        `select * from ${fn}(${call})`,
        params,
      );
      const scalar = result.fields.length === 1 && result.fields[0].name === fn;
      return new Response(JSON.stringify(scalar ? result.rows[0][fn] : result.rows), {
        status: 200,
      });
    } catch (error) {
      return new Response(JSON.stringify({ message: String(error) }), { status: 400 });
    } finally {
      await db.exec('reset role');
    }
  }
  return realFetch(input, init);
}) as typeof fetch;

const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const vid = (i: number) => `vid${String(i).padStart(8, '0')}`;
const raw = (i: number) => ({
  id: vid(i),
  snippet: {
    publishedAt: '2026-10-01T00:00:00Z',
    channelId: `UC${String(i % 30).padStart(4, '0')}`,
    channelTitle: 'c',
    title: `검색 ${i}`,
    description: '',
    thumbnails: { high: { url: 'https://i/x.jpg' } },
    categoryId: '22',
  },
  statistics: { viewCount: String(i) },
  contentDetails: { duration: 'PT1M' },
});
/** pages: 검색 페이지별 영상 번호. missing: videos.list에서 사라진 번호. */
function youtube(pages: number[][], opts: { failSearchPage?: number; missing?: number[] } = {}) {
  ytHandler = (url) => {
    const name = url.pathname.split('/').pop();
    if (name === 'search') {
      const page = url.searchParams.get('pageToken')
        ? Number(url.searchParams.get('pageToken'))
        : 0;
      if (opts.failSearchPage === page + 1)
        return new Response('{"error":{"errors":[{"reason":"backendError"}]}}', { status: 500 });
      return new Response(
        JSON.stringify({
          items: (pages[page] ?? []).map((i) => ({ id: { videoId: vid(i) } })),
          ...(page + 1 < pages.length ? { nextPageToken: String(page + 1) } : {}),
        }),
      );
    }
    if (name === 'videos') {
      const ids = (url.searchParams.get('id') ?? '').split(',');
      const gone = new Set((opts.missing ?? []).map(vid));
      return new Response(
        JSON.stringify({
          items: ids
            .filter((id) => !gone.has(id))
            .map((id) => raw(Number(id.slice(3))))
            .reverse(),
        }), // 응답 순서는 요청과 다르다
      );
    }
    if (name === 'channels') {
      const ids = (url.searchParams.get('id') ?? '').split(',');
      return new Response(
        JSON.stringify({
          items: ids.map((id) => ({
            id,
            snippet: { title: id, thumbnails: {} },
            statistics: { subscriberCount: '5' },
          })),
        }),
      );
    }
    return new Response('{}', { status: 404 });
  };
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const q = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
const count = async (sql: string) => Number((await q(`select count(*) c from ${sql}`))[0].c);
const reset = () => (youtubeCalls = []);
const searchCalls = () => youtubeCalls.filter((u) => u.pathname.endsWith('/search')).length;
const user = async () =>
  (await q(`insert into auth.users default values returning id`))[0].id as string;
let seq = 0;
const rid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const used = async (kind: string, day = '2026-10-08') =>
  Number(
    (await q(`select used from quota_counters where kind='${kind}' and day='${day}'`))[0]?.used ??
      0,
  );
const NOW = new Date('2026-10-08T03:12:00Z');
const input = (slot: 1 | 2, query: string, extra: Record<string, unknown> = {}) => ({
  slot,
  query,
  order: 'relevance',
  window: '',
  requestId: rid(),
  ...extra,
});

try {
  const search = await vite.ssrLoadModule('/api/_lib/search.ts');
  const { registerSearchSlot, runSearchBatch, parseSlotInput, normalizeQuery, BATCH_LIMIT } =
    search;
  const batchApi = await vite.ssrLoadModule('/api/collect-search.ts');
  const slotsApi = await vite.ssrLoadModule('/api/search-slots.ts');
  const snapApi = await vite.ssrLoadModule('/api/search-snapshot.ts');
  const view = async (userId: string, slot: number | null = null, videos = false, now = NOW) =>
    (
      await q(
        `select get_search_slot_view('${userId}', ${slot === null ? 'null' : `${slot}::smallint`}, ${videos}, '${now.toISOString()}'::timestamptz) v`,
      )
    )[0].v as {
      slots: {
        slot: number;
        snapshot: null | { item_count: number; videos?: { position: number; video_id: string }[] };
        last_attempt: { status: string } | null;
        observation_started_at: string | null;
        conditions: { query: string };
      }[];
    };

  // 1. 입력 검증과 정규화
  assert.equal(normalizeQuery('  Mukbang   먹방 '), 'mukbang 먹방');
  assert.equal(normalizeQuery('A'.repeat(100)), 'a'.repeat(100));
  for (const bad of ['', '   ', 'a'.repeat(101), '\u0000x', 5, null])
    assert.throws(() => normalizeQuery(bad), /./, String(bad));
  assert.equal(Array.from(normalizeQuery('😀'.repeat(100))).length, 100);
  assert.throws(() => normalizeQuery('😀'.repeat(101)));
  for (const body of [
    null,
    {},
    input(3 as never, 'x'),
    input(1, 'x', { order: 'rating' }),
    input(1, 'x', { window: '1y' }),
    input(1, 'x', { requestId: 'nope' }),
    input(1, ''),
  ])
    assert.throws(() => parseSlotInput(body), /./, JSON.stringify(body));
  const parsed = parseSlotInput(input(1, ' 먹방 ', { order: 'viewCount', window: '7d' }));
  assert.deepEqual([parsed.query, parsed.order, parsed.window], ['먹방', 'viewCount', '7d']);

  const A = await user();
  const B = await user();

  // 2. 등록: 3페이지 120개, 조건이 YouTube 요청에 반영, 예약 4 정산, 전역 검색 4·보완 8 소비
  reset();
  youtube([range(1, 50), range(51, 100), range(101, 120)], { missing: [7] });
  const r1 = await registerSearchSlot(
    A,
    parseSlotInput(input(1, '먹방', { order: 'viewCount', window: '7d' })),
    NOW,
  );
  assert.equal(r1.state, 'complete');
  assert.equal(r1.items, 119); // 삭제된 영상 제외
  assert.equal(searchCalls(), 3);
  const first = youtubeCalls.find((u) => u.pathname.endsWith('/search'))!;
  assert.equal(first.searchParams.get('q'), '먹방');
  assert.equal(first.searchParams.get('order'), 'viewCount');
  assert.equal(first.searchParams.get('regionCode'), 'KR');
  assert.equal(first.searchParams.get('relevanceLanguage'), 'ko');
  assert.equal(first.searchParams.get('maxResults'), '50');
  assert.equal(
    Date.parse(first.searchParams.get('publishedAfter')!),
    NOW.getTime() - 7 * 86_400_000,
  );
  assert.equal(youtubeCalls.filter((u) => u.pathname.endsWith('/videos')).length, 3); // 50개 단위 보완
  assert.equal(await count('video_observations'), 119);
  const positions = await q(`select position from video_observations order by position`);
  assert.deepEqual(
    positions.map((p) => p.position),
    range(1, 119),
  ); // 검색 순서 유지·연속
  assert.equal(
    (await q(`select video_id from video_observations where position = 7`))[0].video_id,
    vid(8),
  ); // 사라진 7번 건너뜀
  assert.equal(await used('search'), 4);
  assert.equal(await used('youtube_units'), 8);
  assert.equal(
    (await q(`select status, units from usage_reservations where user_id='${A}'`))[0].status,
    'settled',
  );
  const v1 = await view(A, 1, true);
  assert.equal(v1.slots[0].snapshot!.item_count, 119);
  assert.equal(v1.slots[0].snapshot!.videos!.length, 119);
  assert.equal(Date.parse(v1.slots[0].observation_started_at!), Date.parse('2026-10-08T03:00:00Z'));

  // 3. 같은 조건의 다른 사용자: 최근 수집 재사용(호출 0, 예약 0)
  reset();
  const r2 = await registerSearchSlot(
    B,
    parseSlotInput(input(1, '  먹방 ', { order: 'viewCount', window: '7d' })),
    new Date(NOW.getTime() + 3600_000),
  );
  assert.equal(r2.state, 'shared_fresh');
  assert.equal(youtubeCalls.length, 0);
  assert.equal(await count(`usage_reservations where user_id='${B}'`), 0);
  assert.equal((await view(B, 1)).slots[0].snapshot!.item_count, 119);
  // 조건이 다르면 재사용하지 않는다(정렬 다름)
  reset();
  youtube([range(1, 10)]);
  const r3 = await registerSearchSlot(
    B,
    parseSlotInput(input(2, '먹방', { order: 'date', window: '7d' })),
    new Date(NOW.getTime() + 3600_000),
  );
  assert.equal(r3.state, 'complete');
  assert.equal(searchCalls(), 1);
  assert.equal(await count(`search_sets where query_norm='먹방'`), 2);
  // 6시간 지나면 재조회
  reset();
  youtube([range(1, 5)]);
  const later = new Date(NOW.getTime() + 7 * 3600_000);
  assert.equal(
    (
      await registerSearchSlot(
        B,
        parseSlotInput(input(1, '먹방', { order: 'viewCount', window: '7d' })),
        later,
      )
    ).state,
    'complete',
  );
  assert.equal(searchCalls(), 1);

  // 4. 같은 요청 ID 재전송은 다시 호출하지 않음(재시도는 새 요청 ID로). 이미 완료된 같은 조건은 재사용
  reset();
  youtube([range(1, 20)], { failSearchPage: 1 });
  const dupInput = parseSlotInput(input(2, '게임'));
  assert.equal((await registerSearchSlot(A, dupInput, NOW)).state, 'incomplete');
  const callsAfterFirst = youtubeCalls.length;
  assert.equal((await registerSearchSlot(A, dupInput, NOW)).state, 'duplicate');
  assert.equal(youtubeCalls.length, callsAfterFirst);
  youtube([range(1, 20)]);
  assert.equal(
    (await registerSearchSlot(A, parseSlotInput(input(2, '게임')), NOW)).state,
    'complete',
  ); // 새 요청 ID는 재시도
  assert.equal(
    (await registerSearchSlot(A, parseSlotInput(input(2, '게임')), NOW)).state,
    'shared_fresh',
  );

  // 5. 검색어 변경: 새 집합, 이전 시계열과 연결 안 됨
  reset();
  youtube([range(200, 230)]);
  const oldSet = (
    await q(`select search_set_id s from user_search_slots where user_id='${A}' and slot=1`)
  )[0].s;
  assert.equal(
    (await registerSearchSlot(A, parseSlotInput(input(1, '여행')), NOW)).state,
    'complete',
  );
  const newSet = (
    await q(`select search_set_id s from user_search_slots where user_id='${A}' and slot=1`)
  )[0].s;
  assert.notEqual(oldSet, newSet);
  const v2 = await view(A, 1, true);
  assert.equal(v2.slots[0].conditions.query, '여행');
  assert.equal(v2.slots[0].snapshot!.item_count, 31);
  assert.equal((await view(B, 1)).slots[0].snapshot!.item_count, 5); // B의 먹방 집합은 그대로

  // 6. 부분 실패: 슬롯은 저장, 데이터 비공개, 호출분은 사용량 유지
  reset();
  youtube([range(1, 50), range(51, 100)], { failSearchPage: 2 });
  const beforeUsed = await used('search');
  const r6 = await registerSearchSlot(B, parseSlotInput(input(2, '요리')), NOW);
  assert.deepEqual([r6.state, r6.errorCode], ['incomplete', 'UPSTREAM_ERROR']);
  const v6 = await view(B, 2);
  assert.equal(v6.slots[0].snapshot, null);
  assert.equal(v6.slots[0].last_attempt!.status, 'partial');
  assert.equal(await used('search'), beforeUsed + 4); // 호출했으므로 반환 안 함
  assert.equal(searchCalls(), 2); // 실패 후 자동 재시도 없음

  // 7. 결과 0개도 정상 완료(0으로 취급, 오류 아님)
  reset();
  youtube([[]]);
  const r7 = await registerSearchSlot(B, parseSlotInput(input(2, '결과없음검색어')), NOW);
  assert.deepEqual([r7.state, r7.items], ['complete', 0]);
  assert.equal((await view(B, 2)).slots[0].snapshot!.item_count, 0);

  // 8. 이미 진행 중인 같은 집합: 호출 없이 반환, 예약은 되돌림
  const C = await user();
  const busySet = Number(
    (
      await q(
        `select set_search_slot('${C}', 1::smallint, '진행중', 'KR', 'ko', 'relevance', '') s`,
      )
    )[0].s,
  );
  await q(
    `select * from start_search_run(${busySet}, '2026-10-08T03:00:00Z'::timestamptz, '2026-10-08T03:10:00Z'::timestamptz)`,
  );
  reset();
  const beforeBusy = await used('search');
  const r8 = await registerSearchSlot(C, parseSlotInput(input(1, '진행중')), NOW);
  assert.equal(r8.state, 'busy');
  assert.equal(youtubeCalls.length, 0);
  assert.equal(await used('search'), beforeBusy); // 반환됨
  assert.equal(
    (await q(`select status from usage_reservations where user_id='${C}'`))[0].status,
    'released',
  );

  // 9. 개인 하루 40회: 4회씩 10번까지, 11번째는 429, 슬롯 변경 없음, 호출 없음
  const D = await user();
  youtube([range(1, 3)]);
  let slotBefore: string | undefined;
  let blockedErr: { code?: string; status?: number } | undefined;
  for (let k = 0; k < 11; k += 1) {
    reset();
    try {
      await registerSearchSlot(D, parseSlotInput(input(1, `주제${k}`)), NOW);
      slotBefore = (
        await q(`select search_set_id s from user_search_slots where user_id='${D}' and slot=1`)
      )[0].s as string;
    } catch (error) {
      blockedErr = error as typeof blockedErr;
      assert.equal(youtubeCalls.length, 0);
    }
  }
  assert.deepEqual([blockedErr?.code, blockedErr?.status], ['QUOTA_EXCEEDED', 429]);
  assert.equal(
    (await q(`select search_set_id s from user_search_slots where user_id='${D}' and slot=1`))[0].s,
    slotBefore,
  );
  assert.equal(
    await count(
      `usage_reservations where user_id='${D}' and kind='search' and status <> 'released'`,
    ),
    10,
  );

  // 10. 전체 검색 예산 소진: 호출 없음, 슬롯 변경 없음
  const E = await user();
  await q(`update quota_counters set cap = used where kind = 'search' and day = '2026-10-08'`);
  reset();
  await assert.rejects(
    registerSearchSlot(E, parseSlotInput(input(1, '예산밖')), NOW),
    (error: { status: number; message: string }) =>
      error.status === 429 && /서비스 전체/.test(error.message),
  );
  assert.equal(youtubeCalls.length, 0);
  assert.equal(await count(`user_search_slots where user_id='${E}'`), 0);
  await q(`update quota_counters set cap = 80 where kind = 'search' and day = '2026-10-08'`);

  // 11. 일괄 갱신(다음 날 04:00 KST = 19:00 UTC): 공유 집합은 한 번 호출·전역 예산 1회·사용자 둘 모두 차감
  const batchNow = new Date('2026-10-08T19:00:30Z');
  await q(`delete from usage_reservations`);
  await q(`delete from user_search_slots`);
  const F = await user();
  const G = await user();
  const H = await user();
  for (const [u, s, qq] of [
    [F, 1, '공유'],
    [G, 1, '공유'],
    [F, 2, '단독'],
    [H, 1, '한도초과'],
  ] as const)
    await q(`select set_search_slot('${u}', ${s}::smallint, '${qq}', 'KR', 'ko', 'relevance', '')`);
  // H는 오늘(KST 10일)의 한도를 이미 소진
  await q(
    `insert into quota_counters (kind, day, cap) values ('search','2026-10-09',80),('youtube_units','2026-10-09',1000) on conflict do nothing`,
  );
  await q(
    `insert into usage_reservations (user_id, kind, request_id, units, status, lease_expires_at, created_at) values ('${H}','search','${rid()}',40,'settled','2026-10-09T00:00:00Z','2026-10-08T19:00:00Z')`,
  );
  await q(`update quota_counters set used = 40 where kind='search' and day='2026-10-09'`);
  reset();
  youtube([range(1, 30)]);
  const batch = await runSearchBatch(batchNow);
  const bySet = new Map(
    batch.sets.map((s: { setId: number; state: string }) => [s.setId, s.state]),
  );
  assert.equal(batch.sets.length, 3);
  assert.equal([...bySet.values()].filter((s) => s === 'complete').length, 2); // 공유·단독
  assert.equal([...bySet.values()].filter((s) => s === 'quota_skipped').length, 1); // H만 구독한 집합은 부담할 사람이 없음
  assert.equal(searchCalls(), 2); // 공유 집합 1회 + 단독 1회
  assert.equal(await used('search', '2026-10-09'), 40 + 8); // 전역: 공유 4 + 단독 4
  const charged = async (u: string) =>
    Number(
      (
        await q(
          `select coalesce(sum(units),0) s from usage_reservations where user_id='${u}' and status='settled' and created_at >= '2026-10-08T19:00:00Z'`,
        )
      )[0].s,
    );
  assert.equal(await charged(F), 8); // 공유 4 + 단독 4
  assert.equal(await charged(G), 4); // 공유 4
  // 같은 시각 재실행은 대상 없음(완료됨)
  reset();
  const batch2 = await runSearchBatch(new Date('2026-10-08T19:20:00Z'));
  assert.equal(batch2.sets.filter((s: { state: string }) => s.state === 'complete').length, 0);
  assert.equal(searchCalls(), 0);
  assert.equal((await view(G, 1)).slots[0].snapshot!.item_count, 30);

  // 12. 일괄 갱신 한계: 집합 수가 많으면 BATCH_LIMIT만 처리, 다음 호출이 이어서 처리
  const batch3Now = new Date('2026-10-09T19:00:30Z');
  await q(
    `insert into quota_counters (kind, day, cap) values ('search','2026-10-10',80),('youtube_units','2026-10-10',1000) on conflict do nothing`,
  );
  await q(`delete from user_search_slots`);
  const many = await user();
  // 사용자당 슬롯은 2개이므로 사용자 여럿으로 10개 집합 구성
  const owners = [] as string[];
  for (let k = 0; k < 10; k += 1) {
    const u = await user();
    owners.push(u);
    await q(`select set_search_slot('${u}', 1::smallint, '대량${k}', 'KR', 'ko', 'relevance', '')`);
  }
  void many;
  reset();
  youtube([range(1, 5)]);
  const big = await runSearchBatch(batch3Now);
  assert.equal(big.sets.length, BATCH_LIMIT);
  assert.equal(big.remaining, 10 - BATCH_LIMIT);
  const bigNext = await runSearchBatch(new Date('2026-10-09T19:20:00Z'));
  assert.equal(bigNext.sets.length, 10 - BATCH_LIMIT);
  assert.equal(
    await count(
      `collection_runs where kind='search' and scheduled_for >= '2026-10-09T19:00:00Z' and status='complete'`,
    ),
    10,
  );

  // 13. 일괄 중 전역 예산 소진: 남은 집합은 건너뛰고 YouTube 호출 안 함
  const batch4Now = new Date('2026-10-10T19:00:30Z');
  await q(
    `insert into quota_counters (kind, day, cap, used) values ('search','2026-10-11',4,0),('youtube_units','2026-10-11',1000,0) on conflict do nothing`,
  );
  reset();
  youtube([range(1, 5)]);
  const limited = await runSearchBatch(batch4Now);
  assert.equal(limited.sets.filter((s: { state: string }) => s.state === 'complete').length, 1);
  assert.ok(limited.sets.some((s: { state: string }) => s.state === 'budget_exhausted'));
  assert.equal(searchCalls(), 1);

  // 14. 엔드포인트: 인증 없는 호출 거부(저장소·YouTube 호출 0), 일괄 갱신은 비밀 필요
  reset();
  for (const [handler, method] of [
    [slotsApi.GET, 'GET'],
    [slotsApi.POST, 'POST'],
    [slotsApi.DELETE, 'DELETE'],
    [snapApi.GET, 'GET'],
  ] as const) {
    const res = await handler(
      new Request('http://localhost/api/x?slot=1', {
        method,
        body: method === 'GET' ? undefined : '{}',
      }),
    );
    assert.equal(res.status, 401, method);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal(
    (await batchApi.POST(new Request('http://localhost/api/collect-search', { method: 'POST' })))
      .status,
    401,
  );
  assert.equal(
    (
      await batchApi.POST(
        new Request('http://localhost/api/collect-search', {
          method: 'POST',
          headers: { Authorization: 'Bearer nope' },
        }),
      )
    ).status,
    401,
  );
  assert.equal(youtubeCalls.length, 0);
  assert.equal(batchApi.GET, undefined);

  console.log(
    'PASS: 입력 정규화·검증, 등록(조건 반영·3페이지·삭제영상 제외·검색순서·예약 정산), 동일 조건 재사용(6시간)·조건 다르면 재조회, 재전송 멱등, 검색어 변경 시 집합 분리, 부분 실패 비공개·사용량 유지, 0개 결과, 진행 중 집합 반환·예약 반환, 개인 40회 상한(슬롯 불변), 전체 예산 소진 차단, 일괄 갱신(공유 집합 1회 호출·전역 1회·사용자별 차감·부담자 없음 건너뜀·BATCH_LIMIT·예산 소진 중단), 인증 없는 호출 거부; 실제 호출 0회',
  );
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
  await db.close();
}
