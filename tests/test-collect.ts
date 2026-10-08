import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createDb } from './db/harness.mjs';
// 실제 Supabase·YouTube 없이 수집 서버 코드와 실제 SQL 함수(로컬 PGlite)를 연결해 통합 검증한다.
// PostgREST RPC 호출을 PGlite의 service_role 쿼리로 대체한다. 모든 데이터는 합성이다.

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

let youtubeCalls: string[] = [];
let ytHandler: (url: URL) => Response = () => new Response('{}', { status: 500 });
let rpcOverride: ((fn: string) => Response | null) | undefined;
let rpcLog: string[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname === 'www.googleapis.com') {
    youtubeCalls.push(url.pathname.split('/').pop()! + url.search);
    return ytHandler(url);
  }
  const match = /\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
  if (url.hostname === 'proj.supabase.co' && match) {
    const fn = match[1];
    rpcLog.push(fn);
    const override = rpcOverride?.(fn);
    if (override) return override;
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
      const body = scalar ? (result.rows[0] as Record<string, unknown>)[fn] : result.rows;
      return new Response(JSON.stringify(body ?? null), { status: 200 });
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
const rawVideo = (i: number, extra: Record<string, unknown> = {}) => ({
  id: vid(i),
  snippet: {
    publishedAt: '2026-10-01T00:00:00Z',
    channelId: `UC${String(i % 120).padStart(4, '0')}`,
    channelTitle: `채널${i % 120}`,
    title: `제목${i}`,
    description: `설명${i}`,
    thumbnails: { high: { url: `https://i/${i}.jpg` } },
    tags: ['태그'],
    categoryId: String((i % 5) + 1),
  },
  statistics: { viewCount: String(1000 + i), likeCount: i === 3 ? undefined : '0' },
  contentDetails: { duration: 'PT3M' },
  ...extra,
});
/** pages: 페이지별 영상 번호 목록. 마지막 페이지에만 nextPageToken이 없다. */
function youtube(pages: number[][], opts: { failPage?: number; failChannels?: boolean } = {}) {
  ytHandler = (url) => {
    if (url.pathname.endsWith('/videos')) {
      const page = url.searchParams.get('pageToken')
        ? Number(url.searchParams.get('pageToken'))
        : 0;
      if (opts.failPage === page + 1)
        return new Response('{"error":{"errors":[{"reason":"backendError"}]}}', { status: 500 });
      const ids = pages[page] ?? [];
      return new Response(
        JSON.stringify({
          items: ids.map((i) => rawVideo(i)),
          ...(page + 1 < pages.length ? { nextPageToken: String(page + 1) } : {}),
        }),
      );
    }
    if (url.pathname.endsWith('/channels')) {
      if (opts.failChannels) return new Response('{}', { status: 500 });
      const ids = (url.searchParams.get('id') ?? '').split(',');
      return new Response(
        JSON.stringify({
          items: ids.map((id, k) => ({
            id,
            snippet: { title: id, thumbnails: { default: { url: 'https://c/x.jpg' } } },
            statistics:
              k === 0
                ? { hiddenSubscriberCount: true }
                : { subscriberCount: String(500 + k), hiddenSubscriberCount: false },
          })),
        }),
      );
    }
    return new Response('{}', { status: 404 });
  };
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const reset = () => {
  youtubeCalls = [];
  rpcLog = [];
  rpcOverride = undefined;
};
const hour = (h: number) =>
  new Date(Date.parse('2026-10-08T00:00:00Z') + h * 3_600_000 + 12 * 60_000);
const q = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
const count = async (sql: string) => Number((await q(`select count(*) c from ${sql}`))[0].c);

try {
  const { runPopularCollection, scheduledHour, kstDay } =
    await vite.ssrLoadModule('/api/_lib/collect.ts');
  const collectApi = await vite.ssrLoadModule('/api/collect.ts');
  const snapshotApi = await vite.ssrLoadModule('/api/_lib/handlers/snapshot.ts');

  // 시각 계산
  assert.equal(
    scheduledHour(new Date('2026-10-08T05:59:59.999Z')).toISOString(),
    '2026-10-08T05:00:00.000Z',
  );
  assert.equal(kstDay(new Date('2026-10-08T14:59:59Z')), '2026-10-08');
  assert.equal(kstDay(new Date('2026-10-08T15:00:00Z')), '2026-10-09');

  // A. 4페이지: 페이지 간 중복(2개)은 제거, 채널은 묶음 조회
  reset();
  youtube([range(1, 50), [49, 50, ...range(51, 98)], range(99, 148), range(149, 198)]);
  const a = await runPopularCollection(hour(0));
  assert.equal(a.state, 'complete');
  assert.equal(a.items, 198);
  assert.equal(a.pages, 4);
  assert.equal(a.units, 4 + 3); // 인기 4 + 채널 120개/50 = 3
  assert.equal(youtubeCalls.filter((c) => c.startsWith('videos')).length, 4);
  assert.equal(await count('video_observations'), 198);
  assert.equal(await count('channel_observations'), 120);
  const run = (
    await q(`select status, item_count, pages_fetched, quota_units from collection_runs`)
  )[0];
  assert.deepEqual(
    [run.status, run.item_count, run.pages_fetched, Number(run.quota_units)],
    ['complete', 198, 4, 7],
  );
  assert.equal(
    Number((await q(`select used from quota_counters where kind='youtube_units'`))[0].used),
    8,
  ); // 사전 확보 8
  assert.equal(
    Number((await q(`select cap from quota_counters where kind='youtube_units'`))[0].cap),
    1000,
  );
  const pos = await q(`select position from video_observations order by position`);
  assert.deepEqual(
    pos.map((p) => p.position),
    range(1, 198),
  );
  const nulls = await q(`select like_count from video_observations where video_id='${vid(3)}'`);
  assert.equal(nulls[0].like_count, null); // 누락은 null
  assert.equal(
    String(
      (await q(`select like_count from video_observations where video_id='${vid(4)}'`))[0]
        .like_count,
    ),
    '0',
  );
  assert.ok(
    (
      await q(
        `select 1 from channel_observations where subscribers_hidden and subscriber_count is null`,
      )
    ).length > 0,
  );

  // 같은 시각 재호출: 완료됨 → YouTube 호출 없음
  reset();
  const again = await runPopularCollection(hour(0));
  assert.equal(again.state, 'done');
  assert.equal(youtubeCalls.length, 0);

  // B. 다음 시각: 목록이 2페이지에서 끝남(토큰 종료) → 100개, 제목 수정은 새 버전
  reset();
  youtube([range(1, 50), range(51, 100)]);
  const b = await runPopularCollection(hour(1));
  assert.deepEqual([b.state, b.items, b.pages], ['complete', 100, 2]);
  const meta = (
    await q(
      `select pages_fetched, pages_expected from collection_runs order by scheduled_for desc limit 1`,
    )
  )[0];
  assert.deepEqual([meta.pages_fetched, meta.pages_expected], [2, 2]);
  assert.equal(await count('video_versions'), 198); // 같은 내용은 재사용
  ytHandler = ((prev) => (url: URL) => {
    const res = prev(url);
    return res;
  })(ytHandler);

  // C. 빈 목록 → 실패(공개 안 함)
  reset();
  youtube([[]]);
  const c = await runPopularCollection(hour(2));
  assert.deepEqual([c.state, c.errorCode], ['incomplete', 'EMPTY_RESPONSE']);
  assert.equal(
    (
      await q(
        `select status from collection_runs where scheduled_for = '${hour(2).toISOString().slice(0, 13)}:00:00Z'`,
      )
    )[0].status,
    'failed',
  );

  // D. 2페이지 실패 → partial, 적재 없음, 최신 공개 스냅샷은 이전 성공 유지, 같은 시각 재시도 성공
  reset();
  youtube([range(1, 50), range(51, 100), range(101, 150)], { failPage: 2 });
  const d = await runPopularCollection(hour(3));
  assert.deepEqual([d.state, d.pages, d.errorCode], ['incomplete', 1, 'UPSTREAM_ERROR']);
  assert.equal(
    await count(
      `video_observations o join collection_runs r on r.id=o.run_id where r.scheduled_for='${hour(3).toISOString().slice(0, 13)}:00:00Z'`,
    ),
    0,
  );
  assert.equal(youtubeCalls.length, 2); // 실패 이후 추가 호출 없음(자동 재시도 없음)
  const mid = (await snapshotApi.GET()).clone();
  const midBody = (await mid.json()) as {
    snapshot: { item_count: number };
    last_attempt: { status: string };
    lag_minutes: number;
  };
  assert.equal(midBody.snapshot.item_count, 100); // 마지막 성공(1시) 유지
  assert.equal(midBody.last_attempt.status, 'partial');
  reset();
  youtube([range(1, 50), range(51, 100), range(101, 150)]);
  const d2 = await runPopularCollection(hour(3));
  assert.deepEqual([d2.state, d2.items], ['complete', 150]);
  assert.equal(
    await count(
      `collection_runs where scheduled_for='${hour(3).toISOString().slice(0, 13)}:00:00Z'`,
    ),
    1,
  );

  // E. 채널 조회 실패 → 불완전(영상만으로 완전 스냅샷 취급하지 않음)
  reset();
  youtube([range(1, 10)], { failChannels: true });
  const e = await runPopularCollection(hour(4));
  assert.equal(e.state, 'incomplete');
  assert.equal(
    (
      await q(
        `select status from collection_runs where scheduled_for='${hour(4).toISOString().slice(0, 13)}:00:00Z'`,
      )
    )[0].status,
    'partial',
  );

  // F. 쿼터 초과(첫 호출) → failed, 예산 소비는 유지
  reset();
  ytHandler = () =>
    new Response('{"error":{"errors":[{"reason":"quotaExceeded"}]}}', { status: 403 });
  const f = await runPopularCollection(hour(5));
  assert.deepEqual([f.state, f.errorCode, f.pages], ['incomplete', 'QUOTA_EXCEEDED', 0]);
  assert.equal(
    (
      await q(
        `select status, error_code from collection_runs where scheduled_for='${hour(5).toISOString().slice(0, 13)}:00:00Z'`,
      )
    )[0].status,
    'failed',
  );

  // G. 동시 실행: 한 번만 수집
  reset();
  youtube([range(1, 50)]);
  const [g1, g2] = await Promise.all([
    runPopularCollection(hour(6)),
    runPopularCollection(hour(6)),
  ]);
  assert.deepEqual([g1.state, g2.state].sort(), ['busy', 'complete']);
  assert.equal(youtubeCalls.filter((c) => c.startsWith('videos')).length, 1);
  assert.equal(
    await count(
      `collection_runs where scheduled_for='${hour(6).toISOString().slice(0, 13)}:00:00Z'`,
    ),
    1,
  );

  // H. 적재 저장소 오류 → store_failed, 부분 적재 없음, 같은 시각 재시도 가능
  reset();
  youtube([range(1, 50)]);
  rpcOverride = (fn) => (fn === 'finish_popular_run' ? new Response('{}', { status: 500 }) : null);
  const h = await runPopularCollection(hour(7));
  assert.deepEqual([h.state, h.errorCode], ['store_failed', 'STORE_ERROR']);
  assert.equal(
    (
      await q(
        `select status from collection_runs where scheduled_for='${hour(7).toISOString().slice(0, 13)}:00:00Z'`,
      )
    )[0].status,
    'failed',
  );
  reset();
  youtube([range(1, 50)]);
  assert.equal((await runPopularCollection(hour(7))).state, 'complete');

  // I. 시작 단계 저장소 오류 → YouTube 호출 없음(예외)
  reset();
  youtube([range(1, 50)]);
  rpcOverride = (fn) => (fn === 'start_popular_run' ? new Response('{}', { status: 500 }) : null);
  await assert.rejects(runPopularCollection(hour(8)));
  assert.equal(youtubeCalls.length, 0);

  // J. 예산 소진 → YouTube 호출 없음
  reset();
  youtube([range(1, 50)]);
  await db.exec(
    `update quota_counters set cap = used + 7 where kind = 'youtube_units' and day = '${kstDay(hour(9))}'`,
  );
  const j = await runPopularCollection(hour(9));
  assert.equal(j.state, 'budget_exhausted');
  assert.equal(youtubeCalls.length, 0);
  assert.equal(
    (
      await q(
        `select error_code from collection_runs where scheduled_for='${hour(9).toISOString().slice(0, 13)}:00:00Z'`,
      )
    )[0].error_code,
    'BUDGET_EXHAUSTED',
  );

  // K. 인증: 비밀 없음/틀림/설정 미흡은 거부, 저장소·YouTube 호출 0
  const call = (auth?: string) =>
    collectApi.POST(
      new Request('http://localhost/api/collect', {
        method: 'POST',
        headers: auth ? { Authorization: auth } : {},
      }),
    );
  reset();
  youtube([range(1, 5)]);
  for (const auth of [
    undefined,
    'Bearer wrong',
    `Bearer ${SECRET}x`,
    'Basic abc',
    `bearer ${SECRET}`,
  ]) {
    const res = await call(auth);
    assert.equal(res.status, 401, String(auth));
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal(rpcLog.length + youtubeCalls.length, 0);
  assert.equal(collectApi.GET, undefined); // 브라우저 GET 진입점 없음
  process.env.COLLECT_SECRET = 'short';
  assert.equal((await call('Bearer short')).status, 500);
  delete process.env.COLLECT_SECRET;
  assert.equal((await call('Bearer ')).status, 500);
  process.env.COLLECT_SECRET = SECRET;
  assert.equal(rpcLog.length + youtubeCalls.length, 0);
  const ok = await call(`Bearer ${SECRET}`);
  assert.ok([200, 502].includes(ok.status));
  const text = await ok.text();
  assert.ok(!text.includes(SECRET) && !text.includes('service-placeholder'));

  // L. 공개 스냅샷 API: 캐시 허용, 사용자 데이터 없음
  const snap = await snapshotApi.GET();
  assert.match(snap.headers.get('cache-control') ?? '', /^public, s-maxage=300/);
  const snapBody = (await snap.json()) as {
    snapshot: { videos: { position: number; channel_title: string }[] };
  };
  assert.equal(snapBody.snapshot.videos[0].position, 1);
  assert.ok(snapBody.snapshot.videos[0].channel_title);

  console.log(
    'PASS: 4페이지 중복 제거·채널 묶음·예산 선확보, 토큰 종료(2페이지), 빈 목록/2페이지 실패/채널 실패/쿼터 초과는 비공개 실패 기록, 같은 시각 재시도, 동시 실행 1회, 적재 오류 롤백·재시도, 시작 오류 시 호출 0, 예산 소진 시 호출 0, 수집 인증, 공개 스냅샷; 실제 호출 0회',
  );
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
  await db.close();
}
