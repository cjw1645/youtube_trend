import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createDb } from './db/harness.mjs';
// 실제 YouTube·Supabase 없이 키워드 집계 저장, 트렌드 입력 SQL, 비교 계산을 합성 데이터로 검증한다.
// 서버 코드(buildPayload·buildTrend)와 실제 SQL 함수(로컬 PGlite)를 연결한다. 외부 호출 0회.

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-placeholder';

const db = await createDb();
const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const { buildPayload } = await vite.ssrLoadModule('/api/_lib/collect.ts');
const { buildTrend } = await vite.ssrLoadModule('/api/_lib/trend.ts');
const { storedKeywordCounts } = await vite.ssrLoadModule('/src/lib/stats/keywords.ts');

const BASE = Date.parse('2026-10-08T00:00:00Z');
const T = (hours: number) => new Date(BASE + hours * 3_600_000).toISOString();
const svc = async (sql: string, params?: unknown[]) => {
  await db.exec('set role service_role');
  try {
    return await db.query<Record<string, any>>(sql, params);
  } finally {
    await db.exec('reset role');
  }
};
const vid = (i: number) => `vid${String(i).padStart(8, '0')}`;

interface V {
  i: number;
  title: string;
  tags?: string[];
  cat?: string;
  dur?: number | null;
  ch?: string;
}
const snap = (videos: V[]) => ({
  pagesFetched: Math.max(1, Math.ceil(videos.length / 50)),
  units: 8,
  complete: true,
  videos: videos.map((v, k) => ({
    id: vid(v.i),
    position: k + 1,
    title: v.title,
    description: '',
    tags: v.tags ?? [],
    categoryId: v.cat ?? '10',
    channelId: v.ch ?? `UC${v.i}`,
    publishedAt: '2026-10-01T00:00:00Z',
    durationSeconds: v.dur === undefined ? 100 : v.dur,
    thumbnailUrl: null,
    viewCount: 1000,
    likeCount: 1,
    commentCount: 0,
  })),
  channels: [],
});

async function ingest(
  hours: number,
  videos: V[],
  kind: 'popular' | 'search' = 'popular',
  setId?: number,
) {
  let runId: number;
  if (kind === 'popular') {
    const started = (
      await svc(`select * from start_popular_run($1::timestamptz, $1::timestamptz)`, [T(hours)])
    ).rows[0];
    assert.equal(started.state, 'started');
    runId = Number(started.run_id);
  } else {
    const started = (
      await svc(`select * from start_search_run($1, $2::timestamptz, $2::timestamptz)`, [
        setId,
        T(hours),
      ])
    ).rows[0];
    assert.equal(started.state, 'started');
    runId = Number(started.run_id);
  }
  const payload = buildPayload(snap(videos), T(hours), T(hours));
  const fn = kind === 'popular' ? 'finish_popular_run' : 'finish_search_run';
  assert.equal(
    (
      await svc(`select ${fn}($1, $2::jsonb, $3::timestamptz) r`, [
        runId,
        JSON.stringify(payload),
        T(hours),
      ])
    ).rows[0].r,
    'complete',
  );
  return runId;
}

// 현재: 12개. 고양이 5, 여행 3, 간식 2(저장 기준 2는 충족, 표시 기준 3 미만)
const cur: V[] = [
  ...[1, 2, 3, 4, 5].map((i) => ({
    i,
    title: `고양이 브이로그${i}`,
    cat: '15',
    dur: [30, 100, 200, 700, 50][i - 1],
  })),
  ...[6, 7, 8].map((i) => ({ i, title: `여행 기록${i}`, cat: '19', dur: i === 8 ? null : 400 })),
  ...[9, 10].map((i) => ({ i, title: `간식 레시피${i}`, cat: '26', dur: 0 })),
  { i: 11, title: '유일한제목열하나', cat: '26' },
  { i: 12, title: '유일한제목열둘', cat: '26' },
];
// 직전(1시간 전): 1~10 유지(고양이 3개만), 11·12 대신 20·21
const prev: V[] = [
  ...[1, 2, 3].map((i) => ({ i, title: `고양이 브이로그${i}`, cat: '15' })),
  ...[4, 5].map((i) => ({ i, title: `다른제목${i}`, cat: '15' })),
  ...[6, 7, 8, 9, 10].map((i) => ({
    i,
    title: i === 6 ? `여행 기록${i}` : `다른제목${i}`,
    cat: i < 9 ? '19' : '26',
  })),
  { i: 20, title: '이탈영상스무', cat: '26' },
  { i: 21, title: '이탈영상스물하나', cat: '26' },
];
// 전일 동시간보다 1시간 일찍 수집한 실행(허용 오차 안), 7일 전은 3시간 어긋난 실행(허용 오차 밖)
const day: V[] = [1, 2, 3, 4, 5, 6].map((i) => ({ i, title: `고양이 브이로그${i}`, cat: '15' }));
const outsideWeek: V[] = [1, 2].map((i) => ({ i, title: `아주옛날${i}`, cat: '15' }));

try {
  // 1. 키워드 집계 규칙 (순수 함수)
  const sample = storedKeywordCounts(
    cur.map((v) => ({ title: v.title, tags: v.tags, channelId: v.ch ?? `UC${v.i}` })),
  );
  assert.deepEqual(
    sample.map((k: any) => [k.keyword, k.videoCount, k.channelCount]),
    [
      ['고양이', 5, 5],
      ['여행', 3, 3],
      ['간식', 2, 2],
    ],
  );
  // 같은 영상 안 반복은 1회, 같은 채널은 영상 수와 채널 수를 구분한다.
  const repeated = storedKeywordCounts([
    { title: '고양이 고양이 놀이', tags: ['고양이'], channelId: 'A' },
    { title: '고양이 장난감', channelId: 'A' },
  ]);
  assert.deepEqual(
    repeated.map((k: any) => [k.keyword, k.videoCount, k.channelCount]),
    [['고양이', 2, 1]],
  );
  console.log('  ok 키워드 집계 규칙');

  // 2. 적재: 키워드가 저장되고 aggregate_version 2
  const outsideId = await ingest(-168 - 3, outsideWeek);
  const dayId = await ingest(-25, day);
  const prevId = await ingest(-1, prev);
  const curId = await ingest(0, cur);
  const stored = (
    await svc(
      `select keyword, video_count, channel_count from keyword_counts where run_id = $1 order by video_count desc, keyword`,
      [curId],
    )
  ).rows;
  assert.deepEqual(
    stored.map((r) => [r.keyword, Number(r.video_count), Number(r.channel_count)]),
    [
      ['고양이', 5, 5],
      ['여행', 3, 3],
      ['간식', 2, 2],
    ],
  );
  assert.equal(
    Number(
      (await svc(`select aggregate_version from collection_runs where id = $1`, [curId])).rows[0]
        .aggregate_version,
    ),
    2,
  );
  console.log('  ok 적재·키워드 저장');

  // 3. 트렌드 입력과 비교
  const inputs = (await svc(`select get_popular_trend_inputs() r`)).rows[0].r;
  assert.equal(inputs.current.run_id, curId);
  assert.equal(inputs.baselines.previous.run_id, prevId);
  assert.equal(inputs.baselines.day.run_id, dayId); // -25시간은 오차 1시간 안
  assert.equal(inputs.baselines.week, null); // -171시간은 오차 3시간이라 제외
  assert.equal(inputs.baselines.month, null);
  assert.equal(outsideId > 0, true);
  const trend = buildTrend(inputs);
  assert.equal(trend.current.itemCount, 12);
  assert.equal(trend.current.smallSample, false);
  const [previous, dayCmp, week, month] = trend.comparisons;
  assert.deepEqual(
    [previous.kind, dayCmp.kind, week.kind, month.kind],
    ['previous', 'day', 'week', 'month'],
  );
  assert.equal(week.available, false);
  assert.equal(week.reason, 'no_baseline');
  assert.equal(month.available, false);

  // 영상 잔류·신규·이탈 (1~10 유지, 11·12 신규, 20·21 이탈)
  assert.deepEqual(previous.videos, { retained: 10, entered: 2, left: 2, retainedShare: 10 / 12 });
  assert.equal(previous.baseline.gapMinutes, 60);
  // 키워드: 분모는 실제 수집 개수
  const cat = previous.keywords.find((k: any) => k.keyword === '고양이');
  assert.equal(cat.count, 5);
  assert.equal(cat.baseCount, 3);
  assert.ok(Math.abs(cat.share - 5 / 12) < 1e-9);
  assert.ok(Math.abs(cat.baseShare - 3 / 12) < 1e-9);
  assert.ok(Math.abs(cat.deltaPp - (5 / 12 - 3 / 12) * 100) < 1e-9);
  // 직전에는 여행이 1개뿐이라 저장되지 않음 → 0이 아니라 기준 미만
  const trip = previous.keywords.find((k: any) => k.keyword === '여행');
  assert.equal(trip.belowBaseline, true);
  assert.equal(trip.baseCount, null);
  assert.equal(trip.deltaPp, null);
  // 표시 기준(3개) 미만인 간식은 비교 목록에 없다
  assert.equal(
    previous.keywords.some((k: any) => k.keyword === '간식'),
    false,
  );
  // 카테고리: 직전 15=5개, 19=3개(6,7,8), 26=… 현재와 퍼센트포인트 차
  const c15 = previous.categories.find((c: any) => c.categoryId === '15');
  assert.equal(c15.count, 5);
  assert.equal(c15.baseCount, 5);
  assert.equal(c15.deltaPp, 0);
  // 전일 동시간(6개): 현재 12개와 분모가 달라도 비율로 비교
  const dayCat = dayCmp.categories.find((c: any) => c.categoryId === '15');
  assert.ok(Math.abs(dayCat.baseShare - 1) < 1e-9);
  assert.equal(dayCmp.smallSample, true); // 기준 목록 6개 < 10
  // 길이 구간: 알 수 없는 길이는 분모에서 제외하고 따로 센다 (cur: 30,100,200,700,50,400,400,null,0,0,100,100)
  assert.deepEqual(trend.current.lengths.counts, { u60: 2, u180: 3, u600: 3, o600: 1 });
  assert.equal(trend.current.lengths.unknown, 3);
  assert.equal(trend.current.lengths.known, 9);
  console.log('  ok 트렌드 입력·비교 (직전/전일/7일/28일, 잔류·신규·이탈)');

  // 4. 시계열: 기준 키워드 없는 시점은 null (0 아님)
  const gojiyang = trend.series.find((s: any) => s.keyword === '고양이');
  assert.deepEqual(
    gojiyang.points.map((p: any) => p.videoCount),
    [6, 3, 5],
  );
  // 여행은 전일·직전 실행에 저장되지 않아 null
  assert.deepEqual(
    trend.series.find((s: any) => s.keyword === '여행').points.map((p: any) => p.videoCount),
    [null, null, 3],
  );
  console.log('  ok 시계열(없는 값은 null)');

  // 5. 개인 슬롯: 소유자만 읽고, 완료 실행이 없으면 null
  const user = '00000000-0000-0000-0000-0000000000a1';
  const other = '00000000-0000-0000-0000-0000000000b2';
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [user, other]);
  const set = (
    await db.query<Record<string, any>>(
      `insert into search_sets (query_norm) values ('고양이') returning id`,
    )
  ).rows[0].id;
  await db.query(
    `insert into user_search_slots (user_id, slot, search_set_id) values ($1, 1, $2)`,
    [user, set],
  );
  assert.equal(
    (await svc(`select get_slot_trend_inputs($1, 1::smallint) r`, [user])).rows[0].r,
    null,
  ); // 아직 수집 없음
  const searchRun = await ingest(0, cur, 'search', Number(set));
  const own = (await svc(`select get_slot_trend_inputs($1, 1::smallint) r`, [user])).rows[0].r;
  assert.equal(own.current.run_id, searchRun);
  assert.equal(
    (await svc(`select get_slot_trend_inputs($1, 1::smallint) r`, [other])).rows[0].r,
    null,
  ); // 남의 슬롯
  assert.equal(
    (await svc(`select get_slot_trend_inputs($1, 2::smallint) r`, [user])).rows[0].r,
    null,
  ); // 빈 슬롯
  // 개인 검색은 공통 인기 실행과 섞이지 않는다
  assert.equal(own.baselines.previous, null);
  assert.equal(
    buildTrend(own).comparisons.every((c: any) => !c.available),
    true,
  );
  console.log('  ok 개인 슬롯 격리·집합 분리');

  // 6. 권한: 브라우저 역할은 새 함수를 실행할 수 없다
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query(`select get_popular_trend_inputs()`));
    await db.exec('reset role');
  }
  console.log('  ok 브라우저 역할 실행 차단');

  // 7. 태그가 스냅샷 영상에 포함되어 근거 영상 탐색에 쓸 수 있다
  const latest = (await svc(`select get_latest_popular() r`)).rows[0].r;
  assert.ok(Array.isArray(latest.snapshot.videos[0].tags));
  console.log('  ok 스냅샷 영상 태그 포함');
  console.log('test-trend: all passed');
} finally {
  await vite.close();
  await db.close();
}
