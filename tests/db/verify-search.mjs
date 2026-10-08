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
let checks = 0;
const ok = (n) => (checks++, console.log('  ok', n));
const n = async (sql) => Number((await q(`select count(*) c from ${sql}`)).rows[0].c);
const user = async () => (await q(`insert into auth.users default values returning id`)).rows[0].id;
const T = (h) => new Date(Date.parse('2026-10-08T00:00:00Z') + h * 3600_000).toISOString();
const vid = (i) => `vid${String(i).padStart(8, '0')}`;
const payload = (count, tag = '') => ({
  pages_fetched: Math.max(1, Math.ceil(count / 50)),
  units: 5,
  finished_at: T(0),
  videos: Array.from({ length: count }, (_, k) => ({
    video_id: vid(k + 1),
    position: k + 1,
    content_hash: `h${tag}${k}`,
    title: `검색${tag}${k}`,
    description: '',
    tags: [],
    category_id: '22',
    channel_id: `UC${k % 3}`,
    published_at: '2026-10-01T00:00:00Z',
    duration_seconds: 60,
    thumbnail_url: null,
    view_count: k === 0 ? null : 0,
    like_count: 1,
    comment_count: 2,
    observed_at: T(0),
  })),
  channels: [0, 1, 2].map((k) => ({
    channel_id: `UC${k}`,
    content_hash: `c${k}`,
    title: `채널${k}`,
    thumbnail_url: null,
    subscriber_count: 10 + k,
    subscribers_hidden: false,
    observed_at: T(0),
  })),
});
const slot = async (u, s, query, order = 'relevance', window = '') =>
  (
    await svc(`select set_search_slot($1,$2::smallint,$3,'KR','ko',$4,$5) id`, [
      u,
      s,
      query,
      order,
      window,
    ])
  ).rows[0].id;
const start = async (set, at, now = at, hold = 419430400) =>
  (
    await svc(`select * from start_search_run($1,$2::timestamptz,$3::timestamptz,$4)`, [
      set,
      at,
      now,
      hold,
    ])
  ).rows[0];
const finish = (run, p, now = T(0)) =>
  svc(`select finish_search_run($1,$2::jsonb,$3::timestamptz) r`, [run, JSON.stringify(p), now]);

const A = await user();
const B = await user();

// 1. 구독자 없는 집합은 수집 안 함, 있으면 시작·busy·done
const orphan = (
  await q(`insert into search_sets (query_norm, language) values ('고아','ko') returning id`)
).rows[0].id;
assert.equal((await start(orphan, T(0))).state, 'inactive');
const s1 = await slot(A, 1, '먹방', 'viewCount', '7d');
const r1 = await start(s1, T(0));
assert.equal(r1.state, 'started');
assert.equal((await start(s1, T(0), T(0.05))).state, 'busy');
assert.equal((await finish(r1.run_id, payload(120))).rows[0].r, 'complete');
assert.equal((await start(s1, T(0), T(0.5))).state, 'done');
const row = (
  await q(
    `select kind, region, expires_at - scheduled_for as d, pages_expected, item_count from collection_runs where id=${r1.run_id}`,
  )
).rows[0];
assert.deepEqual(
  [row.kind, row.region, row.pages_expected, row.item_count],
  ['search', 'KR', 3, 120],
);
assert.equal(
  Number(
    (
      await q(
        `select extract(epoch from expires_at - scheduled_for)/86400 d from collection_runs where id=${r1.run_id}`,
      )
    ).rows[0].d,
  ),
  14,
);
ok('구독자 없는 집합 inactive, 시작/busy/done, 14일 보존, 3페이지 120개');

// 2. 검색은 0개도 완료, 인기는 0개 거부, 실패는 비공개
const s2 = await slot(A, 2, '희귀검색어');
const r2 = await start(s2, T(0));
assert.equal((await finish(r2.run_id, payload(0))).rows[0].r, 'complete');
assert.equal(
  Number(
    (await q(`select item_count from collection_runs where id=${r2.run_id}`)).rows[0].item_count,
  ),
  0,
);
assert.equal((await finish(r2.run_id, payload(3))).rows[0].r, 'not_running'); // 이미 완료된 run 재완료 불가
const pop = (await svc(`select * from start_popular_run($1::timestamptz)`, [T(0)])).rows[0];
await assert.rejects(
  svc(`select finish_popular_run($1,$2::jsonb) r`, [pop.run_id, JSON.stringify(payload(0))]),
  /out of range/,
);
const r2b = await start(s2, T(1));
await svc(`select fail_search_run($1,'partial','UPSTREAM_ERROR',1::smallint,3,$2::timestamptz)`, [
  r2b.run_id,
  T(1),
]);
assert.equal(
  (await q(`select status from collection_runs where id=${r2b.run_id}`)).rows[0].status,
  'partial',
);
assert.equal((await start(s2, T(1), T(1.2))).state, 'started'); // 같은 시각 재시도
ok('검색 0개 결과는 완료, 인기 0개는 거부, 부분 실패 후 같은 시각 재시도');

// 3. 신선도: 조건이 모두 같아야 재사용
const f = async (query, order, window, now, hours = 6) =>
  (
    await svc(`select * from search_set_freshness($1,'ko',$2,$3,$4::timestamptz,$5)`, [
      query,
      order,
      window,
      now,
      hours,
    ])
  ).rows[0];
assert.deepEqual(await f('  먹방 ', 'viewCount', '7d', T(2)), { set_id: s1, fresh: true });
assert.equal((await f('먹방', 'viewCount', '7d', T(7))).fresh, false); // 6시간 초과
assert.deepEqual(await f('먹방', 'date', '7d', T(2)), { set_id: null, fresh: false }); // 정렬이 다르면 다른 집합
assert.deepEqual(await f('먹방', 'viewCount', '30d', T(2)), { set_id: null, fresh: false }); // 기간이 다르면 다른 집합
assert.equal((await f('먹방', 'viewCount', '7d', T(5.9999))).fresh, true);
ok('신선도: 정규화 후 모든 조건이 같을 때만 재사용, 6시간 경계');

// 4. 공유 집합과 일괄 대상
const s1b = await slot(B, 1, '먹방', 'viewCount', '7d');
assert.equal(s1b, s1);
const list = (await svc(`select * from list_active_search_sets($1::timestamptz)`, [T(24)])).rows;
const shared = list.find((x) => x.set_id === s1);
assert.equal(shared.users.length, 2);
assert.deepEqual([...shared.users].sort(), [A, B].sort());
assert.ok(!list.some((x) => x.set_id === orphan));
const r1next = await start(s1, T(24));
await finish(r1next.run_id, payload(10), T(24));
assert.ok(
  !(await svc(`select * from list_active_search_sets($1::timestamptz)`, [T(24)])).rows.some(
    (x) => x.set_id === s1,
  ),
);
assert.ok(
  (await svc(`select * from list_active_search_sets($1::timestamptz)`, [T(25)])).rows.some(
    (x) => x.set_id === s1,
  ),
);
ok('일괄 대상: 구독자 있는 집합만, 공유 집합은 한 행에 사용자 목록, 완료된 시각은 제외');

// 5. 사용자 조회와 격리, 관측 시작·지연
const view = (u, slotNo = null, vids = false, now = T(26)) =>
  svc(`select get_search_slot_view($1, $2::smallint, $3, $4::timestamptz) v`, [
    u,
    slotNo,
    vids,
    now,
  ]).then((r) => r.rows[0].v);
const va = await view(A, 1, true);
assert.equal(va.slots.length, 1);
const sl = va.slots[0];
assert.deepEqual(sl.conditions, {
  query: '먹방',
  order: 'viewCount',
  window: '7d',
  region: 'KR',
  language: 'ko',
});
assert.equal(sl.snapshot.videos.length, 10);
assert.equal(sl.lag_minutes, 120);
assert.equal(Date.parse(sl.observation_started_at), Date.parse(T(0))); // 첫 관측 시각
assert.equal(sl.snapshot.videos[0].view_count, null);
assert.equal(sl.snapshot.videos[0].subscriber_count, 10);
assert.equal((await view(A)).slots.length, 2);
assert.equal((await view(A, null, false)).slots[0].snapshot.videos, undefined); // 목록에는 영상 미포함
assert.equal((await view(await user())).slots.length, 0); // 다른 사용자는 없음
// 브라우저 역할의 직접 접근 불가
await assert.rejects(
  as(db, 'authenticated', A, `select get_search_slot_view('${A}')`),
  /permission denied/,
);
assert.equal(
  (
    await as(
      db,
      'authenticated',
      B,
      `select 1 from video_observations o join collection_runs r on r.id=o.run_id where r.kind='search'`,
    )
  ).rows.length > 0,
  true,
); // B도 같은 집합 구독자
const C = await user();
assert.equal(
  (
    await as(
      db,
      'authenticated',
      C,
      `select 1 from video_observations o join collection_runs r on r.id=o.run_id where r.kind='search'`,
    )
  ).rows.length,
  0,
);
ok('슬롯 조회: 조건·지연·관측 시작·영상, 타 사용자 격리, 직접 RPC 불가');

// 6. 슬롯 변경: 새 집합은 관측 시작 전, 이전 집합 데이터는 연결 끊김
await slot(A, 1, '게임');
const after = (await view(A, 1, true)).slots[0];
assert.equal(after.snapshot, null);
assert.equal(after.observation_started_at, null);
assert.equal(after.last_attempt, null);
assert.equal(
  (
    await as(
      db,
      'authenticated',
      A,
      `select 1 from video_observations o join collection_runs r on r.id=o.run_id where r.search_set_id=${s1}`,
    )
  ).rows.length,
  0,
);
assert.equal((await view(B, 1)).slots[0].snapshot.item_count, 10); // B의 집합은 그대로
ok('슬롯 변경은 새 집합으로 연결(연속 시계열 아님), 이전 데이터 접근 차단, 다른 구독자 영향 없음');

// 7. 예약: 전역 소비 없는 개인 예약과 반환
await q(`insert into quota_counters (kind, day, cap) values ('search','2026-10-08', 100)`);
const rid = (k) => `00000000-0000-0000-0000-${String(k).padStart(12, '0')}`;
const rs = (u, k, global) =>
  svc(`select * from reserve_search($1,$2,4,'2026-10-08T03:00:00Z',40,$3) r`, [
    u,
    rid(k),
    global,
  ]).then((r) => r.rows[0]);
const used = async () =>
  Number((await q(`select used from quota_counters where kind='search'`)).rows[0].used);
const p1 = await rs(A, 1, true);
const p2 = await rs(B, 2, false);
assert.equal(p1.status, 'ok');
assert.equal(p2.status, 'ok');
assert.equal(await used(), 4); // 전역은 한 번만
await svc(`select settle_usage($1,$2,'released')`, [B, p2.reservation_id]);
assert.equal(await used(), 4); // 전역 미소비 예약은 반환해도 전역 사용량 불변
await svc(`select settle_usage($1,$2,'released')`, [A, p1.reservation_id]);
assert.equal(await used(), 0);
// B는 released라 개인 사용량에서도 빠짐, A는 40회까지
for (let k = 0; k < 10; k++) assert.equal((await rs(A, 100 + k, true)).status, 'ok');
assert.equal((await rs(A, 200, true)).status, 'daily_limit');
ok('개인 예약: 공유 집합 전역 예산 1회만 소비, 미소비 예약 반환 시 전역 불변, 개인 40회 상한');

console.log(`PASS: ${checks}개 그룹 (합성 데이터, 로컬 PGlite, 실제 API·DB 0회)`);
await db.close();
