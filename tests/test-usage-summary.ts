import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createDb } from './db/harness.mjs';
// GET /api/account: 오늘 쓴 AI 질문·검색 횟수와 하루 한도. 서버 상수가 SQL 함수의 한도 기본값과 같은지도 확인한다.
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
const rid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
try {
  const { GET } = await vite.ssrLoadModule('/api/account.ts');
  const { AI_DAILY_LIMIT, SEARCH_DAILY_LIMIT } = await vite.ssrLoadModule('/api/_lib/usage.ts');
  const jwt = await token();
  const usage = async (bearer: string | null = jwt) =>
    GET(
      new Request('http://localhost/api/account', {
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      }),
    );

  // 인증 없으면 401, 사용 전에는 0
  assert.equal((await usage(null)).status, 401);
  const first = await usage();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await first.json(), {
    usage: {
      ai: { used: 0, limit: AI_DAILY_LIMIT },
      search: { used: 0, limit: SEARCH_DAILY_LIMIT },
    },
  });

  // 예약한 만큼 늘고(검색은 유닛 합), 반환(released)한 예약은 세지 않는다
  await db.exec(`
    insert into quota_counters (kind, day, cap) values ('ai_requests', current_date, 100), ('search', current_date, 100);
  `);
  const now = new Date().toISOString();
  await db.query(`select * from reserve_ai_request('${USER}', '${rid(1)}', $1::timestamptz)`, [
    now,
  ]);
  await db.query(`select * from reserve_search('${USER}', '${rid(2)}', 4, $1::timestamptz)`, [now]);
  await db.query(`select * from reserve_search('${USER}', '${rid(3)}', 1, $1::timestamptz)`, [now]);
  const released = (
    await db.query<{ reservation_id: string }>(
      `select * from reserve_search('${USER}', '${rid(4)}', 3, $1::timestamptz)`,
      [now],
    )
  ).rows[0].reservation_id;
  await db.query(`select settle_usage('${USER}', $1, 'released', $2::timestamptz)`, [
    released,
    now,
  ]);
  const after = (await (await usage()).json()) as {
    usage: { ai: { used: number }; search: { used: number } };
  };
  assert.equal(after.usage.ai.used, 1);
  assert.equal(after.usage.search.used, 5, '4 + 1, 반환한 3은 제외');

  // 다른 사용자의 사용량은 섞이지 않는다
  const other = await token(OTHER);
  assert.deepEqual(
    ((await (await usage(other)).json()) as { usage: { ai: { used: number } } }).usage.ai.used,
    0,
  );

  // 하루가 지나면 다시 0(Asia/Seoul 일 경계): 어제 만든 예약은 세지 않는다
  await db.exec(`update usage_reservations set created_at = created_at - interval '2 days'`);
  const next = (await (await usage()).json()) as { usage: { ai: { used: number } } };
  assert.equal(next.usage.ai.used, 0);

  // 서버 상수는 SQL 함수의 한도 기본값과 같아야 한다(차단은 DB가 하므로 어긋나면 표시가 거짓이 된다)
  const signature = async (fn: string) =>
    (await db.query<{ a: string }>(`select pg_get_function_arguments('public.${fn}'::regproc) a`))
      .rows[0].a;
  assert.match(
    await signature('reserve_ai_request'),
    new RegExp(`p_daily_limit integer DEFAULT ${AI_DAILY_LIMIT}(?:,|$)`),
  );
  assert.match(
    await signature('reserve_search'),
    new RegExp(`p_daily_limit integer DEFAULT ${SEARCH_DAILY_LIMIT}(?:,|$)`),
  );

  console.log(
    'PASS: /api/account 사용량(401·no-store·유닛 합·반환 제외·사용자 격리·일 경계·SQL 한도 기본값과 상수 일치); 실제 호출 0회',
  );
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
  await db.close();
}
