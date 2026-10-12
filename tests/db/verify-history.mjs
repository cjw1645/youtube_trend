import assert from 'node:assert/strict';
import { createDb } from './harness.mjs';
// 내 검색어의 지난 수집 원자료(get_slot_history): 날짜별 실행과 약 24시간 전 대비 하루 증가, 업로드 후 경과 시간,
// 검색 기록 28일 보관, 사용자 격리, 권한. 공개 조회 IP별 상한(try_consume_ip_quota)의 원자적 소비도 확인한다.

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
const user = async () => (await q(`insert into auth.users default values returning id`)).rows[0].id;
const T = (h) => new Date(Date.parse('2026-10-08T00:00:00Z') + h * 3600_000).toISOString();
const vid = (i) => `vid${String(i).padStart(8, '0')}`;

// 영상 1–10. 조회수는 views(i), 업로드는 10-01(관측 시점 기준 경과 시간이 날마다 24씩 는다)
const payload = (views, at, freshIds = []) => ({
  pages_fetched: 1,
  units: 5,
  finished_at: at,
  videos: Array.from({ length: 10 }, (_, k) => {
    const i = k + 1;
    return {
      video_id: vid(i),
      position: i,
      content_hash: freshIds.includes(i) ? `h${i}:new` : `h${i}`,
      title: `고양이 ${i}`,
      description: '',
      tags: [],
      category_id: '15',
      channel_id: 'UC0',
      published_at: freshIds.includes(i) ? at : '2026-10-01T00:00:00Z',
      duration_seconds: 60,
      thumbnail_url: null,
      view_count: views(i),
      like_count: 1,
      comment_count: 1,
      observed_at: at,
    };
  }),
  channels: [
    {
      channel_id: 'UC0',
      content_hash: 'c0',
      title: '채널',
      thumbnail_url: null,
      subscriber_count: 1,
      subscribers_hidden: false,
      observed_at: at,
    },
  ],
  keywords: [{ keyword: '고양이', video_count: 10, channel_count: 1 }],
});

const A = await user();
const B = await user();
const setA = (
  await svc(`select set_search_slot($1,1::smallint,'고양이','KR','ko','relevance','') id`, [A])
).rows[0].id;
assert.equal((await svc(`select get_slot_history($1,1::smallint) r`, [A])).rows[0].r, null);
ok('완료된 수집이 없으면 null');

// 하루 한 번 5일: 하루 100씩 늘다가 마지막 날만 300 늘어난다. 마지막 날에는 새 영상 2개(업로드 직후)
const totals = [1000, 1100, 1200, 1300, 1600];
const runIds = [];
for (const [d, total] of totals.entries()) {
  const at = T(d * 24);
  const r = (
    await svc(`select * from start_search_run($1,$2::timestamptz,$2::timestamptz,419430400)`, [
      setA,
      at,
    ])
  ).rows[0];
  const res = await svc(`select finish_search_run($1,$2::jsonb,$3::timestamptz) r`, [
    r.run_id,
    JSON.stringify(payload(() => total, at, d === 4 ? [9, 10] : [])),
    at,
  ]);
  assert.equal(res.rows[0].r, 'complete');
  runIds.push(r.run_id);
}

const h = (await svc(`select get_slot_history($1,1::smallint) r`, [A])).rows[0].r;
assert.equal(h.query, '고양이');
assert.deepEqual(
  h.runs.map((r) => r.runId),
  runIds,
  '오래된 순',
);
assert.equal(h.runs[0].prevScheduledFor, null);
assert.ok(
  h.runs[0].videos.every((v) => v.dailyGain === null),
  '첫날은 전날 수집이 없어 null',
);
assert.deepEqual(
  h.runs.slice(1).map((r) => r.videos[0].dailyGain),
  [100, 100, 100, 300],
  '약 24시간 전 수집 대비 하루 증가',
);
assert.equal(h.runs[1].videos[0].ageHours, 192);
assert.equal(h.runs[4].videos.filter((v) => v.ageHours < 72).length, 2, '새 영상 경과 시간');
// 최근 이틀 수집에만 영상 ID·제목이 있다(크는 영상 표시용). 오래된 수집은 숫자만.
assert.deepEqual(Object.keys(h.runs[0].videos[0]).sort(), ['ageHours', 'dailyGain']);
assert.equal(h.runs[4].videos[0].videoId, vid(1));
assert.equal(h.runs[4].videos[0].title, '고양이 1');
assert.ok(h.runs[3].videos.every((v) => typeof v.title === 'string'));
assert.ok(h.runs[2].videos.every((v) => v.title === undefined));
ok('날짜별 실행·하루 증가·경과 시간·최근 이틀 제목');

// 조회 기간: 최근 2일이면 마지막 두 실행만
const recent = (await svc(`select get_slot_history($1,1::smallint,2) r`, [A])).rows[0].r;
assert.deepEqual(
  recent.runs.map((r) => r.runId),
  runIds.slice(-2),
);
ok('조회 기간 제한');

// 검색 기록은 28일 보관(인기 차트와 같다)
const exp = await q(`select scheduled_for, expires_at from collection_runs where id = $1`, [
  runIds[0],
]);
assert.equal(
  Date.parse(exp.rows[0].expires_at) - Date.parse(exp.rows[0].scheduled_for),
  28 * 86400_000,
);
ok('검색 기록 28일 보관');

// 사용자 격리·권한
assert.equal((await svc(`select get_slot_history($1,1::smallint) r`, [B])).rows[0].r, null);
for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query(`select get_slot_history($1,1::smallint)`, [A]));
  await assert.rejects(db.query(`select try_consume_ip_quota('x','2026-10-08'::date,1,10)`));
  await db.exec('reset role');
}
ok('다른 사용자는 null, 브라우저 역할 실행 차단');

// IP별 상한: 상한 안에서만 소비, 넘으면 소비 없이 false, 이틀 지난 기록은 정리
const ip = (hash, day, units, cap) =>
  svc(`select try_consume_ip_quota($1,$2::date,$3,$4) r`, [hash, day, units, cap]).then(
    (r) => r.rows[0].r,
  );
assert.equal(await ip('aa', '2026-10-01', 2, 5), true);
assert.equal(await ip('aa', '2026-10-08', 4, 5), true);
assert.equal(await ip('aa', '2026-10-08', 2, 5), false);
assert.equal(await ip('bb', '2026-10-08', 5, 5), true);
const rows = await q(`select ip_hash, day::text, used from public_ip_quota order by ip_hash`);
assert.deepEqual(
  rows.rows.map((r) => [r.ip_hash, r.day, r.used]),
  [
    ['aa', '2026-10-08', 4],
    ['bb', '2026-10-08', 5],
  ],
);
ok('IP별 상한 소비·초과 거부·지난 기록 정리');

console.log(`PASS verify-history (${checks} checks)`);
await db.close();
