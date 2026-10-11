import assert from 'node:assert/strict';
import { createDb } from './harness.mjs';
// 내 검색어 슬롯과 인기 차트 비교 원자료(get_slot_popular_compare): 가장 가까운 완료 인기 실행 선택, 키워드·카테고리·영상 겹침, 사용자 격리, 권한.

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

// ids 범위의 영상. position은 목록 안 순서(1부터), 카테고리는 지정한 값.
const payload = (ids, category, keywords, at) => ({
  pages_fetched: Math.max(1, Math.ceil(ids.length / 50)),
  units: 5,
  finished_at: at,
  videos: ids.map((id, k) => ({
    video_id: vid(id),
    position: k + 1,
    content_hash: `h${id}:${category}`,
    title: `제목${id}`,
    description: '',
    tags: [],
    category_id: category,
    channel_id: 'UC0',
    published_at: '2026-10-01T00:00:00Z',
    duration_seconds: 60,
    thumbnail_url: null,
    view_count: 10,
    like_count: 1,
    comment_count: 1,
    observed_at: at,
  })),
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
  keywords: keywords.map(([keyword, video_count]) => ({ keyword, video_count, channel_count: 1 })),
});
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const popular = async (hour, ids, category, keywords) => {
  const r = (
    await svc(`select * from start_popular_run($1::timestamptz,$1::timestamptz,'KR',419430400)`, [
      T(hour),
    ])
  ).rows[0];
  const res = await svc(`select finish_popular_run($1,$2::jsonb,$3::timestamptz) r`, [
    r.run_id,
    JSON.stringify(payload(ids, category, keywords, T(hour))),
    T(hour),
  ]);
  assert.equal(res.rows[0].r, 'complete');
  return r.run_id;
};
const A = await user();
const B = await user();
const setA = (
  await svc(`select set_search_slot($1,1::smallint,'고양이','KR','ko','relevance','') id`, [A])
).rows[0].id;

// 검색 실행 전에는 비교할 슬롯 수집이 없다
assert.equal((await svc(`select get_slot_popular_compare($1,1::smallint) r`, [A])).rows[0].r, null);
ok('완료된 검색 수집이 없으면 null');

// 인기 실행 두 개(시각 -3h·+2h)와 검색 실행(0h). 가까운 쪽(+2h)이 선택돼야 한다.
const popFar = await popular(-3, range(1, 10), '10', [['음악', 5]]);
const popNear = await popular(2, range(5, 14), '10', [
  ['고양이', 3],
  ['간식', 2],
  ['음악', 4],
]);
const s = (
  await svc(`select * from start_search_run($1,$2::timestamptz,$2::timestamptz,419430400)`, [
    setA,
    T(0),
  ])
).rows[0];
await svc(`select finish_search_run($1,$2::jsonb,$3::timestamptz) r`, [
  s.run_id,
  JSON.stringify(
    payload(
      range(11, 30),
      '15',
      [
        ['고양이', 12],
        ['간식', 6],
        ['장난감', 4],
      ],
      T(0),
    ),
  ),
  T(0),
]);

const cmp = (await svc(`select get_slot_popular_compare($1,1::smallint) r`, [A])).rows[0].r;
assert.equal(cmp.slotRunId, s.run_id);
assert.equal(cmp.popularRunId, popNear);
assert.notEqual(cmp.popularRunId, popFar);
assert.equal(cmp.slotItemCount, 20);
assert.equal(cmp.popularItemCount, 10);
ok('슬롯 실행과 가장 가까운 완료 인기 실행 선택');

const kw = (list) => Object.fromEntries(list.map((k) => [k.keyword, k.videoCount]));
assert.deepEqual(kw(cmp.slotKeywords), { 고양이: 12, 간식: 6, 장난감: 4 });
assert.deepEqual(kw(cmp.popularKeywords), { 음악: 4, 고양이: 3, 간식: 2 });
assert.deepEqual(
  cmp.popularKeywords.map((k) => k.keyword),
  ['음악', '고양이', '간식'],
  '영상 수 내림차순',
);
assert.deepEqual(Object.fromEntries(cmp.slotCategories.map((c) => [c.categoryId, c.videoCount])), {
  15: 20,
});
assert.deepEqual(
  Object.fromEntries(cmp.popularCategories.map((c) => [c.categoryId, c.videoCount])),
  { 10: 10 },
);
ok('양쪽 키워드·카테고리 집계 반환');

// 영상별 조회수·좋아요: 검색 쪽은 숫자만, 인기 쪽은 키워드 계산용 제목·태그 포함
assert.equal(cmp.slotVideos.length, 20);
// 약 24시간 전 실행이 없으므로 하루 증가(dailyGain)는 null. 10-01 업로드 → 10-08 관측이라 경과 168시간
assert.deepEqual(cmp.slotVideos[0], {
  viewCount: 10,
  likeCount: 1,
  dailyGain: null,
  ageHours: 168,
});
assert.equal(cmp.popularVideos.length, 10);
assert.deepEqual(Object.keys(cmp.popularVideos[0]).sort(), [
  'ageHours',
  'dailyGain',
  'likeCount',
  'tags',
  'title',
  'viewCount',
]);
assert.ok(cmp.popularVideos.every((v) => Array.isArray(v.tags) && v.title.startsWith('제목')));
ok('영상별 조회수·좋아요 반환(인기 쪽은 제목·태그 포함)');

// 겹침: 검색 11–30, 인기 5–14 → 11–14 네 개. 인기 position은 id-4.
assert.deepEqual(
  cmp.videoOverlap.map((v) => [v.videoId, v.slotPosition, v.popularPosition]),
  [
    [vid(11), 1, 7],
    [vid(12), 2, 8],
    [vid(13), 3, 9],
    [vid(14), 4, 10],
  ],
);
ok('영상 겹침과 양쪽 position');

// 허용 오차 밖이면 인기 실행 없음(popularRunId null)
const setB = (
  await svc(`select set_search_slot($1,2::smallint,'강아지','KR','ko','relevance','') id`, [A])
).rows[0].id;
const sb = (
  await svc(`select * from start_search_run($1,$2::timestamptz,$2::timestamptz,419430400)`, [
    setB,
    T(100),
  ])
).rows[0];
await svc(`select finish_search_run($1,$2::jsonb,$3::timestamptz) r`, [
  sb.run_id,
  JSON.stringify(payload(range(1, 5), '15', [['강아지', 2]], T(100))),
  T(100),
]);
const far = (await svc(`select get_slot_popular_compare($1,2::smallint) r`, [A])).rows[0].r;
assert.equal(far.popularRunId, null);
assert.equal(far.slotItemCount, 5);
ok('26시간 안에 완료 인기 수집이 없으면 popularRunId null');

// 사용자 격리: 다른 사용자는 슬롯이 없으므로 null, 다른 사용자의 슬롯 번호로도 내 데이터가 나오지 않는다
assert.equal((await svc(`select get_slot_popular_compare($1,1::smallint) r`, [B])).rows[0].r, null);
ok('다른 사용자는 null(본인 슬롯만 조인)');

// 브라우저 역할은 실행할 수 없다
for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query(`select get_slot_popular_compare($1,1::smallint)`, [A]));
  await db.exec('reset role');
}
ok('브라우저 역할 실행 차단');

// 하루 조회수 증가(dailyGain): 같은 영상을 약 24시간 전 실행(18~30시간 전)과 이번 실행에서 모두 찾아 24시간 기준으로 환산
{
  const g = await createDb();
  const gq = (sql, p) => g.query(sql, p);
  const gu = (await gq(`insert into auth.users default values returning id`)).rows[0].id;
  const set = (await gq(`insert into search_sets (query_norm) values ('고양이 영상') returning id`))
    .rows[0].id;
  await gq(`insert into user_search_slots (user_id, slot, search_set_id) values ($1, 1, $2)`, [
    gu,
    set,
  ]);
  const run = async (kind, at) =>
    (
      await gq(
        `insert into collection_runs (kind, search_set_id, scheduled_for, status, pages_expected, pages_fetched, item_count, finished_at, expires_at)
         values ($1, $2, $3::timestamptz, 'complete', 4, 4, 3, $3::timestamptz, $3::timestamptz + interval '14 days') returning id`,
        [kind, kind === 'search' ? set : null, at],
      )
    ).rows[0].id;
  const versions = new Map();
  const version = async (video) => {
    if (!versions.has(video))
      versions.set(
        video,
        (
          await gq(
            `insert into video_versions (video_id, content_hash, title, channel_id, published_at)
             values ($1, $1, $1, 'UCchan', '2020-01-01T00:00:00Z') returning id`,
            [video],
          )
        ).rows[0].id,
      );
    return versions.get(video);
  };
  const obs = async (runId, video, pos, views, at) =>
    gq(
      `insert into video_observations (run_id, video_id, version_id, position, view_count, like_count, observed_at)
       values ($1, $2, $3, $4, $5, 1, $6::timestamptz)`,
      [runId, video, await version(video), pos, views, at],
    );
  const compare = async () =>
    (await gq(`select get_slot_popular_compare($1, 1::smallint) as c`, [gu])).rows[0].c;
  const iso = (value) => (value === null ? null : new Date(value).toISOString());
  const gainOf = (videos, views) => videos.find((v) => v.viewCount === views)?.dailyGain;

  const s1 = await run('search', T(0));
  const p1 = await run('popular', T(0));
  await obs(s1, 'oldcatvideo', 1, 5_000_000, T(0));
  await obs(s1, 'newcatvideo', 2, 1_000, T(0));
  await obs(p1, 'hitvideo001', 1, 100_000, T(0));
  let c = await compare();
  assert.equal(c.slotPrevScheduledFor, null);
  assert.equal(c.popularPrevScheduledFor, null);
  assert.ok([...c.slotVideos, ...c.popularVideos].every((v) => v.dailyGain === null));
  ok('첫 수집만 있으면 이전 실행 없음, 하루 증가 null');

  // 누적은 오래된 영상이 크지만 하루 증가는 인기 영상이 크다
  const s2 = await run('search', T(24));
  const p2 = await run('popular', T(24));
  await obs(s2, 'oldcatvideo', 1, 5_002_000, T(24));
  await obs(s2, 'newcatvideo', 2, 4_000, T(24));
  await obs(s2, 'brandnewcat', 3, 500, T(24));
  await obs(p2, 'hitvideo001', 1, 400_000, T(24));
  c = await compare();
  assert.equal(iso(c.slotPrevScheduledFor), T(0));
  assert.equal(iso(c.popularPrevScheduledFor), T(0));
  assert.equal(gainOf(c.slotVideos, 5_002_000), 2_000);
  assert.equal(gainOf(c.slotVideos, 4_000), 3_000);
  assert.equal(gainOf(c.slotVideos, 500), null, '어제 없던 영상은 null');
  assert.equal(gainOf(c.popularVideos, 400_000), 300_000);
  ok('24시간 전 실행 대비 하루 증가, 어제 없던 영상은 null');

  // 관측 간격이 20시간이면 24시간으로 환산(+1,000 → 1,200)
  const p3 = await run('popular', T(44));
  await obs(p3, 'hitvideo001', 1, 401_000, T(44));
  const s3 = await run('search', T(44));
  await obs(s3, 'newcatvideo', 1, 4_100, T(44));
  c = await compare();
  assert.equal(iso(c.popularPrevScheduledFor), T(24));
  assert.equal(gainOf(c.popularVideos, 401_000), 1_200);
  assert.equal(gainOf(c.slotVideos, 4_100), 120);
  ok('관측 간격을 24시간 기준으로 환산');

  // 18~30시간 창 밖(12시간 전 T44, 32시간 전 T24)만 있으면 이전 실행 없음
  const s4 = await run('search', T(56));
  await obs(s4, 'newcatvideo', 1, 4_200, T(56));
  c = await compare();
  assert.equal(c.slotPrevScheduledFor, null);
  assert.equal(gainOf(c.slotVideos, 4_200), null);
  ok('18~30시간 창 밖 실행은 비교에 쓰지 않음');

  // 조회수 비공개면 하루 증가도 null
  const s5 = await run('search', T(80));
  await obs(s5, 'newcatvideo', 1, null, T(80));
  const p5 = await run('popular', T(80));
  await obs(p5, 'hitvideo001', 1, 402_000, T(80));
  c = await compare();
  assert.equal(iso(c.slotPrevScheduledFor), T(56));
  assert.equal(c.slotVideos[0].dailyGain, null);
  ok('조회수 비공개면 하루 증가 null');
  await g.close();
}

console.log(`PASS: ${checks}개 그룹 (합성 데이터, 로컬 PGlite, 실제 API·DB 0회)`);
await db.close();
