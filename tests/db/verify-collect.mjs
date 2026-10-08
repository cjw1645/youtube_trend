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

const vid = (i) => `vid${String(i).padStart(8, '0')}`;
const T = (h) => new Date(Date.parse('2026-10-08T00:00:00Z') + h * 3600_000).toISOString();
const payload = (
  count,
  {
    pages = Math.ceil(count / 50),
    title = (i) => `제목${i}`,
    likes = (i) => i,
    channels = 150,
  } = {},
) => ({
  pages_fetched: pages,
  units: pages + 4,
  finished_at: T(0),
  videos: Array.from({ length: count }, (_, k) => ({
    video_id: vid(k + 1),
    position: k + 1,
    content_hash: `h:${title(k + 1)}`,
    title: title(k + 1),
    description: '설명',
    tags: ['a', 'b'],
    category_id: String((k % 5) + 1),
    channel_id: `UC${k % channels}`,
    published_at: '2026-10-01T00:00:00Z',
    duration_seconds: 100,
    thumbnail_url: 'https://i/x.jpg',
    view_count: 1000 + k,
    like_count: likes(k + 1),
    comment_count: 0,
    observed_at: T(0),
  })),
  channels: Array.from({ length: Math.min(channels, count) }, (_, k) => ({
    channel_id: `UC${k}`,
    content_hash: `c${k}`,
    title: `채널${k}`,
    thumbnail_url: 'https://c/x.jpg',
    subscriber_count: k === 1 ? null : 100 + k,
    subscribers_hidden: k === 1,
    observed_at: T(0),
  })),
});
const start = async (at, now = at, hold) =>
  (
    await svc(
      `select * from start_popular_run($1::timestamptz, $2::timestamptz, 'KR', ${hold ?? 419430400})`,
      [at, now],
    )
  ).rows[0];
const finish = (run, p, now) =>
  svc(`select finish_popular_run($1, $2::jsonb, $3::timestamptz) r`, [
    run,
    JSON.stringify(p),
    now ?? T(0),
  ]);
const fail = (run, status, err, pages) =>
  svc(`select fail_popular_run($1,$2,$3,$4::smallint,5,$5::timestamptz) r`, [
    run,
    status,
    err,
    pages,
    T(0),
  ]);

// 1. 시작·멱등
const s1 = await start(T(0));
assert.equal(s1.state, 'started');
assert.equal((await start(T(0), T(0.05))).state, 'busy'); // 동시 두 번째 실행
assert.equal((await start(T(0), T(0.05))).run_id, s1.run_id);
assert.equal(await n('collection_runs'), 1);
ok('같은 시각 두 번째 실행은 busy, 행은 하나');

// 2. 200개 완료 적재
assert.equal((await finish(s1.run_id, payload(200))).rows[0].r, 'complete');
assert.equal(await n('video_observations'), 200);
assert.equal(await n('video_versions'), 200);
assert.equal(await n('channel_observations'), 150);
assert.equal(Number((await q(`select sum(video_count) s from category_counts`)).rows[0].s), 200);
const run = (await q(`select * from collection_runs where id=${s1.run_id}`)).rows[0];
assert.equal(
  [run.status, run.item_count, run.pages_fetched, run.pages_expected].join(),
  'complete,200,4,4',
);
assert.equal((await start(T(0), T(0.5))).state, 'done'); // 완료된 시각은 재실행 안 함
assert.equal((await finish(s1.run_id, payload(200))).rows[0].r, 'not_running'); // 중복 완료 불가
assert.equal(await n('video_observations'), 200);
ok('200개 적재(버전·관측·채널·카테고리 집계), 완료 후 재시작·재완료 불가');

// 3. 다음 시각: 같은 영상 재사용, 제목 수정은 새 버전
const s2 = await start(T(1));
await finish(
  s2.run_id,
  payload(200, { title: (i) => (i === 7 ? '수정된 제목' : `제목${i}`) }),
  T(1),
);
assert.equal(await n('video_versions'), 201);
assert.equal(await n('video_observations'), 400);
const hist = await q(
  `select r.scheduled_for, v.title from video_observations o join video_versions v on v.id=o.version_id join collection_runs r on r.id=o.run_id where o.video_id=$1 order by 1`,
  [vid(7)],
);
assert.deepEqual(
  hist.rows.map((x) => x.title),
  ['제목7', '수정된 제목'],
);
ok('다음 실행에서 버전 재사용, 제목 수정은 새 버전(과거 관측 유지)');

// 4. 부분 실패는 비공개, 적재 없음, 재시도는 같은 작업 시각으로
const s3 = await start(T(2));
await fail(s3.run_id, 'partial', 'UPSTREAM_ERROR', 1);
const part = (
  await q(`select status, error_code, pages_fetched from collection_runs where id=${s3.run_id}`)
).rows[0];
assert.deepEqual(
  [part.status, part.error_code, part.pages_fetched],
  ['partial', 'UPSTREAM_ERROR', 1],
);
assert.equal(await n(`video_observations where run_id=${s3.run_id}`), 0);
assert.equal(
  (await as(db, 'anon', null, `select id from collection_runs where id=${s3.run_id}`)).rows.length,
  0,
);
const latest = (await svc(`select get_latest_popular('KR', $1::timestamptz) r`, [T(2.5)])).rows[0]
  .r;
assert.equal(Date.parse(latest.snapshot.scheduled_for), Date.parse(T(1))); // 마지막 성공은 01시(UTC)
assert.equal(latest.lag_minutes, 90);
assert.equal(latest.last_attempt.status, 'partial'); // 마지막 시도는 실패
assert.equal(latest.snapshot.videos.length, 200);
assert.equal(latest.snapshot.videos[0].position, 1);
assert.equal(latest.snapshot.videos[0].channel_title, '채널0');
assert.equal(latest.snapshot.videos[1].subscriber_count, null); // 숨김 구독자는 null
assert.equal(latest.snapshot.videos[0].subscriber_count, 100);
const retry = await start(T(2), T(2.1));
assert.equal(retry.state, 'started');
assert.equal(retry.run_id, s3.run_id);
await finish(retry.run_id, payload(120, { pages: 3, channels: 40 }), T(2.2));
assert.equal(await n(`video_observations where run_id=${s3.run_id}`), 120);
const r3 = (
  await q(
    `select pages_fetched, pages_expected, item_count from collection_runs where id=${s3.run_id}`,
  )
).rows[0];
assert.deepEqual([r3.pages_fetched, r3.pages_expected, r3.item_count], [3, 3, 120]); // 목록이 200개 미만이면 그만큼만
ok(
  '부분 실행은 비공개·미적재, 마지막 성공/지연/마지막 시도 구분, 같은 시각 재시도, 200개 미만 허용',
);

// 5. 오래된 running은 인수, 실패 후 재시도 시 이전 적재분 제거
const s4 = await start(T(3));
const stale = await start(T(3), T(3.2)); // 12분 뒤
assert.equal(stale.state, 'started');
assert.equal(stale.run_id, s4.run_id);
ok('10분 넘게 끝나지 않은 running 실행은 재시작');

// 6. 잘못된 payload는 전체 롤백
for (const [name, bad] of [
  ['0개', payload(0)],
  ['201개', payload(201, { pages: 4 })],
  [
    '중복 position',
    (() => {
      const p = payload(5);
      p.videos[1].position = 1;
      return p;
    })(),
  ],
  ['음수 통계', payload(5, { likes: () => -1 })],
]) {
  const before = [
    await n('video_versions'),
    await n('video_observations'),
    await n('channel_versions'),
  ];
  await assert.rejects(finish(s4.run_id, bad), /./, name);
  assert.deepEqual(
    [await n('video_versions'), await n('video_observations'), await n('channel_versions')],
    before,
    `${name}: 롤백`,
  );
  assert.equal(
    (await q(`select status from collection_runs where id=${s4.run_id}`)).rows[0].status,
    'running',
  );
}
ok('0개·201개·중복 위치·음수 통계 적재는 거부되고 전체 롤백');

// 7. null/0 보존
const s5 = await start(T(4));
await finish(s5.run_id, payload(3, { likes: (i) => (i === 1 ? null : 0) }), T(4));
const lk = (
  await q(
    `select position, like_count, comment_count from video_observations where run_id=${s5.run_id} order by position`,
  )
).rows;
assert.equal(lk[0].like_count, null);
assert.equal(String(lk[1].like_count), '0');
ok('null 통계와 0 구분');

// 8. 저장 보류
assert.equal((await start(T(5), T(5), 1)).state, 'storage_hold');
assert.equal(await n(`collection_runs where scheduled_for='${T(5)}'`), 0);
ok('DB 크기 임계 초과 시 새 수집 보류(행 생성 없음)');

// 9. 만료와 권한
const exp = (
  await q(
    `select extract(epoch from expires_at - scheduled_for) / 86400 d from collection_runs where id=${s1.run_id}`,
  )
).rows[0].d;
assert.equal(Number(exp), 28);
const purged = (
  await svc(`select * from purge_expired($1::timestamptz)`, [
    new Date(Date.parse(T(0)) + 28 * 86400_000).toISOString(),
  ])
).rows[0];
assert.equal(Number(purged.runs), 1);
assert.equal(await n(`video_observations where run_id=${s1.run_id}`), 0);
assert.equal(await n(`video_versions where title='제목7'`), 1); // 뒤 실행이 아직 참조하는 버전은 유지
const later = (
  await svc(`select * from purge_expired($1::timestamptz)`, [
    new Date(Date.parse(T(0)) + 28 * 86400_000 + 5 * 3600_000).toISOString(),
  ])
).rows[0];
assert.equal(Number(later.runs), 4);
assert.equal(await n('video_versions'), 0); // 참조가 모두 사라지면 버전도 삭제
assert.equal(await n('channel_versions'), 0);
for (const fn of [
  'start_popular_run(now())',
  "finish_popular_run(1, '{}'::jsonb)",
  "fail_popular_run(1, 'failed', 'x', 0::smallint, 0)",
  'get_latest_popular()',
  "ensure_quota_row('youtube_units', current_date, 10)",
]) {
  await assert.rejects(as(db, 'anon', null, `select * from ${fn}`), /permission denied/, fn);
  await assert.rejects(
    as(db, 'authenticated', '00000000-0000-0000-0000-000000000001', `select * from ${fn}`),
    /permission denied/,
    fn,
  );
}
await svc(`select ensure_quota_row('youtube_units', '2026-10-08', 1000)`);
await svc(`select ensure_quota_row('youtube_units', '2026-10-08', 5)`); // 기존 cap 유지
assert.equal(
  (await q(`select cap from quota_counters where kind='youtube_units'`)).rows[0].cap,
  1000,
);
assert.equal(
  (await svc(`select try_consume_quota('youtube_units', '2026-10-08', 8) r`)).rows[0].r,
  true,
);
ok('만료 28일 정리(참조 없는 버전 삭제), 브라우저 역할 실행 불가, 예산 행 보존');

console.log(`PASS: ${checks}개 그룹 (합성 데이터, 로컬 PGlite, 실제 API·DB 0회)`);
await db.close();
