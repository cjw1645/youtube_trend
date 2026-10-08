import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createDb } from './db/harness.mjs';
// 로그인 없는 공개 조회: 허용 밖 파라미터 거부(캐시 우회 차단)와 하루 YouTube 유닛 예산(호출 전 소비, 초과 시 429·호출 0회).
// 서버 코드와 실제 SQL 함수(PGlite)를 연결하고 외부 호출은 모의 fetch다. 실제 호출 0회.

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-placeholder';
process.env.YOUTUBE_API_KEY = 'test-placeholder';
process.env.PUBLIC_YOUTUBE_DAILY_UNIT_CAP = '10';

const db = await createDb();
let youtube: { resource: string; maxResults: string | null }[] = [];
let storageDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
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
const VIDEO = 'dQw4w9WgXcQ';
const base = 'http://localhost';
try {
  const videos = await vite.ssrLoadModule('/api/videos.ts');
  const categories = await vite.ssrLoadModule('/api/categories.ts');
  const detail = await vite.ssrLoadModule('/api/video/[id].ts');
  const get = (mod: { GET: (r: Request) => Promise<Response> }, path: string) =>
    mod.GET(new Request(`${base}${path}`));
  const used = async () =>
    Number(
      (await db.query(`select used from quota_counters where kind = 'public_youtube'`)).rows[0]
        ?.used ?? 0,
    );

  // 1. 허용 밖 파라미터는 400이며 YouTube·예산 모두 호출하지 않는다(캐시 우회 차단)
  for (const [mod, path] of [
    [videos, '/api/videos?chart=popular&all=1&x=1'],
    [videos, '/api/videos?x=1'],
    [videos, `/api/videos?ids=${VIDEO}&cb=1`],
    [videos, '/api/videos?categoryId=10'],
    [videos, '/api/videos?order=date'],
    [categories, '/api/categories?x=1'],
    [categories, '/api/categories?id=10&x=1'],
    [detail, `/api/video/${VIDEO}?x=1`],
    [detail, `/api/video/${VIDEO}?id=abcdefghijk`],
  ] as const) {
    const res = await get(mod, path);
    assert.equal(res.status, 400, path);
  }
  assert.equal(youtube.length, 0);
  assert.equal(await used(), 0);

  // 2. 호출 전 유닛 소비: 인기 차트 4, 카테고리 1, 상세 2 (상한 10)
  assert.equal((await get(videos, '/api/videos?chart=popular&all=1')).status, 200);
  assert.equal(await used(), 4);
  assert.equal((await get(categories, '/api/categories')).status, 200);
  assert.equal(await used(), 5);
  assert.equal((await get(detail, `/api/video/${VIDEO}`)).status, 200);
  assert.equal(await used(), 7);
  assert.equal((await get(videos, `/api/videos?ids=${VIDEO}`)).status, 200);
  assert.equal(await used(), 8);
  // 배포 환경이 붙이는 같은 id 값은 허용한다
  assert.equal((await get(detail, `/api/video/${VIDEO}?id=${VIDEO}`)).status, 200);
  assert.equal(await used(), 10);

  // 3. 상한 소진 후에는 429이고 YouTube를 부르지 않는다. 입력 검증 실패는 소비하지 않는다.
  const calls = youtube.length;
  for (const path of ['/api/videos?chart=popular&all=1', '/api/videos']) {
    const res = await get(videos, path);
    assert.equal(res.status, 429, path);
    assert.equal(((await res.json()) as { code: string }).code, 'QUOTA_EXCEEDED');
  }
  assert.equal((await get(videos, '/api/videos?ids=short')).status, 400);
  assert.equal(youtube.length, calls);
  assert.equal(await used(), 10);

  // 4. 로그인 사용자 검색은 이 예산을 쓰지 않는다(별도 개인·전체 검색 한도)
  // 5. 예산 저장소 장애면 운영에서는 YouTube를 부르지 않는다
  storageDown = true;
  const down = await get(categories, '/api/categories');
  assert.ok(down.status >= 500);
  assert.equal(youtube.length, calls);
  console.log(
    'PASS: 공개 조회(허용 밖 파라미터 400·유닛 사전 소비·상한 초과 429 호출 0·저장소 장애 차단); 실제 호출 0회',
  );
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
  await db.close();
}
