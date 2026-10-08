import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createDb } from './db/harness.mjs';
// 로그인 없는 일반 검색의 서비스 전체 하루 예산: 한도 안에서만 search.list를 호출하고, 저장소 장애면 외부 호출을 막는다.
// 서버 코드와 실제 SQL 함수(PGlite)를 연결하고 외부 호출은 모의 fetch다. 실제 호출 0회.

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-placeholder';
process.env.YOUTUBE_API_KEY = 'test-placeholder';
process.env.GENERAL_SEARCH_DAILY_CAP = '2';

const db = await createDb();
let youtube: string[] = [];
let storageDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname === 'www.googleapis.com') {
    const resource = url.pathname.split('/').at(-1)!;
    youtube.push(resource);
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
  const { GET } = await vite.ssrLoadModule('/api/videos.ts');
  const search = (q: string) =>
    GET(new Request(`http://localhost/api/videos?q=${encodeURIComponent(q)}`));

  // 한도(2) 안의 서로 다른 검색 2건은 통과, 3번째는 429이며 YouTube를 부르지 않는다.
  assert.equal((await search('고양이')).status, 200);
  assert.equal((await search('강아지')).status, 200);
  const calls = youtube.length;
  const blocked = await search('토끼');
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, 'QUOTA_EXCEEDED');
  assert.equal(blocked.headers.get('Cache-Control'), 'no-store');
  assert.equal(youtube.length, calls);
  assert.equal(
    Number(
      (await db.query(`select used from quota_counters where kind = 'general_search'`)).rows[0]
        .used,
    ),
    2,
  );

  // 검색이 아닌 인기 목록은 이 예산을 쓰지 않는다.
  const popular = await GET(new Request('http://localhost/api/videos'));
  assert.equal(popular.status, 200);
  assert.equal(
    Number(
      (await db.query(`select used from quota_counters where kind = 'general_search'`)).rows[0]
        .used,
    ),
    2,
  );

  // 예산 저장소 장애면 운영에서는 YouTube 검색을 호출하지 않는다.
  storageDown = true;
  const before = youtube.length;
  const down = await search('새검색');
  assert.ok(down.status >= 500);
  assert.equal(youtube.length, before);
  console.log(
    'PASS: 일반 검색 하루 예산(한도 초과 429·호출 0, 인기 목록 제외, 저장소 장애 시 차단); 실제 호출 0회',
  );
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
  await db.close();
}
