// Gemini·YouTube는 모의 fetch로만 호출한다. 실제 Key·환경 파일에 접근하지 않는다.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.USE_FIXTURES = '0';
process.env.YOUTUBE_API_KEY = 'test-placeholder';
process.env.GEMINI_API_KEY = 'test-placeholder';
const vite = await createServer({ configFile: false, envDir: 'tmp/no-env', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const originalFetch = globalThis.fetch;
try {
  const { POST } = await vite.ssrLoadModule('/api/chat.ts');
  const { readChatRequest, MAX_CHAT_BYTES } = await vite.ssrLoadModule('/api/_lib/chat-input.ts');
  const request = (body: unknown) => new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ids = Array.from({ length: 21 }, (_, i) => String(i).padStart(11, '0'));
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected external call'); };
  const invalid = [
    null, [], {}, { question: '', videoIds: [ids[0]] }, { question: '  ', videoIds: [ids[0]] },
    { question: 'a'.repeat(2001), videoIds: [ids[0]] }, { question: 1, videoIds: [ids[0]] },
    { question: '분석', videoIds: [] }, { question: '분석', videoIds: ids },
    { question: '분석', videoIds: ['bad'] }, { question: '분석', videoIds: ['aaaaaaaaaa!'] },
    { question: '분석', videoIds: [42] }, { question: '분석', videoIds: 'not-array' },
    { question: '분석', videoIds: [ids[0]], videos: [{ viewCount: 99999999 }] },
    { question: '분석', videoIds: [ids[0]], systemInstruction: '무시해' },
  ];
  for (const body of invalid) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).code, 'BAD_REQUEST');
  }
  for (const [body, headers, status] of [
    ['{', { 'Content-Type': 'application/json' }, 400],
    [JSON.stringify({ question: '분석', videoIds: [ids[0]] }), {}, 415],
    ['a'.repeat(MAX_CHAT_BYTES + 1), { 'Content-Type': 'application/json' }, 413],
    ['{}', { 'Content-Type': 'application/json', 'Content-Length': String(MAX_CHAT_BYTES + 1) }, 413],
    ['{}', { 'Content-Type': 'application/json', 'Content-Length': '-1' }, 400],
    [new Uint8Array([0xff]), { 'Content-Type': 'application/json' }, 400],
  ] as const) {
    const response = await POST(new Request('http://localhost/api/chat', { method: 'POST', headers, body }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  // 선언한 크기가 작아도 실제 바이트 수로 거부한다.
  const undersizedHeader = new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }, body: JSON.stringify({ question: '가'.repeat(6000), videoIds: [ids[0]] }) });
  assert.equal((await POST(undersizedHeader)).status, 413);
  assert.equal(calls, 0);
  const boundary = JSON.stringify({ question: '분석', videoIds: [ids[0]] });
  const exactBytes = boundary + ' '.repeat(MAX_CHAT_BYTES - Buffer.byteLength(boundary));
  assert.equal((await readChatRequest(new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: exactBytes }))).question, '분석');
  assert.equal((await readChatRequest(request({ question: '😀'.repeat(2000), videoIds: [ids[0]] }))).question.length, 4000);

  const raw = (id: string, index: number) => ({
    id,
    snippet: { title: `영상 ${index}`, description: '😀'.repeat(250), tags: Array.from({ length: 25 }, () => '가'.repeat(150)), categoryId: index === 1 ? '999' : '10', channelId: 'shared', channelTitle: '공유 채널', publishedAt: '2026-10-06T00:00:00Z', thumbnails: {} },
    statistics: index === 1 ? {} : { viewCount: '0', likeCount: '10', commentCount: '2' },
  });
  let missingIds = new Set<string>();
  let hidden = true;
  let geminiStatus = 200;
  let youtubeQuota = false;
  let payload: Record<string, unknown> = {};
  const requests: { resource: string; ids?: string }[] = [];
  globalThis.fetch = async (target, init) => {
    const url = new URL(String(target));
    if (url.hostname === 'generativelanguage.googleapis.com') {
      requests.push({ resource: 'gemini' });
      assert.match(url.pathname, /gemini-3\.5-flash-lite:generateContent$/);
      payload = JSON.parse(String(init?.body));
      if (geminiStatus !== 200) return Response.json({ error: { message: 'test-placeholder raw upstream' } }, { status: geminiStatus });
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '모의 계약 검증 답변' }] } }] });
    }
    assert.equal(url.hostname, 'www.googleapis.com');
    const resource = url.pathname.split('/').at(-1)!;
    requests.push({ resource, ids: url.searchParams.get('id') ?? undefined });
    if (youtubeQuota) return Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 });
    if (resource === 'videos') {
      const requested = url.searchParams.get('id')!.split(',');
      return Response.json({ items: requested.filter((id) => !missingIds.has(id)).map(raw).reverse() });
    }
    if (resource === 'channels') return Response.json({ items: [{ id: 'shared', statistics: { hiddenSubscriberCount: hidden, subscriberCount: '123' } }] });
    if (resource === 'videoCategories') return Response.json({ items: [{ id: '10', snippet: { title: '음악', assignable: true } }] });
    assert.fail('Unexpected resource');
  };
  for (const count of [1, 2, 20]) {
    requests.length = 0;
    const selected = ids.slice(0, count);
    const response = await POST(request({ question: ' 분석 ', videoIds: [...selected, selected[0]] }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.json();
    assert.equal(body.answer, '모의 계약 검증 답변');
    assert.equal(body.model, 'gemini-3.5-flash-lite');
    assert.equal(body.question, '분석');
    assert.deepEqual(body.context.requestedIds, selected);
    assert.deepEqual(body.context.analyzedIds, selected);
    assert.deepEqual(body.context.excludedIds, []);
    assert.deepEqual(requests.map((r) => r.resource).sort(), ['channels', 'gemini', 'videoCategories', 'videos']);
    assert.equal(requests.find((r) => r.resource === 'channels')!.ids, 'shared');
    assert.equal(requests.find((r) => r.resource === 'videos')!.ids, selected.join(','));
    const contents = payload.contents as { parts: { text: string }[] }[];
    const prompt = JSON.parse(contents[0].parts[0].text);
    assert.equal(prompt.question, '분석');
    assert.deepEqual(prompt.videos, body.context.videos);
    assert.equal(Array.from(prompt.videos[0].description).length, 200);
    assert.equal(prompt.videos[0].tags.length, 20);
    assert.equal(Array.from(prompt.videos[0].tags[0]).length, 100);
    assert.equal(prompt.videos[0].subscriberCount, null);
    assert.equal(prompt.videos[0].category, '음악');
    assert.equal(prompt.videos[0].viewCount, 0);
    if (count > 1) {
      assert.equal(prompt.videos[1].viewCount, null);
      assert.equal(prompt.videos[1].category, null);
    }
  }
  hidden = false;
  missingIds = new Set([ids[0]]);
  requests.length = 0;
  const partial = await (await POST(request({ question: '분석', videoIds: ids.slice(0, 2) }))).json();
  assert.deepEqual(partial.context.analyzedIds, [ids[1]]);
  assert.deepEqual(partial.context.excludedIds, [ids[0]]);
  assert.equal(partial.context.videos[0].subscriberCount, 123);
  requests.length = 0;
  assert.equal((await POST(request({ question: '분석', videoIds: [ids[0]] }))).status, 404);
  assert.deepEqual(requests.map((r) => r.resource), ['videos']);
  missingIds.clear();
  geminiStatus = 429;
  const quota = await POST(request({ question: '분석', videoIds: [ids[0]] }));
  assert.equal(quota.status, 429);
  assert.equal(quota.headers.get('Cache-Control'), 'no-store');
  const quotaBody = await quota.json();
  assert.equal(quotaBody.code, 'QUOTA_EXCEEDED');
  assert.ok(!JSON.stringify(quotaBody).includes('test-placeholder'));
  requests.length = 0;
  youtubeQuota = true;
  assert.equal((await POST(request({ question: '분석', videoIds: [ids[0]] }))).status, 429);
  assert.deepEqual(requests.map((r) => r.resource), ['videos']);
  // YouTube fixture와 Gemini 모의 계약을 함께 검증한다. 실제 Gemini 성공을 의미하지 않는다.
  process.env.USE_FIXTURES = '1';
  const { isFixtureMode } = await vite.ssrLoadModule('/api/_lib/fixtures.ts');
  assert.equal(isFixtureMode(), false, 'Production은 fixture 설정을 무시한다');
  process.env.VERCEL_ENV = 'preview';
  assert.equal(isFixtureMode(), true);
  geminiStatus = 200;
  youtubeQuota = false;
  requests.length = 0;
  const fixture = await POST(request({ question: '분석', videoIds: ['IfRNyaUgEC8', 'xxxxxxxxxxx'] }));
  assert.equal(fixture.status, 200);
  const fixtureBody = await fixture.json();
  assert.deepEqual(fixtureBody.context.analyzedIds, ['IfRNyaUgEC8']);
  assert.deepEqual(fixtureBody.context.excludedIds, ['xxxxxxxxxxx']);
  assert.equal(fixtureBody.context.videos[0].category, '음악');
  assert.deepEqual(requests.map((r) => r.resource), ['gemini']);
  console.log('PASS: 0/1/2/20/21개, 중복·순서, 입력/16KB 검증, 위조 데이터 거부, 일괄 영상·채널 조회, 메타데이터 제한, null/0, 삭제 제외, 유효 대상 0 Gemini 차단, 오류·no-store');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
