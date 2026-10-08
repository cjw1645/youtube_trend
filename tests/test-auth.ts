import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
// 실제 Supabase·Key·환경 파일 없이 인증 검증, 계정 격리, 관심 영상 API, 계정 삭제, 사용량 예약 계약을 검증한다.
// 모든 외부 호출은 모의 fetch이며 서명 키는 이 프로세스에서 생성한 합성 키다.

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-placeholder';
process.env.YOUTUBE_API_KEY = 'test-placeholder';

const ISS = 'https://proj.supabase.co/auth/v1';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const VIDEO = 'dQw4w9WgXcQ';

const { publicKey, privateKey } = await generateKeyPair('ES256');
const other = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };

async function token(
  claims: Record<string, unknown> = {},
  opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string | number; alg?: string } = {},
) {
  return new SignJWT({ role: 'authenticated', ...claims })
    .setProtectedHeader({ alg: opts.alg ?? 'ES256', kid: 'k1' })
    .setSubject((claims.sub as string) ?? USER_A)
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(opts.key ?? privateKey);
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}
let calls: Call[] = [];
let respond: (call: Call) => Response = () => new Response('{}', { status: 200 });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/.well-known/jwks.json'))
    return new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { 'content-type': 'application/json' },
    });
  const call: Call = {
    url,
    method: init?.method ?? 'GET',
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: typeof init?.body === 'string' ? init.body : null,
  };
  calls.push(call);
  return respond(call);
}) as typeof fetch;

const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const req = (path: string, method: string, bearer?: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const reset = () => {
  calls = [];
  respond = () => new Response('{}', { status: 200 });
};

try {
  const fav = await vite.ssrLoadModule('/api/favorites.ts');
  const account = await vite.ssrLoadModule('/api/account.ts');
  const usage = await vite.ssrLoadModule('/api/_lib/usage.ts');
  const videos = await vite.ssrLoadModule('/api/videos.ts');
  const code = async (res: Response) => ((await res.json()) as { code?: string }).code;

  // 1. 토큰 검증: 누락·형식·만료·발급자·대상·서명·역할·알고리즘 혼동은 모두 401, 저장소 호출 0
  const bad: [string, string | undefined][] = [
    ['토큰 없음', undefined],
    ['형식 오류', 'not.a.jwt'],
    ['만료', await token({}, { exp: Math.floor(Date.now() / 1000) - 60 })],
    ['다른 발급자', await token({}, { iss: 'https://evil.example/auth/v1' })],
    ['다른 대상', await token({}, { aud: 'someone-else' })],
    ['다른 키 서명', await token({}, { key: other.privateKey })],
    ['anon 역할', await token({ role: 'anon' })],
    ['sub 형식 오류', await token({ sub: 'user-1' })],
    [
      'HS256 알고리즘 혼동',
      await new SignJWT({ role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
        .setSubject(USER_A)
        .setIssuer(ISS)
        .setAudience('authenticated')
        .setExpirationTime('10m')
        .sign(new TextEncoder().encode('anon-placeholder-secret-padding-padding')),
    ],
    [
      'alg none',
      `${btoa('{"alg":"none"}').replace(/=/g, '')}.${btoa(`{"sub":"${USER_A}","role":"authenticated"}`).replace(/=/g, '')}.`,
    ],
  ];
  for (const [name, bearer] of bad) {
    reset();
    const res = await fav.GET(req('/api/favorites', 'GET', bearer));
    assert.equal(res.status, 401, name);
    assert.equal(await code(res), 'UNAUTHORIZED', name);
    assert.equal(res.headers.get('cache-control'), 'no-store', name);
    assert.equal(calls.length, 0, `${name}: 저장소 호출 없음`);
  }
  // Bearer가 아닌 스킴
  reset();
  assert.equal(
    (
      await fav.GET(
        new Request('http://localhost/api/favorites', {
          headers: { Authorization: `Basic ${await token()}` },
        }),
      )
    ).status,
    401,
  );

  // 2. 목록: 사용자 토큰과 anon apikey로 호출(service role 아님), 응답은 ID만
  reset();
  respond = () => new Response(JSON.stringify([{ video_id: VIDEO }, { video_id: 'abcdefghijk' }]));
  const tokenA = await token({ sub: USER_A });
  const list = await fav.GET(req('/api/favorites', 'GET', tokenA));
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { ids: [VIDEO, 'abcdefghijk'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.authorization, `Bearer ${tokenA}`);
  assert.equal(calls[0].headers.apikey, 'anon-placeholder');
  assert.match(calls[0].url, /^https:\/\/proj\.supabase\.co\/rest\/v1\/favorites\?/);
  assert.equal(list.headers.get('cache-control'), 'no-store');

  // 3. 저장: 본문의 userId 위조는 무시, user_id는 토큰 sub
  reset();
  const put = await fav.PUT(
    req('/api/favorites', 'PUT', tokenA, { videoId: VIDEO, userId: USER_B, user_id: USER_B }),
  );
  assert.equal(put.status, 200);
  assert.deepEqual(JSON.parse(calls[0].body!), { user_id: USER_A, video_id: VIDEO });
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].headers.prefer, /ignore-duplicates/);

  // 4. 삭제: 쿼리의 user_id는 토큰 sub, 본문에 다른 사용자를 넣어도 영향 없음
  reset();
  const del = await fav.DELETE(
    req('/api/favorites', 'DELETE', tokenA, { videoId: VIDEO, userId: USER_B }),
  );
  assert.equal(del.status, 200);
  assert.equal(calls[0].method, 'DELETE');
  assert.match(calls[0].url, new RegExp(`user_id=eq\\.${USER_A}&video_id=eq\\.${VIDEO}$`));
  assert.ok(!calls[0].url.includes(USER_B));

  // 5. 입력 검증: 잘못된 ID(주입 시도 포함)·본문 크기·깨진 JSON
  for (const body of [
    { videoId: 'short' },
    { videoId: `${VIDEO}&user_id=neq.x` },
    { videoId: 123 },
    {},
    null,
  ]) {
    reset();
    const res = await fav.PUT(req('/api/favorites', 'PUT', tokenA, body));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(calls.length, 0);
  }
  reset();
  assert.equal(
    (await fav.PUT(req('/api/favorites', 'PUT', tokenA, { videoId: VIDEO, pad: 'x'.repeat(300) })))
      .status,
    413,
  );
  assert.equal(
    (
      await fav.PUT(
        new Request('http://localhost/api/favorites', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tokenA}` },
          body: '{broken',
        }),
      )
    ).status,
    400,
  );
  assert.equal(calls.length, 0);

  // 6. 저장소 오류: 원문은 응답에 싣지 않는다
  reset();
  respond = () => new Response('{"message":"secret internal detail"}', { status: 500 });
  const failed = await fav.GET(req('/api/favorites', 'GET', tokenA));
  assert.equal(failed.status, 502);
  assert.ok(!JSON.stringify(await failed.json()).includes('secret'));
  respond = () => new Response('{}', { status: 401 });
  assert.equal((await fav.GET(req('/api/favorites', 'GET', tokenA))).status, 401);

  // 7. 계정 삭제: 확인 없이 호출 불가, 확인 시 service role로 토큰 sub만 삭제
  reset();
  assert.equal((await account.DELETE(req('/api/account', 'DELETE', tokenA))).status, 400);
  assert.equal(
    (await account.DELETE(req('/api/account', 'DELETE', tokenA, { confirm: true }))).status,
    400,
  );
  assert.equal(
    (await account.DELETE(req('/api/account', 'DELETE', undefined, { confirm: 'delete' }))).status,
    401,
  );
  assert.equal(calls.length, 0);
  const deleted = await account.DELETE(
    req('/api/account', 'DELETE', tokenA, { confirm: 'delete', userId: USER_B }),
  );
  assert.equal(deleted.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url, `https://proj.supabase.co/auth/v1/admin/users/${USER_A}`);
  assert.equal(calls[0].headers.authorization, 'Bearer service-placeholder');
  assert.ok(!JSON.stringify(await deleted.clone().text()).includes('service-placeholder'));

  // 8. 사용량 예약: 상태별 구분 안내, 저장소 장애 시 예외(외부 호출 차단)
  const rpcResult = (row: Record<string, unknown>) => () => new Response(JSON.stringify([row]));
  reset();
  respond = rpcResult({ status: 'ok', reservation_id: 'r1', retry_after_seconds: 0 });
  assert.deepEqual(await usage.reserveAi(USER_A, 'req-1'), { id: 'r1', duplicate: false });
  assert.equal(calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/reserve_ai_request');
  assert.deepEqual(JSON.parse(calls[0].body!), { p_user: USER_A, p_request: 'req-1' });
  assert.equal(calls[0].headers.authorization, 'Bearer service-placeholder');
  respond = rpcResult({ status: 'duplicate', reservation_id: 'r1' });
  assert.deepEqual(await usage.reserveAi(USER_A, 'req-1'), { id: 'r1', duplicate: true });
  const expectBlocked = async (
    status: string,
    pattern: RegExp,
    extra: Record<string, unknown> = {},
  ) => {
    respond = rpcResult({ status, reservation_id: null, ...extra });
    await assert.rejects(
      usage.reserveAi(USER_A, 'x'),
      (error: { code: string; status: number; message: string }) => {
        assert.equal(error.code, 'QUOTA_EXCEEDED');
        assert.equal(error.status, 429);
        assert.match(error.message, pattern);
        return true;
      },
    );
  };
  await expectBlocked('in_flight', /처리 중/);
  await expectBlocked('daily_limit', /오늘/);
  await expectBlocked('global_limit', /서비스 전체/);
  await expectBlocked('too_soon', /12초/, { retry_after_seconds: 12 });
  respond = () => new Response('boom', { status: 500 });
  await assert.rejects(
    usage.reserveAi(USER_A, 'x'),
    (error: { status: number }) => error.status === 502,
  );
  respond = () => new Response('not json', { status: 200 });
  await assert.rejects(usage.reserveAi(USER_A, 'x'));
  respond = rpcResult({ status: 'daily_limit', reservation_id: null });
  await assert.rejects(usage.reserveSearch(USER_A, 'y', 8), /오늘/);
  const searchBody = JSON.parse(calls.at(-1)!.body!);
  assert.deepEqual(
    { ...searchBody, p_now: undefined },
    { p_user: USER_A, p_request: 'y', p_units: 8, p_now: undefined },
  );
  assert.ok(Number.isFinite(Date.parse(searchBody.p_now)));
  reset();
  await usage.settleUsage(USER_A, 'r1', 'released');
  assert.equal(calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/settle_usage');
  assert.deepEqual(JSON.parse(calls[0].body!), {
    p_user: USER_A,
    p_reservation: 'r1',
    p_status: 'released',
  });

  // 9. Supabase 미설정이면 설정 오류(토큰 검증 불가 → 거부)
  const saved = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  reset();
  const noConfig = await fav.GET(req('/api/favorites', 'GET', tokenA));
  assert.equal(noConfig.status, 500);
  assert.equal(await code(noConfig), 'CONFIG_ERROR');
  process.env.SUPABASE_URL = saved;

  // 10. ids 일괄 조회: 형식·개수·다른 조건과의 혼용 검증, 호출 전 거부
  for (const query of [
    'ids=',
    'ids=short',
    `ids=${VIDEO}&q=x`,
    `ids=${VIDEO}&order=date`,
    `ids=${VIDEO}&chart=popular&all=1`,
    `ids=${Array.from({ length: 51 }, (_, i) => `a${String(i).padStart(10, '0')}`).join(',')}`,
  ]) {
    reset();
    const res = await videos.GET(req(`/api/videos?${query}`, 'GET'));
    assert.equal(res.status, 400, query);
    assert.equal(calls.length, 0, query);
  }
  reset();
  respond = (call) => {
    // 공개 조회 예산(ensure_quota_row·try_consume_quota)은 통과시키고 YouTube 호출만 확인한다.
    if (call.url.includes('/rest/v1/rpc/try_consume_quota')) return Response.json(true);
    if (call.url.includes('/rest/v1/rpc/ensure_quota_row')) return Response.json(null);
    assert.match(call.url, /googleapis\.com\/youtube\/v3\/videos\?/);
    assert.match(call.url, /id=dQw4w9WgXcQ%2Cabcdefghijk/);
    return new Response(
      JSON.stringify({
        items: [
          {
            id: 'abcdefghijk',
            snippet: {
              title: 'B',
              description: '',
              channelId: 'c',
              channelTitle: 'ch',
              publishedAt: '2026-01-01T00:00:00Z',
              categoryId: '1',
              thumbnails: {},
            },
            statistics: { viewCount: '0' },
            contentDetails: { duration: 'PT1M' },
          },
          {
            id: VIDEO,
            snippet: {
              title: 'A',
              description: '',
              channelId: 'c',
              channelTitle: 'ch',
              publishedAt: '2026-01-01T00:00:00Z',
              categoryId: '1',
              thumbnails: {},
            },
            contentDetails: { duration: 'PT2M' },
          },
        ],
      }),
    );
  };
  const batch = await videos.GET(req(`/api/videos?ids=${VIDEO},abcdefghijk,${VIDEO}`, 'GET'));
  const items = ((await batch.json()) as { items: { id: string; viewCount: number | null }[] })
    .items;
  assert.deepEqual(
    items.map((item) => item.id),
    [VIDEO, 'abcdefghijk'],
  ); // 요청 순서·중복 제거
  assert.equal(items[0].viewCount, null); // 누락은 null
  assert.equal(items[1].viewCount, 0); // 0은 0

  console.log(
    'PASS: 토큰 검증 10종 거부(만료·발급자·대상·서명·역할·HS256 혼동·alg none), 사용자 토큰/anon key 호출, 위조 userId 무시, 입력 검증, 계정 삭제 확인, 사용량 상태별 429·저장소 장애 차단, ids 일괄 조회; 실제 호출 0회',
  );
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
}
