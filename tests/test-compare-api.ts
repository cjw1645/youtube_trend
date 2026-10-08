import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createDb } from './db/harness.mjs';
// /api/search-compare: 토큰 검증 후 본인 슬롯의 검색 수집과 인기 차트 수집을 실제 SQL 함수(PGlite)로 비교한다.
// 서버 코드와 실제 SQL 함수(PGlite)를 연결하고 외부 호출은 모의 fetch다. 실제 호출 0회.

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-placeholder';
process.env.YOUTUBE_API_KEY = 'test-placeholder';

const ISS = 'https://proj.supabase.co/auth/v1';
const USER = '11111111-1111-4111-8111-111111111111';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
const token = (sub = USER) =>
  new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(sub)
    .setIssuer(ISS)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);

const db = await createDb();
await db.exec(`insert into auth.users (id) values ('${USER}')`);
const OTHER = '22222222-2222-4222-8222-222222222222';
await db.exec(`insert into auth.users (id) values ('${OTHER}')`);
let youtube: { resource: string; maxResults: string | null }[] = [];
let storageDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
  if (url.hostname === 'www.googleapis.com') {
    const resource = url.pathname.split('/').at(-1)!;
    youtube.push({ resource, maxResults: url.searchParams.get('maxResults') });
    if (resource === 'search')
      return Response.json({ items: [{ id: { videoId: 'aaaaaaaaaaa' } }] });
    if (resource === 'videos')
      return Response.json({
        items: [
          {
            id: 'aaaaaaaaaaa',
            snippet: {
              title: '영상',
              description: '',
              channelId: 'c',
              channelTitle: '채널',
              publishedAt: '2026-10-06T00:00:00Z',
              categoryId: '10',
              thumbnails: {},
            },
            statistics: { viewCount: '1' },
            contentDetails: { duration: 'PT3M' },
          },
        ],
      });
    return Response.json({ items: [] });
  }
  const match = /\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
  if (url.hostname === 'proj.supabase.co' && match) {
    if (storageDown) return new Response('{}', { status: 500 });
    const fn = match[1];
    const args = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const names = Object.keys(args);
    const call = names
      .map((name, i) => `${name} := $${i + 1}${name === 'p_day' ? '::date' : ''}`)
      .join(', ');
    await db.exec('set role service_role');
    try {
      const result = await db.query<Record<string, unknown>>(
        `select * from ${fn}(${call})`,
        names.map((name) => args[name]),
      );
      const scalar = result.fields.length === 1 && result.fields[0].name === fn;
      return new Response(
        JSON.stringify(scalar ? (result.rows[0] as Record<string, unknown>)[fn] : result.rows),
      );
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
try {
  const { GET } = await vite.ssrLoadModule('/api/search-data.ts');
  const jwt = await token();
  const get = (slot: number, bearer: string | null = jwt) =>
    GET(
      new Request(`http://localhost/api/search-data?kind=compare&slot=${slot}`, {
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      }),
    );
  const body = async (res: Response) => (await res.json()) as { compare: any; code?: string };

  assert.equal((await get(1, null)).status, 401);
  assert.equal((await get(3)).status, 400);

  // 슬롯이 없거나 완료된 검색 수집이 없으면 compare: null
  assert.equal((await body(await get(1))).compare, null);

  const set = (
    await db.query<{ id: number }>(
      `insert into search_sets (query_norm, language) values ('고양이 간식','ko') returning id`,
    )
  ).rows[0].id;
  await db.exec(
    `insert into user_search_slots (user_id, slot, search_set_id) values ('${USER}', 1, ${set})`,
  );
  const run = async (kind: string, setId: number | null, at: string, count: number) =>
    (
      await db.query<{ id: number }>(
        `insert into collection_runs (kind, search_set_id, scheduled_for, finished_at, status, pages_expected, pages_fetched, item_count, expires_at)
         values ($1, $2, $3::timestamptz, $3::timestamptz, 'complete', 1, 1, $4, $3::timestamptz + interval '14 days') returning id`,
        [kind, setId, at, count],
      )
    ).rows[0].id;
  const searchRun = await run('search', set, '2026-10-08T04:00:00Z', 20);
  assert.equal((await body(await get(1))).compare.available, false, '인기 수집이 없으면 비교 불가');

  const popularRun = await run('popular', null, '2026-10-08T05:00:00Z', 10);
  await db.exec(`
    insert into keyword_counts (run_id, keyword, video_count, channel_count) values
      (${searchRun}, '고양이', 8, 3), (${searchRun}, '간식', 4, 2), (${searchRun}, '장난감', 3, 2),
      (${popularRun}, '게임', 5, 4), (${popularRun}, '고양이', 2, 2);
    insert into category_counts (run_id, category_id, video_count) values
      (${searchRun}, '15', 16), (${searchRun}, '24', 4), (${popularRun}, '20', 6), (${popularRun}, '24', 4);
  `);

  const compare = (await body(await get(1))).compare;
  assert.equal(compare.available, true);
  assert.equal(compare.query, '고양이 간식');
  assert.equal(compare.slot.runId, searchRun);
  assert.equal(compare.popular.runId, popularRun);
  const cat = compare.exposure.tokens.find((t: { keyword: string }) => t.keyword === '고양이');
  assert.deepEqual([cat.popularCount, cat.popularShare, cat.rank], [2, 0.2, 2]);
  const snack = compare.exposure.tokens.find((t: { keyword: string }) => t.keyword === '간식');
  assert.equal(snack.popularCount, null, '인기 집계에 없는 토큰은 null');
  assert.deepEqual(
    compare.keywords.common.map((k: { keyword: string }) => k.keyword),
    ['고양이'],
  );
  assert.deepEqual(
    compare.keywords.slotOnly.map((k: { keyword: string }) => k.keyword),
    ['간식', '장난감'],
  );
  assert.equal(compare.categories[0].categoryId, '15');
  assert.equal(compare.videos.count, 0);
  assert.equal(compare.slotKeywordCount, 3);
  assert.deepEqual(
    compare.engagement.slice(0, 2).map((e: { kind: string }) => e.kind),
    ['search', 'popular'],
  );
  assert.equal((await get(1)).headers.get('Cache-Control'), 'no-store');

  // 다른 사용자는 이 슬롯의 데이터를 볼 수 없다
  const other = await token(OTHER);
  assert.equal((await body(await get(1, other))).compare, null);

  console.log(
    'PASS: /api/search-compare(401·400·슬롯 없음 null·인기 수집 없음 비교 불가·실제 SQL 함수 결과·no-store·다른 사용자 격리); 실제 호출 0회',
  );
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
  await db.close();
}
