// 실제 Key·환경 파일·외부 API 없이 Gemini 서버 계약을 검증한다.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.GEMINI_API_KEY = 'test-placeholder';
process.env.USE_FIXTURES = '1'; // YouTube fixture 설정이 Gemini 생성에는 영향을 주지 않는다.
const vite = await createServer({ configFile: false, envDir: 'tmp/no-env', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
let calls = 0;

try {
  const { generateContent, GEMINI_MODEL, GEMINI_TIMEOUT_MS } = await vite.ssrLoadModule('/api/_lib/gemini.ts');
  const { errorResponse } = await vite.ssrLoadModule('/api/_lib/http.ts');
  const input = { systemInstruction: '서버 지시문', prompt: '검증된 영상 메타데이터로 분석해 주세요.' };
  async function expectFailure(code: string, status: number) {
    try {
      await generateContent(input);
      assert.fail('Expected safe failure');
    } catch (error) {
      const response: Response = errorResponse(error);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const body = await response.json();
      assert.equal(body.code, code);
      assert.deepEqual(Object.keys(body).sort(), ['code', 'message']);
      assert.ok(!JSON.stringify(body).includes('test-placeholder'));
      assert.ok(!JSON.stringify(body).includes('sensitive upstream'));
    }
  }

  assert.equal(GEMINI_MODEL, 'gemini-3.5-flash-lite');
  let activeSignal: AbortSignal | undefined;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.ok(!String(url).includes('test-placeholder'));
    assert.equal(init?.method, 'POST');
    assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('X-Goog-Api-Key'), 'test-placeholder');
    activeSignal = init?.signal ?? undefined;
    assert.ok(activeSignal instanceof AbortSignal);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.systemInstruction, { parts: [{ text: input.systemInstruction }] });
    assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: input.prompt }] }]);
    assert.equal(body.generationConfig.candidateCount, 1);
    assert.equal(body.generationConfig.maxOutputTokens, 4096);
    assert.equal(body.tools, undefined);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: '생각 과정 제외' }, { text: ' 첫 문장\n' }, { text: '두 번째 문장 ' }] } }] });
  };
  assert.deepEqual(await generateContent(input), { model: GEMINI_MODEL, text: '첫 문장\n두 번째 문장' });
  assert.equal(calls, 1);
  assert.equal(activeSignal?.aborted, false);

  delete process.env.GEMINI_API_KEY;
  await expectFailure('CONFIG_ERROR', 500);
  assert.equal(calls, 1); // Key 누락 시 외부 호출 없음
  process.env.GEMINI_API_KEY = 'test-placeholder';
  await assert.rejects(generateContent({ ...input, prompt: '   ' }), (error: { code: string }) => error.code === 'BAD_REQUEST');
  assert.equal(calls, 1);

  for (const [upstream, code, status] of [
    [429, 'QUOTA_EXCEEDED', 429], [400, 'CONFIG_ERROR', 500], [401, 'CONFIG_ERROR', 500],
    [403, 'CONFIG_ERROR', 500], [404, 'CONFIG_ERROR', 500], [500, 'UPSTREAM_ERROR', 502], [503, 'UPSTREAM_ERROR', 502],
  ] as const) {
    let attempts = 0;
    globalThis.fetch = async () => { attempts++; return Response.json({ error: { message: 'sensitive upstream test-placeholder' } }, { status: upstream }); };
    await expectFailure(code, status);
    assert.equal(attempts, 1); // 자동 재시도·모델 fallback 없음
  }
  globalThis.fetch = async () => { throw new Error('sensitive upstream test-placeholder'); };
  await expectFailure('UPSTREAM_ERROR', 502);
  globalThis.fetch = async () => new Response('sensitive upstream test-placeholder');
  await expectFailure('UPSTREAM_ERROR', 502);
  for (const body of [
    { candidates: [] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '  ' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '생각', thought: true }] } }] },
    { candidates: [{ finishReason: 'STOP', content: {} }] },
  ]) {
    globalThis.fetch = async () => Response.json(body);
    await expectFailure('EMPTY_RESPONSE', 502);
  }
  for (const body of [
    null, [], { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: '보이지 않는 답변' }] } }] },
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '잘린 답변' }] } }] },
  ]) {
    globalThis.fetch = async () => Response.json(body);
    await expectFailure('UPSTREAM_ERROR', 502);
  }

  // 25초를 실제로 기다리지 않고 동일한 deadline 콜백을 실행한다.
  let deadline!: () => void;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    assert.equal(delay, GEMINI_TIMEOUT_MS);
    deadline = callback;
    return originalSetTimeout(callback, delay);
  }) as typeof setTimeout;
  for (const phase of ['fetch', 'body']) {
    globalThis.fetch = async (_url, init) => {
      const signal = init!.signal!;
      const pending = () => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('sensitive upstream test-placeholder')), { once: true });
        deadline();
      });
      if (phase === 'fetch') return pending();
      const response = Response.json({});
      response.json = pending;
      return response;
    };
    await expectFailure('TIMEOUT', 504);
  }
  console.log('PASS: 최신 Flash-Lite, 서버 헤더 인증, 단일 호출, 생각 제외, Key 누락, 429/설정/외부 오류, 빈 답변, 안전 차단/잘림, 요청·본문 시간 초과, no-store');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  await vite.close();
}
