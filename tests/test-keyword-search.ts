import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createDb } from './db/harness.mjs';
// 키워드 검색(/api/videos?q=): 로그인 필수, 호출 전 개인·전체 한도 예약, 같은 requestId 재전송은 외부 호출 0회.
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
const token = () =>
  new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(USER)
    .setIssuer(ISS)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);

const db = await createDb();
await db.exec(`insert into auth.users (id) values ('${USER}')`);
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
let seq = 0;
const rid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const used = async () =>
  Number(
    (await db.query(`select coalesce(sum(used),0) u from quota_counters where kind = 'search'`))
      .rows[0].u,
  );
try {
  const { GET } = await vite.ssrLoadModule('/api/videos.ts');
  const jwt = await token();
  const search = (q: string, requestId = rid(), bearer: string | null = jwt) =>
    GET(
      new Request(`http://localhost/api/videos?q=${encodeURIComponent(q)}&requestId=${requestId}`, {
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      }),
    );

  // (a) 토큰 없음 → 401, 외부 호출 0
  const anon = await search('고양이', rid(), null);
  assert.equal(anon.status, 401);
  assert.equal(((await anon.json()) as { code: string }).code, 'UNAUTHORIZED');
  assert.equal(youtube.length, 0);

  // 잘못된 요청: requestId 없음/형식 오류, 더는 받지 않는 파라미터
  assert.equal((await search('고양이', 'not-a-uuid')).status, 400);
  for (const extra of ['categoryId=10', 'order=date'])
    assert.equal(
      (
        await GET(
          new Request(`http://localhost/api/videos?q=x&requestId=${rid()}&${extra}`, {
            headers: { Authorization: `Bearer ${jwt}` },
          }),
        )
      ).status,
      400,
    );
  assert.equal(youtube.length, 0);

  // (b) 유효 토큰 → search·videos 1회씩, 결과 50개 요청, 사용자별 응답은 공용 캐시 금지
  const ok = await search('고양이');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(
    youtube.map((c) => c.resource),
    ['search', 'videos'],
  );
  assert.equal(youtube[0].maxResults, '50');
  assert.equal(((await ok.json()) as { items: unknown[] }).items.length, 1);
  assert.equal(await used(), 1);

  // (d) 같은 requestId 재전송 → 외부 호출 0, 이중 차감 없음
  const again = rid();
  assert.equal((await search('강아지', again)).status, 200);
  const before = youtube.length;
  const dup = await search('강아지', again);
  assert.equal(dup.status, 409);
  assert.equal(youtube.length, before);
  assert.equal(await used(), 2);

  // (c) 개인 일일 한도 초과 → 429, 호출 0 (이미 2회 사용, 한도는 DB 함수 기본값)
  const limit = Number(
    (await db.query(`select count(*) c from usage_reservations where user_id='${USER}'`)).rows[0].c,
  );
  assert.equal(limit, 2);
  await db.exec(
    `update quota_counters set cap = 1000 where kind = 'search'; insert into usage_reservations (user_id, kind, request_id, units, status, lease_expires_at) values ('${USER}','search','${rid()}',38,'settled', now())`,
  );
  const calls = youtube.length;
  const blocked = await search('토끼');
  assert.equal(blocked.status, 429);
  assert.equal(((await blocked.json()) as { code: string }).code, 'QUOTA_EXCEEDED');
  assert.equal(youtube.length, calls);

  // 저장소 장애면 외부 호출을 막는다.
  storageDown = true;
  const down = await search('새검색');
  assert.ok(down.status >= 500);
  assert.equal(youtube.length, calls);
  console.log(
    'PASS: 키워드 검색(토큰 없음 401·잘못된 요청 400·1회 예약 후 호출·requestId 재전송 호출 0·개인 한도 429·저장소 장애 차단); 실제 호출 0회',
  );
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
  await db.close();
}
