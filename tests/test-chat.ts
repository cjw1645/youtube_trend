import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createDb } from './db/harness.mjs';
// 실제 Supabase·YouTube·Gemini·Key 없이 AI 분석 경로 전체를 검증한다.
// 서버 코드(/api/chat·/api/conversations)와 실제 SQL 함수(로컬 PGlite)를 연결하고, 외부 호출은 모의 fetch다.
// 서명 키·토큰은 이 프로세스에서 만든 합성 값이다.

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-placeholder';
process.env.YOUTUBE_API_KEY = 'test-placeholder';
process.env.GEMINI_API_KEY = 'test-placeholder';

const ISS = 'https://proj.supabase.co/auth/v1';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
const token = (sub: string) =>
  new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(sub)
    .setIssuer(ISS)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);

const db = await createDb();
await db.query(`insert into auth.users (id) values ($1), ($2)`, [USER_A, USER_B]);
const CASTS: Record<string, string> = {
  p_payload: 'jsonb',
  p_now: 'timestamptz',
  p_scheduled_for: 'timestamptz',
  p_day: 'date',
};

// ── 모의 외부 서비스 ──
const id = (n: number) => `vid${String(n).padStart(8, '0')}`;
let missing = new Set<string>();
let geminiMode: 'ok' | 'fail' = 'ok';
let geminiText = '[핵심 요약]\n모의 답변입니다. {{title:' + id(1) + '}}';
let geminiPayloads: {
  systemInstruction: { parts: { text: string }[] };
  contents: { parts: { text: string }[] }[];
}[] = [];
let geminiCalls = 0;
let youtubeCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
  if (url.hostname === 'generativelanguage.googleapis.com') {
    geminiCalls++;
    geminiPayloads.push(JSON.parse(String(init?.body)));
    if (geminiMode === 'fail') return Response.json({ error: {} }, { status: 500 });
    return Response.json({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: geminiText }] } }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300 },
    });
  }
  if (url.hostname === 'www.googleapis.com') {
    youtubeCalls++;
    const resource = url.pathname.split('/').at(-1);
    if (resource === 'videos') {
      const ids = (url.searchParams.get('id') ?? '').split(',').filter((v) => !missing.has(v));
      return Response.json({
        items: ids.map((v, i) => ({
          id: v,
          snippet: {
            title: `영상 ${v}`,
            description: '설명',
            tags: ['태그'],
            categoryId: '10',
            channelId: 'chan',
            channelTitle: '채널',
            publishedAt: '2026-10-06T00:00:00Z',
            thumbnails: {},
          },
          statistics: { viewCount: String(1000 + i), likeCount: '10', commentCount: '2' },
        })),
      });
    }
    if (resource === 'channels')
      return Response.json({ items: [{ id: 'chan', statistics: { subscriberCount: '5' } }] });
    if (resource === 'videoCategories')
      return Response.json({ items: [{ id: '10', snippet: { title: '음악', assignable: true } }] });
    return Response.json({}, { status: 404 });
  }
  const match = /\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
  if (url.hostname === 'proj.supabase.co' && match) {
    const fn = match[1];
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
      return new Response(
        JSON.stringify(scalar ? (result.rows[0] as Record<string, unknown>)[fn] : result.rows),
        { status: 200 },
      );
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

const svc = async (sql: string, params?: unknown[]) => {
  await db.exec('set role service_role');
  try {
    return await db.query<Record<string, any>>(sql, params);
  } finally {
    await db.exec('reset role');
  }
};
const q = (sql: string, params?: unknown[]) => db.query<Record<string, any>>(sql, params);

try {
  const chat = await vite.ssrLoadModule('/api/chat.ts');
  const conversationsApi = await vite.ssrLoadModule('/api/conversations.ts');
  const { buildPayload } = await vite.ssrLoadModule('/api/_lib/collect.ts');
  const { MAX_CHAT_BYTES, readChatRequest } = await vite.ssrLoadModule('/api/_lib/chat-input.ts');

  const uuid = () => crypto.randomUUID();
  const post = async (user: string | null, body: unknown, raw?: string) =>
    chat.POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user ? { Authorization: `Bearer ${await token(user)}` } : {}),
        },
        body: raw ?? JSON.stringify(body),
      }),
    );
  const ask = (user: string, extra: Record<string, unknown> = {}) =>
    post(user, { question: '트렌드를 분석해줘', videoIds: [id(1)], requestId: uuid(), ...extra });
  // 개인 간격(30초)과 하루 횟수 계산을 건너뛰기 위해 이전 예약 시각을 과거로 민다(실제 코드 경로는 그대로).
  const age = (user: string) =>
    q(
      `update usage_reservations set created_at = created_at - interval '1 hour', settled_at = settled_at where user_id = $1 and kind = 'ai'`,
      [user],
    );
  const reservations = async (user: string) =>
    (
      await q(
        `select status, count(*)::int c from usage_reservations where user_id = $1 and kind = 'ai' group by status`,
        [user],
      )
    ).rows;
  const used = async (kind: string) =>
    Number((await q(`select used from quota_counters where kind = $1`, [kind])).rows[0]?.used ?? 0);

  // ── 공통 인기 스냅샷 시딩: id(1)은 위치 5, id(2)는 위치 2 ──
  const T = '2026-10-08T00:00:00Z';
  const started = (
    await svc(`select * from start_popular_run($1::timestamptz, $1::timestamptz)`, [T])
  ).rows[0];
  const snapVideos = [5, 2].map((position, k) => ({
    id: id(k + 1),
    position,
    title: `인기 영상 ${k + 1}`,
    description: '',
    tags: [],
    categoryId: '10',
    channelId: 'chan',
    publishedAt: '2026-10-01T00:00:00Z',
    durationSeconds: 100,
    thumbnailUrl: null,
    viewCount: 1000,
    likeCount: 1,
    commentCount: 0,
  }));
  await svc(`select finish_popular_run($1, $2::jsonb, $3::timestamptz)`, [
    started.run_id,
    JSON.stringify(
      buildPayload(
        { pagesFetched: 1, units: 8, complete: true, videos: snapVideos, channels: [] },
        T,
        T,
      ),
    ),
    T,
  ]);

  // 1. 인증: 토큰 없음/위조는 401이며 외부 호출·예약이 없다
  for (const bad of [null, 'garbage']) {
    const res =
      bad === null
        ? await post(null, { question: 'q', videoIds: [id(1)], requestId: uuid() })
        : await chat.POST(
            new Request('http://localhost/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bad}` },
              body: '{}',
            }),
          );
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(geminiCalls + youtubeCalls, 0);
  console.log('  ok 로그인 없는 요청 401·외부 호출 0');

  // 2. 입력 검증(예약·외부 호출 없음): 질문 101자·위조 필드·크기
  for (const body of [
    { question: '가'.repeat(101), videoIds: [id(1)], requestId: uuid() },
    { question: '질문', videoIds: [id(1)], requestId: uuid(), popularRanks: [1] },
    { question: '질문', videoIds: [id(1)], requestId: uuid(), userId: USER_B },
    { question: '질문', videoIds: [id(1)] },
  ]) {
    const res = await post(USER_A, body);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'BAD_REQUEST');
  }
  assert.equal((await post(USER_A, null, 'a'.repeat(MAX_CHAT_BYTES + 1))).status, 413);
  assert.equal(
    (
      await readChatRequest(
        new Request('http://x', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: '가'.repeat(100),
            videoIds: [id(1)],
            requestId: uuid(),
          }),
        }),
      )
    ).question.length,
    100,
  );
  assert.equal(geminiCalls + youtubeCalls, 0);
  assert.deepEqual(await reservations(USER_A), []);
  console.log('  ok 질문 100/101자·위조 필드·크기 거부, 예약 0');

  // 3. 성공: 서버가 순위를 정함, 토큰 사용량 저장·예산 보정, 대화 저장
  const tokensBefore = await used('ai_tokens');
  const first = await post(USER_A, {
    question: '트렌드를 분석해줘',
    videoIds: [id(1), id(2)],
    requestId: uuid(),
    source: 'popular',
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  const firstBody = await first.json();
  assert.match(firstBody.answer, /인기 영상|영상 vid/);
  assert.equal(firstBody.usage.inputTokens, 1200);
  assert.ok(firstBody.conversationId);
  const prompt1 = JSON.parse(geminiPayloads.at(-1)!.contents[0].parts[0].text);
  // 저장된 스냅샷 위치(id2=2, id1=5)가 근거 순서: 클라이언트 값이 아니다
  assert.deepEqual(
    prompt1.serverStats.topRanking.items.map((i: { id: string }) => i.id),
    [id(2), id(1)],
  );
  assert.equal(prompt1.serverStats.topRanking.basisLabel, 'YouTube 인기 순위');
  assert.ok(prompt1.trend.common.itemCount >= 1);
  assert.match(geminiPayloads.at(-1)!.systemInstruction.parts[0].text, /이전 대화와 트렌드 집계/);
  assert.equal((await used('ai_tokens')) - tokensBefore, 1500); // 예약분이 실제 사용량(1200+300)으로 보정됨
  const stored = (
    await q(
      `select role, char_length(content) len, input_tokens, output_tokens from messages order by id`,
    )
  ).rows;
  assert.deepEqual(
    stored.map((m) => m.role),
    ['user', 'assistant'],
  );
  assert.equal(stored[1].input_tokens, 1200);
  assert.equal(stored[1].output_tokens, 300);
  console.log('  ok 서버 순위·트렌드 블록·토큰 보정·대화 저장');

  // 4. 개인 간격: 바로 다음 요청은 429(too_soon)이고 Gemini를 부르지 않는다
  const calls0 = geminiCalls;
  const soon = await ask(USER_A);
  assert.equal(soon.status, 429);
  assert.match((await soon.json()).message, /초 기다려/);
  assert.equal(geminiCalls, calls0);
  console.log('  ok 30초 간격 차단');

  // 5. 후속 질문: 같은 대화, 최근 3회만 문맥, 직접 보내지 않은 이전 답변
  const conversationId = firstBody.conversationId as string;
  for (let n = 2; n <= 5; n++) {
    await age(USER_A);
    geminiText = `[핵심 요약]\n답변 ${n}`;
    const res = await post(USER_A, {
      question: `질문 ${n}`,
      videoIds: [id(1)],
      requestId: uuid(),
      conversationId,
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).conversationId, conversationId);
  }
  const prompt5 = JSON.parse(geminiPayloads.at(-1)!.contents[0].parts[0].text);
  assert.deepEqual(
    prompt5.conversation.recentTurns.map((t: { question: string }) => t.question),
    ['질문 2', '질문 3', '질문 4'],
  );
  assert.equal(prompt5.question, '질문 5');
  console.log('  ok 최근 3회 문답만 문맥');

  // 6. 소유권: 다른 계정이 대화 ID를 쓰면 404이며 Gemini를 부르지 않고 사용량을 돌려준다
  const calls1 = geminiCalls;
  const foreign = await post(USER_B, {
    question: '남의 대화',
    videoIds: [id(1)],
    requestId: uuid(),
    conversationId,
  });
  assert.equal(foreign.status, 404);
  assert.equal(geminiCalls, calls1);
  assert.deepEqual(await reservations(USER_B), [{ status: 'released', c: 1 }]);
  const listB = await conversationsApi.GET(
    new Request('http://localhost/api/conversations', {
      headers: { Authorization: `Bearer ${await token(USER_B)}` },
    }),
  );
  assert.deepEqual((await listB.json()).conversations, []);
  const getB = await conversationsApi.GET(
    new Request(`http://localhost/api/conversations?id=${conversationId}`, {
      headers: { Authorization: `Bearer ${await token(USER_B)}` },
    }),
  );
  assert.equal(getB.status, 404);
  const delB = await conversationsApi.DELETE(
    new Request(`http://localhost/api/conversations?id=${conversationId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await token(USER_B)}` },
    }),
  );
  assert.equal(delB.status, 404);
  console.log('  ok 다른 계정 대화 접근 차단·예약 반환');

  // 7. 재전송 멱등: 같은 요청 ID는 저장된 답변을 돌려주고 Gemini를 다시 부르지 않는다
  await age(USER_A);
  const requestId = uuid();
  geminiText = '[핵심 요약]\n멱등 검증';
  const original = await (
    await post(USER_A, { question: '멱등', videoIds: [id(1)], requestId, conversationId })
  ).json();
  const calls2 = geminiCalls;
  const again = await (
    await post(USER_A, { question: '멱등', videoIds: [id(1)], requestId, conversationId })
  ).json();
  assert.equal(again.answer, original.answer);
  assert.equal(geminiCalls, calls2);
  console.log('  ok 같은 요청 ID 재전송은 Gemini 재호출 없음');

  // 8. 호출 전 실패(영상 조회 불가)는 개인 사용량·토큰을 쓰지 않는다
  await age(USER_A);
  const before = { ai: await used('ai_requests'), tokens: await used('ai_tokens') };
  missing = new Set([id(1)]);
  const calls3 = geminiCalls;
  assert.equal((await ask(USER_A)).status, 404);
  missing.clear();
  assert.equal(geminiCalls, calls3);
  assert.equal(await used('ai_tokens'), before.tokens);
  assert.equal(
    (
      await q(
        `select count(*)::int c from usage_reservations where user_id = $1 and kind = 'ai' and status = 'reserved'`,
        [USER_A],
      )
    ).rows[0].c,
    0,
  );
  console.log('  ok 호출 전 실패는 진행 중 해제·토큰 미소비');

  // 9. Gemini 호출 후 실패는 사용량 유지(failed_unknown), 이후 요청은 가능
  await age(USER_A);
  const tokensBeforeFail = await used('ai_tokens');
  geminiMode = 'fail';
  assert.equal((await ask(USER_A)).status, 502);
  geminiMode = 'ok';
  assert.ok((await reservations(USER_A)).some((r) => r.status === 'failed_unknown'));
  assert.ok((await used('ai_tokens')) > tokensBeforeFail); // 예약분이 보수적으로 남음
  await age(USER_A);
  assert.equal((await ask(USER_A)).status, 200);
  console.log('  ok 호출 후 실패는 예산 유지·이후 정상');

  // 10. 하루 10회: 11번째는 daily_limit
  await q(`delete from usage_reservations where user_id = $1`, [USER_B]);
  for (let n = 0; n < 10; n++)
    await q(
      `insert into usage_reservations (user_id, kind, request_id, units, status, lease_expires_at, created_at) values ($1, 'ai', gen_random_uuid(), 1, 'settled', now(), now() - interval '1 hour')`,
      [USER_B],
    );
  const calls4 = geminiCalls;
  const limited = await post(USER_B, { question: '한도', videoIds: [id(1)], requestId: uuid() });
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).message, /오늘 사용할 수 있는 횟수/);
  assert.equal(geminiCalls, calls4);
  console.log('  ok 하루 10회 초과 차단');

  // 11. 서비스 전체 토큰 예산 소진: 호출 없이 429, 개인 사용량 반환
  await q(`delete from usage_reservations where user_id = $1`, [USER_B]);
  await q(`update quota_counters set used = cap where kind = 'ai_tokens'`);
  const calls5 = geminiCalls;
  const exhausted = await post(USER_B, { question: '소진', videoIds: [id(1)], requestId: uuid() });
  assert.equal(exhausted.status, 429);
  assert.match((await exhausted.json()).message, /서비스 전체/);
  assert.equal(geminiCalls, calls5);
  assert.deepEqual(await reservations(USER_B), [{ status: 'released', c: 1 }]);
  await q(`update quota_counters set used = 0 where kind = 'ai_tokens'`);
  console.log('  ok 전체 토큰 예산 소진 차단');

  // 12. 서비스 전체 요청 예산 소진
  await q(`delete from usage_reservations where user_id = $1`, [USER_B]);
  await q(`update quota_counters set used = cap where kind = 'ai_requests'`);
  const globalLimited = await post(USER_B, {
    question: '소진',
    videoIds: [id(1)],
    requestId: uuid(),
  });
  assert.equal(globalLimited.status, 429);
  await q(`update quota_counters set used = 0 where kind = 'ai_requests'`);
  console.log('  ok 전체 요청 예산 소진 차단');

  // 13. 검색어 슬롯 출처: 내 목록에 없는 영상 거부, 있는 영상은 검색 표본 블록과 함께 허용
  const setId = (await q(`insert into search_sets (query_norm) values ('고양이') returning id`))
    .rows[0].id;
  await q(`insert into user_search_slots (user_id, slot, search_set_id) values ($1, 1, $2)`, [
    USER_B,
    setId,
  ]);
  const s = (
    await svc(`select * from start_search_run($1, $2::timestamptz, $2::timestamptz)`, [setId, T])
  ).rows[0];
  await svc(`select finish_search_run($1, $2::jsonb, $3::timestamptz)`, [
    s.run_id,
    JSON.stringify(
      buildPayload(
        { pagesFetched: 1, units: 5, complete: true, videos: snapVideos.slice(0, 1), channels: [] },
        T,
        T,
      ),
    ),
    T,
  ]);
  await q(`delete from usage_reservations where user_id = $1`, [USER_B]);
  const notMember = await post(USER_B, {
    question: '검색',
    videoIds: [id(2)],
    requestId: uuid(),
    source: 'search',
    searchSlot: 1,
  });
  assert.equal(notMember.status, 400);
  await q(`delete from usage_reservations where user_id = $1`, [USER_B]);
  const member = await post(USER_B, {
    question: '검색',
    videoIds: [id(1)],
    requestId: uuid(),
    source: 'search',
    searchSlot: 1,
  });
  assert.equal(member.status, 200);
  const searchPrompt = JSON.parse(geminiPayloads.at(-1)!.contents[0].parts[0].text);
  assert.equal(searchPrompt.trend.searchSample.query, '고양이');
  assert.ok(searchPrompt.trend.common); // 공통 집계와 검색 표본은 별도 블록
  assert.equal(searchPrompt.serverStats.topRanking.basisLabel, '업로드 후 일평균 조회수');
  // 남의 슬롯 번호(A는 슬롯 없음)로는 거부
  await age(USER_A);
  assert.equal(
    (
      await post(USER_A, {
        question: '검색',
        videoIds: [id(1)],
        requestId: uuid(),
        source: 'search',
        searchSlot: 1,
      })
    ).status,
    400,
  );
  console.log('  ok 검색어 출처 소속 검증·검색 표본 별도 블록');

  // 14. 대화 API: 목록·조회·삭제(본인), 삭제 후 이어 묻기 불가
  const listA = await (
    await conversationsApi.GET(
      new Request('http://localhost/api/conversations', {
        headers: { Authorization: `Bearer ${await token(USER_A)}` },
      }),
    )
  ).json();
  const mine = listA.conversations.find((c: { id: string }) => c.id === conversationId);
  assert.equal(Number(mine.turns), 6); // 첫 질문 + 후속 4 + 멱등 검증 1
  assert.ok(listA.conversations.every((c: { id: string }) => typeof c.id === 'string'));
  const detail = await (
    await conversationsApi.GET(
      new Request(`http://localhost/api/conversations?id=${conversationId}`, {
        headers: { Authorization: `Bearer ${await token(USER_A)}` },
      }),
    )
  ).json();
  assert.equal(detail.messages[0].role, 'user');
  assert.equal(
    (
      await conversationsApi.DELETE(
        new Request(`http://localhost/api/conversations?id=${conversationId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${await token(USER_A)}` },
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await q(`select count(*)::int c from messages where conversation_id = $1`, [conversationId]))
      .rows[0].c,
    0,
  );
  assert.ok(
    (await q(`select count(*)::int c from conversations where user_id = $1`, [USER_B])).rows[0].c >=
      1,
  ); // 다른 계정 대화는 유지
  console.log('  ok 대화 목록·조회·삭제');

  // 15. 입력 상한: 오래된 문답부터 버리고, 그래도 넘으면 413으로 거부한다(Gemini 호출 전).
  const { fitInput, MAX_INPUT_CHARS } = await vite.ssrLoadModule('/api/_lib/chat-service.ts');
  const turn = (n: number) => ({ question: `질문${n}`, answer: '답'.repeat(10_000) });
  const build = (turns: { question: string; answer: string }[]) => ({
    systemInstruction: '지침',
    prompt: '가'.repeat(MAX_INPUT_CHARS - 25_000) + turns.map((t) => t.answer).join(''),
  });
  const fitted = fitInput(build, [turn(1), turn(2), turn(3)]);
  assert.deepEqual(
    fitted.history.map((t: { question: string }) => t.question),
    ['질문2', '질문3'],
  );
  assert.ok(fitted.input.prompt.length + fitted.input.systemInstruction.length <= MAX_INPUT_CHARS);
  assert.throws(
    () => fitInput(() => ({ systemInstruction: '지침', prompt: '가'.repeat(MAX_INPUT_CHARS) }), []),
    (error: { status?: number }) => error.status === 413,
  );
  console.log('  ok 입력 상한: 오래된 문답 제거·초과 시 413');

  console.log('PASS: AI 분석 경로(인증·검증·한도·정산·대화 저장), 실제 외부 호출 0회');
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
  await db.close();
}
