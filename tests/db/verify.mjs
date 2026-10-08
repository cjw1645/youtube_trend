import assert from 'node:assert/strict';
import { createDb, as } from './harness.mjs';

const db = await createDb();
const q = (sql, p) => db.query(sql, p);
const rejects = (sql, re, p) => assert.rejects(() => q(sql, p), re);
const V = (n) => `vid${String(n).padStart(8, '0')}`; // 11자 영상 ID
const T0 = '2026-10-01T00:00:00Z';

const run = async (kind, at, extra = {}) => {
  const set = extra.set ?? null;
  const exp = extra.exp ?? (kind === 'popular' ? "interval '28 days'" : "interval '14 days'");
  const r = await q(
    `insert into collection_runs (kind, search_set_id, scheduled_for, status, pages_expected, pages_fetched, item_count, finished_at, expires_at)
     values ($1, $2, $3::timestamptz, $4, 4, $5, 3, $3::timestamptz, $3::timestamptz + ${exp}) returning id`,
    [kind, set, at, extra.status ?? 'complete', extra.pages ?? 4],
  );
  return r.rows[0].id;
};
const version = async (video, hash, title) =>
  (
    await q(
      `insert into video_versions (video_id, content_hash, title, channel_id, published_at)
       values ($1,$2,$3,'UCchan',$4) returning id`,
      [video, hash, title, T0],
    )
  ).rows[0].id;
const obs = (r, video, ver, pos, likes = 5) =>
  q(
    `insert into video_observations (run_id, video_id, version_id, position, view_count, like_count, observed_at)
     values ($1,$2,$3,$4,100,$5,$6)`,
    [r, video, ver, pos, likes, T0],
  );
const user = async () => (await q(`insert into auth.users default values returning id`)).rows[0].id;
const count = async (t) => Number((await q(`select count(*) c from ${t}`)).rows[0].c);
let checks = 0;
const ok = (name) => (checks++, console.log('  ok', name));

// 1. 멱등 키: 같은 작업 시각의 인기 실행은 한 행
const r1 = await run('popular', T0);
await rejects(
  `insert into collection_runs (kind, scheduled_for, pages_expected, expires_at) values ('popular', '${T0}', 4, '2026-11-01Z')`,
  /duplicate key/,
);
assert.equal(
  (
    await q(
      `insert into collection_runs (kind, scheduled_for, pages_expected, expires_at) values ('popular', '${T0}', 4, '2026-11-01Z') on conflict do nothing`,
    )
  ).affectedRows,
  0,
);
ok('같은 시각 인기 실행은 중복 생성되지 않음');

// 2. 관측 멱등·위치 유일
const v1 = await version(V(1), 'h1', '처음 제목');
await obs(r1, V(1), v1, 1);
await rejects(
  `insert into video_observations (run_id, video_id, version_id, position, observed_at) values (${r1}, '${V(1)}', ${v1}, 2, '${T0}')`,
  /duplicate key/,
);
const v2x = await version(V(2), 'h2', '둘');
await rejects(
  `insert into video_observations (run_id, video_id, version_id, position, observed_at) values (${r1}, '${V(2)}', ${v2x}, 1, '${T0}')`,
  /duplicate key/,
);
await rejects(
  `insert into video_observations (run_id, video_id, version_id, position, observed_at) values (${r1}, '${V(3)}', ${v2x}, 201, '${T0}')`,
  /check/,
);
ok('(run, video)·(run, position) 중복과 201위 거부');

// 3. 버전 재현: 제목 수정 후에도 과거 관측은 옛 제목
const r2 = await run('popular', '2026-10-01T01:00:00Z');
const v1b = await version(V(1), 'h1b', '바뀐 제목');
await obs(r2, V(1), v1b, 1);
const titles = await q(
  `select r.scheduled_for, v.title from video_observations o join video_versions v on v.id=o.version_id join collection_runs r on r.id=o.run_id where o.video_id=$1 order by 1`,
  [V(1)],
);
assert.deepEqual(
  titles.rows.map((x) => x.title),
  ['처음 제목', '바뀐 제목'],
);
await rejects(
  `insert into video_versions (video_id, content_hash, title, channel_id, published_at) values ('${V(1)}','h1','dup','UC','${T0}')`,
  /duplicate key/,
);
ok('제목 변경은 새 버전, 과거 관측은 이전 제목 유지, 같은 해시 중복 버전 거부');

// 4. null/0, 음수, 숨김 구독자
await obs(r1, V(2), v2x, 2, null);
await obs(r1, V(3), v2x, 3, 0);
const lk = await q(
  `select video_id, like_count from video_observations where run_id=${r1} and position in (2,3) order by position`,
);
assert.equal(lk.rows[0].like_count, null);
assert.equal(String(lk.rows[1].like_count), '0');
await rejects(
  `insert into video_observations (run_id, video_id, version_id, position, like_count, observed_at) values (${r1}, '${V(4)}', ${v1}, 4, -1, '${T0}')`,
  /check/,
);
const cv = (
  await q(
    `insert into channel_versions (channel_id, content_hash, title) values ('UCchan','c1','채널') returning id`,
  )
).rows[0].id;
await rejects(
  `insert into channel_observations (run_id, channel_id, version_id, subscriber_count, subscribers_hidden, observed_at) values (${r1},'UCchan',${cv},5,true,'${T0}')`,
  /check/,
);
await q(
  `insert into channel_observations (run_id, channel_id, version_id, subscriber_count, subscribers_hidden, observed_at) values (${r1},'UCchan',${cv},null,true,'${T0}')`,
);
ok('null과 0 구분, 음수·"숨김인데 값 있음" 거부');

// 5. 실행 완전성 제약
await rejects(
  `insert into collection_runs (kind, scheduled_for, status, pages_expected, pages_fetched, finished_at, expires_at) values ('popular','2026-10-02Z','complete',4,2,'2026-10-02Z','2026-11-02Z')`,
  /check/,
);
await rejects(
  `insert into collection_runs (kind, scheduled_for, pages_expected, expires_at) values ('search','2026-10-02Z',4,'2026-10-10Z')`,
  /check/,
);
ok('부분 페이지 실행은 complete 불가, 검색 실행은 집합 필수');

// 6. 두 슬롯 경쟁/3번째 슬롯
const uA = await user();
const uB = await user();
const sets = [];
for (const w of ['먹방', '게임', '요리'])
  sets.push(
    (await q(`insert into search_sets (query_norm) values ($1) returning id`, [w])).rows[0].id,
  );
await rejects(`insert into search_sets (query_norm) values ('먹방')`, /duplicate key/);
await q(`insert into search_sets (query_norm, order_by) values ('먹방','date')`); // 조건이 다르면 별도 집합
await q(`insert into user_search_slots (user_id, slot, search_set_id) values ($1,1,$2),($1,2,$3)`, [
  uA,
  sets[0],
  sets[1],
]);
await rejects(
  `insert into user_search_slots (user_id, slot, search_set_id) values ('${uA}',3,${sets[2]})`,
  /check/,
);
await rejects(
  `insert into user_search_slots (user_id, slot, search_set_id) values ('${uA}',1,${sets[2]})`,
  /duplicate key/,
);
await rejects(
  `insert into user_search_slots (user_id, slot, search_set_id) values ('${uA}',2,${sets[0]})`,
  /duplicate key/,
);
ok('슬롯은 계정당 최대 2개, 같은 슬롯·같은 집합 중복 거부, 조건이 다르면 다른 집합');

// 7. RLS
const rs = await run('search', T0, { set: sets[0] });
const vs = await version(V(9), 'h9', '검색결과');
await obs(rs, V(9), vs, 1);
const rPartial = await run('popular', '2026-10-01T02:00:00Z', { status: 'partial', pages: 2 });
const anonRuns = (
  await as(db, 'anon', null, `select id from collection_runs order by id`)
).rows.map((x) => x.id);
assert.deepEqual(anonRuns, [r1, r2]); // 완전한 인기 실행만. 검색·부분 실행 제외
assert.equal(
  (await as(db, 'anon', null, `select 1 from video_observations where run_id=${rs}`)).rows.length,
  0,
);
assert.equal(
  (await as(db, 'authenticated', uA, `select 1 from video_observations where run_id=${rs}`)).rows
    .length,
  1,
);
assert.equal(
  (await as(db, 'authenticated', uB, `select 1 from video_observations where run_id=${rs}`)).rows
    .length,
  0,
);
assert.equal(
  (await as(db, 'authenticated', uB, `select 1 from video_versions where id=${vs}`)).rows.length,
  0,
);
assert.equal(
  (await as(db, 'authenticated', uB, `select 1 from search_sets where id=${sets[0]}`)).rows.length,
  0,
);
assert.equal((await as(db, 'authenticated', uA, `select 1 from user_search_slots`)).rows.length, 2);
assert.equal((await as(db, 'authenticated', uB, `select 1 from user_search_slots`)).rows.length, 0);
assert.equal((await as(db, 'anon', null, `select 1 from video_versions`)).rows.length > 0, true);
void rPartial;
ok('RLS: 익명은 완전한 공통 목록만, 개인 검색은 슬롯 소유자만, 부분 실행 비공개');

await assert.rejects(
  as(
    db,
    'anon',
    null,
    `insert into collection_runs (kind, scheduled_for, pages_expected, expires_at) values ('popular','2026-12-01Z',4,'2026-12-30Z')`,
  ),
  /permission denied/,
);
await assert.rejects(
  as(db, 'authenticated', uA, `select * from quota_counters`),
  /permission denied/,
);
await assert.rejects(
  as(db, 'authenticated', uA, `select * from usage_reservations`),
  /permission denied/,
);
await assert.rejects(
  as(
    db,
    'authenticated',
    uA,
    `insert into user_search_slots (user_id, slot, search_set_id) values ('${uA}',1,${sets[2]})`,
  ),
  /permission denied/,
);
await assert.rejects(
  as(db, 'authenticated', uA, `update user_search_slots set search_set_id=${sets[2]}`),
  /permission denied/,
);
await assert.rejects(as(db, 'authenticated', uA, `select purge_expired()`), /permission denied/);
await assert.rejects(
  as(db, 'authenticated', uA, `select try_consume_quota('search', current_date, 1)`),
  /permission denied/,
);
ok('브라우저 역할은 쓰기·예산·예약·정리 함수 접근 불가');

// 8. 관심·대화 격리와 위조 차단
await as(db, 'authenticated', uA, `insert into favorites (user_id, video_id) values ($1, $2)`, [
  uA,
  V(1),
]);
await assert.rejects(
  as(db, 'authenticated', uA, `insert into favorites (user_id, video_id) values ($1, $2)`, [
    uB,
    V(1),
  ]),
  /row-level security/,
);
assert.equal((await as(db, 'authenticated', uB, `select 1 from favorites`)).rows.length, 0);
const convA = (
  await q(
    `insert into conversations (user_id, expires_at) values ($1, now() + interval '28 days') returning id`,
    [uA],
  )
).rows[0].id;
const mUser = (
  await q(
    `insert into messages (conversation_id, role, content) values ($1,'user','현재 트렌드 분석해줘') returning id`,
    [convA],
  )
).rows[0].id;
const mAsst = (
  await q(
    `insert into messages (conversation_id, role, content, model, input_tokens, output_tokens) values ($1,'assistant','답변','m',10,20) returning id`,
    [convA],
  )
).rows[0].id;
await q(`insert into message_citations (message_id, run_id, video_id) values ($1,$2,$3)`, [
  mAsst,
  r1,
  V(1),
]);
assert.equal((await as(db, 'authenticated', uB, `select 1 from messages`)).rows.length, 0);
assert.equal((await as(db, 'authenticated', uA, `select 1 from messages`)).rows.length, 2);
await assert.rejects(
  as(
    db,
    'authenticated',
    uA,
    `insert into messages (conversation_id, role, content) values ('${convA}','user','x')`,
  ),
  /permission denied/,
);
await assert.rejects(
  as(db, 'authenticated', uA, `update messages set content='바꿈'`),
  /permission denied/,
);
ok('관심·대화는 본인만 접근, 메시지·사용량은 브라우저에서 위조 불가');

// 9. 질문 100자 경계(코드 포인트)
const ins = (c, role = 'user') =>
  q(`insert into messages (conversation_id, role, content) values ($1,$2,$3)`, [convA, role, c]);
await ins('가'.repeat(100));
await assert.rejects(ins('가'.repeat(101)), /check/);
await ins('😀'.repeat(100)); // 이모지 100개 = 코드 포인트 100
await assert.rejects(ins('😀'.repeat(101)), /check/);
await assert.rejects(ins(''), /check/);
await ins('답'.repeat(5000), 'assistant'); // 답변 길이는 제한하지 않는다(저장 상한 20,000자만)
await ins('답'.repeat(20000), 'assistant');
await assert.rejects(ins('답'.repeat(20001), 'assistant'), /check/);
ok('질문 100자(코드 포인트) 경계, 빈 질문 거부, 답변은 100자 제한 없음(저장 상한 20,000자)');

// 10. 예산·진행 중 1건
await q(`insert into quota_counters (kind, day, cap) values ('search', '2026-10-08', 3)`);
const got = [];
for (let i = 0; i < 5; i++)
  got.push((await q(`select try_consume_quota('search','2026-10-08',1) ok`)).rows[0].ok);
assert.deepEqual(got, [true, true, true, false, false]);
assert.equal((await q(`select used from quota_counters`)).rows[0].used, 3);
await rejects(`update quota_counters set used = 4`, /check/);
const rid = '00000000-0000-0000-0000-0000000000a1';
const resv = (id, st = 'reserved', kind = 'ai') =>
  q(
    `insert into usage_reservations (user_id, kind, request_id, status, lease_expires_at) values ($1,$2,$3,$4, now() + interval '2 minutes')`,
    [uA, kind, id, st],
  );
await resv(rid);
await assert.rejects(resv('00000000-0000-0000-0000-0000000000a2'), /duplicate key/); // 동시 두 번째 AI 요청
await assert.rejects(resv(rid, 'settled'), /duplicate key/); // 같은 request_id 재전송
await q(`update usage_reservations set status='settled'`);
await resv('00000000-0000-0000-0000-0000000000a3'); // 정산 후에는 새 요청 가능
ok('전역 예산은 상한에서 정확히 멈춤, 사용자당 진행 중 AI 1건, request_id 멱등');

// 11. 만료 경계와 purge
const edge = await run('popular', '2026-09-01T00:00:00Z', { exp: "interval '28 days'" }); // 만료 2026-09-29
const vEdge = await version(V(20), 'e1', '경계');
await obs(edge, V(20), vEdge, 1);
await q(`insert into category_counts (run_id, category_id, video_count) values ($1,'10',1)`, [
  edge,
]);
await q(
  `insert into keyword_counts (run_id, keyword, video_count, channel_count) values ($1,'먹방',1,1)`,
  [edge],
);
await rejects(
  `insert into keyword_counts (run_id, keyword, video_count, channel_count) values (${edge},'x',1,2)`,
  /check/,
);
const keep = await run('popular', '2026-09-01T00:00:01Z'); // 만료 2026-09-29 00:00:01
const vKeep = await version(V(21), 'k1', '유지');
await obs(keep, V(21), vKeep, 1);
await q(`insert into message_citations (message_id, run_id, video_id) values ($1,$2,$3)`, [
  mAsst,
  edge,
  V(20),
]);
const out = (await q(`select * from purge_expired('2026-09-29T00:00:00Z')`)).rows[0];
assert.equal(Number(out.runs), 1);
assert.equal(await count(`(select 1 from collection_runs where id=${edge}) x`), 0);
assert.equal(await count(`(select 1 from collection_runs where id=${keep}) x`), 1);
assert.equal(await count(`(select 1 from video_observations where run_id=${edge}) x`), 0);
assert.equal(await count(`(select 1 from category_counts where run_id=${edge}) x`), 0);
assert.equal(await count(`(select 1 from keyword_counts where run_id=${edge}) x`), 0);
assert.equal(await count(`(select 1 from video_versions where id=${vEdge}) x`), 0); // 참조 사라진 버전 삭제
assert.equal(await count(`(select 1 from video_versions where id=${vKeep}) x`), 1);
assert.equal(await count(`(select 1 from message_citations where run_id=${edge}) x`), 0); // 인용 참조도 만료
assert.equal(await count(`(select 1 from messages where id=${mAsst}) x`), 1); // 대화 자체는 28일 정책에 따름
ok('만료 시각 정각에 삭제/1초 전은 유지, 집계·버전·인용 전파, 참조 중 버전 보존');

// 12. 대화 만료, 검색 집합 정리, 계정 삭제
await q(`insert into conversations (user_id, expires_at) values ($1, '2026-10-10Z')`, [uB]);
const out2 = (await q(`select * from purge_expired('2026-10-10T00:00:00Z')`)).rows[0];
assert.equal(Number(out2.conversations), 1);
assert.equal(await count(`conversations where user_id='${uB}'`), 0);
assert.equal(await count(`conversations where user_id='${uA}'`), 1);
assert.equal(await count(`search_sets where id=${sets[2]}`), 0); // 구독자·run 없는 집합 정리
assert.equal(await count(`search_sets where id=${sets[0]}`), 1); // 슬롯이 가진 집합은 유지

await q(`delete from auth.users where id=$1`, [uA]);
for (const t of ['user_search_slots', 'favorites', 'conversations', 'usage_reservations'])
  assert.equal(await count(`${t} where user_id='${uA}'`), 0, t);
assert.equal(await count(`messages where conversation_id='${convA}'`), 0);
assert.equal(await count(`message_citations where message_id=${mAsst}`), 0);
assert.equal(await count(`collection_runs where id=${rs}`), 1); // 공개 수집 데이터는 계정과 무관하게 남음
// 슬롯 변경 시 이전 집합 연결은 끊기고 새 집합 데이터와 연결되지 않음
await q(`insert into user_search_slots (user_id, slot, search_set_id) values ($1,1,$2)`, [
  uB,
  sets[0],
]);
await q(`update user_search_slots set search_set_id=${sets[1]} where user_id='${uB}'`);
assert.equal(
  (await as(db, 'authenticated', uB, `select 1 from video_observations where run_id=${rs}`)).rows
    .length,
  0,
);
ok(
  '대화·검색 집합 정리, 계정 삭제 전파(공개 수집 데이터 보존), 슬롯 변경 시 이전 검색 데이터 접근 차단',
);

console.log(`PASS: ${checks}개 그룹 (합성 데이터, 로컬 PGlite, 실제 API·DB 0회)`);
await db.close();
