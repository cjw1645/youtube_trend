import assert from 'node:assert/strict';
import { createDb, as } from './harness.mjs';

const db = await createDb();
const q = (sql, p) => db.query(sql, p);
const svc = async (sql, p) => {
  await db.exec('set role service_role');
  try {
    return await db.query(sql, p);
  } finally {
    await db.exec('reset role');
  }
};
const user = async () => (await q(`insert into auth.users default values returning id`)).rows[0].id;
const rid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ai = async (u, n, at) =>
  (await svc(`select * from reserve_ai_request($1, $2, $3::timestamptz)`, [u, rid(n), at])).rows[0];
let checks = 0;
const ok = (n) => (checks++, console.log('  ok', n));

const A = await user();
const B = await user();
// 2026-10-08 12:00 KST. 전역 예산은 KST 일 기준.
const D = '2026-10-08';
const t = (sec) => new Date(Date.parse('2026-10-08T03:00:00Z') + sec * 1000).toISOString();
await q(
  `insert into quota_counters (kind, day, cap) values ('ai_requests', '${D}', 100), ('search', '${D}', 100)`,
);

// 예산 행이 없으면 fail-closed
assert.equal(
  (await svc(`select * from reserve_ai_request($1, $2, '2026-10-09T03:00:00Z')`, [A, rid(900)]))
    .rows[0].status,
  'global_limit',
);
ok('예산 행이 없는 날은 전역 소비 실패(fail-closed)');

// 정상 → 진행 중 → 30초 간격
const r = await ai(A, 1, t(0));
assert.equal(r.status, 'ok');
assert.equal((await ai(A, 2, t(1))).status, 'in_flight');
assert.equal((await ai(A, 1, t(2))).status, 'duplicate'); // 같은 request_id 재전송
assert.equal(
  (await svc(`select settle_usage($1,$2,'settled',$3::timestamptz) s`, [A, r.reservation_id, t(5)]))
    .rows[0].s,
  true,
);
const x = await ai(A, 3, t(20));
assert.equal(x.status, 'too_soon');
assert.equal(x.retry_after_seconds, 10);
assert.equal((await ai(A, 3, t(29.5))).status, 'too_soon');
assert.equal((await ai(A, 3, t(30))).status, 'ok'); // 정확히 30초 경계 허용
ok('진행 중 1건, request_id 재전송 멱등, 30초 경계(29.5초 거부/30초 허용)');

// 다른 사용자는 영향 없음, 남의 예약 정산 불가
const rb = await ai(B, 10, t(1));
assert.equal(rb.status, 'ok');
assert.equal(
  (await svc(`select settle_usage($1,$2,'released') s`, [A, rb.reservation_id])).rows[0].s,
  false,
);
ok('사용자 간 독립, 남의 예약은 정산 불가');

// lease 만료 → failed_unknown, 사용량 유지, 새 요청 가능
const rl = await ai(B, 11, t(500)); // B의 첫 요청은 정산하지 않았다 → lease(120s) 만료
assert.equal(rl.status, 'ok');
assert.equal(
  (await q(`select status from usage_reservations where request_id=$1`, [rid(10)])).rows[0].status,
  'failed_unknown',
);
assert.equal(
  Number(
    (await q(`select used from quota_counters where kind='ai_requests' and day='${D}'`)).rows[0]
      .used,
  ),
  4,
);
ok('lease 만료는 호출 불명 처리하고 개인·전역 사용량을 유지');

// released는 사용량 반환
const used = async () =>
  Number(
    (await q(`select used from quota_counters where kind='ai_requests' and day='${D}'`)).rows[0]
      .used,
  );
const before = await used();
await svc(`select settle_usage($1,$2,'released',$3::timestamptz)`, [B, rl.reservation_id, t(501)]);
assert.equal(await used(), before - 1);
assert.equal(
  (await svc(`select settle_usage($1,$2,'released') s`, [B, rl.reservation_id])).rows[0].s,
  false,
);
ok('released는 전역 사용량 반환, 중복 정산 무시');

// 하루 10회 (11번째 거부) + 다음 KST 날 초기화
const C = await user();
let at = 1000;
for (let i = 0; i < 10; i++) {
  const g = await ai(C, 100 + i, t(at));
  assert.equal(g.status, 'ok', `request ${i}`);
  await svc(`select settle_usage($1,$2,'settled',$3::timestamptz)`, [
    C,
    g.reservation_id,
    t(at + 1),
  ]);
  at += 31;
}
assert.equal((await ai(C, 200, t(at))).status, 'daily_limit');
await q(`insert into quota_counters (kind, day, cap) values ('ai_requests', '2026-10-09', 100)`);
// KST 2026-10-09 00:00 = 2026-10-08T15:00:00Z. 1초 전은 같은 날, 정각은 새 날.
assert.equal(
  (await svc(`select * from reserve_ai_request($1,$2,'2026-10-08T14:59:59Z')`, [C, rid(201)]))
    .rows[0].status,
  'daily_limit',
);
assert.equal(
  (await svc(`select * from reserve_ai_request($1,$2,'2026-10-08T15:00:00Z')`, [C, rid(202)]))
    .rows[0].status,
  'ok',
);
ok('하루 10회 상한(11번째 거부), KST 자정 경계에서 초기화');

// 전역 한도
await q(
  `insert into quota_counters (kind, day, cap, used) values ('ai_requests', '2026-10-10', 1, 0)`,
);
const E = await user();
const F = await user();
assert.equal(
  (await svc(`select * from reserve_ai_request($1,$2,'2026-10-10T03:00:00Z')`, [E, rid(300)]))
    .rows[0].status,
  'ok',
);
assert.equal(
  (await svc(`select * from reserve_ai_request($1,$2,'2026-10-10T03:00:01Z')`, [F, rid(301)]))
    .rows[0].status,
  'global_limit',
);
ok('전역 AI 예산 소진 시 다른 사용자도 거부');

// 검색: 개인 40회 상한
const S = await user();
await q(`insert into quota_counters (kind, day, cap) values ('search', '2026-10-11', 100)`);
const sr = async (n, units = 1) =>
  (
    await svc(`select * from reserve_search($1,$2,$3,'2026-10-11T03:00:00Z')`, [
      S,
      rid(400 + n),
      units,
    ])
  ).rows[0].status;
for (let i = 0; i < 4; i++) assert.equal(await sr(i, 10), 'ok');
assert.equal(await sr(10, 1), 'daily_limit'); // 40 소진
assert.equal(await sr(0, 10), 'duplicate'); // 재전송은 이중 차감 없음
assert.equal(
  (await q(`select used from quota_counters where kind='search' and day='2026-10-11'`)).rows[0]
    .used,
  40,
);
await q(`insert into quota_counters (kind, day, cap, used) values ('search', '2026-10-12', 5, 5)`);
assert.equal(
  (await svc(`select * from reserve_search($1,$2,1,'2026-10-12T03:00:00Z')`, [S, rid(500)])).rows[0]
    .status,
  'global_limit',
);
ok('개인 검색 40회 상한, 재전송 멱등, 전역 검색 예산 소진 구분');

// 슬롯
const U = await user();
const W = await user();
const slot = (u, n, query, order = 'relevance') =>
  svc(`select set_search_slot($1,$2::smallint,$3,'KR','',$4,'') id`, [u, n, query, order]);
const a1 = (await slot(U, 1, '  먹방 ')).rows[0].id;
const b1 = (await slot(W, 1, '먹방')).rows[0].id;
assert.equal(a1, b1); // 정규화 후 전체 조건이 같으면 같은 집합 공유
const a2 = (await slot(U, 2, '먹방', 'date')).rows[0].id;
assert.notEqual(a1, a2); // 조건이 다르면 별도 집합
await assert.rejects(slot(U, 3, '게임'), /invalid slot/);
await assert.rejects(slot(U, 2, '먹방'), /duplicate key/); // 같은 집합을 두 슬롯에 둘 수 없음
await slot(U, 1, '게임'); // 변경
assert.equal(
  (await q(`select count(*) c from user_search_slots where user_id=$1`, [U])).rows[0].c,
  2,
);
assert.equal((await svc(`select clear_search_slot($1, 2::smallint) r`, [U])).rows[0].r, true);
assert.equal((await svc(`select clear_search_slot($1, 2::smallint) r`, [U])).rows[0].r, false);
ok('슬롯 등록·변경·해제, 정규화 공유, 3번째 슬롯·중복 집합 거부');

// 브라우저 역할은 함수 실행 불가
for (const fn of [
  'reserve_ai_request(gen_random_uuid(), gen_random_uuid())',
  'reserve_search(gen_random_uuid(), gen_random_uuid())',
  "set_search_slot(gen_random_uuid(), 1::smallint, 'x')",
  "settle_usage(gen_random_uuid(), gen_random_uuid(), 'released')",
  'clear_search_slot(gen_random_uuid(), 1::smallint)',
]) {
  await assert.rejects(as(db, 'authenticated', A, `select * from ${fn}`), /permission denied/, fn);
  await assert.rejects(as(db, 'anon', null, `select * from ${fn}`), /permission denied/, fn);
}
ok('anon/authenticated는 예약·정산·슬롯 함수 실행 불가(서버 전용)');

console.log(`PASS: ${checks}개 그룹 (합성 데이터, 로컬 PGlite, 실제 API·DB 0회)`);
await db.close();
