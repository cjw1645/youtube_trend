// 외부 API·실제 Key 없이 전송 경쟁, 시간 초과와 화면 계약을 검증한다.
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ChatRequest, ChatResponse } from '../src/types/chat.ts';

const vite = await createServer({ configFile: false, envDir: 'tmp/no-env', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const originalFetch = globalThis.fetch;
try {
  const { createChatSession, selectChatVideos } = await vite.ssrLoadModule('/src/lib/chat-session.ts');
  const { postJson, ApiRequestError } = await vite.ssrLoadModule('/src/lib/api.ts');
  const { default: ChatPanel } = await vite.ssrLoadModule('/src/components/ChatPanel.tsx');
  const videos = Array.from({ length: 25 }, (_, i) => ({ id: String(i).padStart(11, '0'), title: `영상 ${i}` }));
  const target = { label: '현재 목록', videos };
  const response: ChatResponse = { answer: '[핵심 요약]\n검증', model: 'test', question: '질문', context: { requestedIds: [videos[0].id], analyzedIds: [videos[0].id], excludedIds: [], videos: [] } };
  const updates: any[] = [];
  const calls: ChatRequest[] = [];
  let resolve!: (value: ChatResponse) => void;
  const deferred = new Promise<ChatResponse>(yes => { resolve = yes; });
  const session = createChatSession((state: unknown) => updates.push(state), async (body: ChatRequest) => { calls.push(body); return deferred; });
  assert.equal(await session.submit(' ', target), false);
  assert.equal(await session.submit('질문', { label: '빈 목록', videos: [] }), false);
  assert.equal(await session.submit('가'.repeat(2001), target), false);
  assert.equal(calls.length, 0);
  const first = session.submit(' 질문 ', target);
  assert.equal(await session.submit('중복', target), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { question: '질문', videoIds: videos.slice(0, 20).map(video => video.id) });
  videos[0].title = '화면에서 변경';
  target.label = '화면 전환';
  assert.equal(updates[0].snapshot.label, '현재 목록');
  assert.equal(updates[0].snapshot.videos[0].title, '영상 0');
  resolve(response);
  await first;
  assert.equal(updates.at(-1).status, 'success');
  assert.deepEqual(selectChatVideos([videos[1], videos[1], videos[0]]), [videos[1], videos[0]]);
  assert.equal(selectChatVideos([videos[0]]).length, 1);

  for (const code of ['QUOTA_EXCEEDED', 'NETWORK_ERROR', 'UPSTREAM_ERROR', 'EMPTY_RESPONSE']) {
    let attempts = 0;
    const states: any[] = [];
    const retry = createChatSession((state: unknown) => states.push(state), async () => {
      attempts++;
      if (attempts === 1) {
        if (code === 'EMPTY_RESPONSE') return { ...response, answer: ' ' };
        throw new ApiRequestError(code, '안내', 429);
      }
      return response;
    });
    await retry.submit('질문', target);
    assert.equal(states.at(-1).error.code, code);
    assert.equal(attempts, 1);
    await retry.submit('재전송', target);
    assert.equal(states.at(-1).status, 'success');
    assert.equal(attempts, 2);
  }
  const timeoutStates: any[] = [];
  let delayedResolve!: (value: ChatResponse) => void;
  let timedSignal!: AbortSignal;
  let attempts = 0;
  const timed = createChatSession((state: unknown) => timeoutStates.push(state), (_: ChatRequest, signal: AbortSignal) => {
    attempts++;
    timedSignal = signal;
    if (attempts > 1) return Promise.resolve(response);
    return new Promise<ChatResponse>(yes => { delayedResolve = yes; });
  }, 10);
  const late = timed.submit('시간 초과', target);
  await new Promise(yes => setTimeout(yes, 30));
  assert.equal(timeoutStates.at(-1).error.code, 'TIMEOUT');
  assert.equal(timedSignal.aborted, true);
  assert.equal(attempts, 1);
  await timed.submit('다시 전송', target);
  delayedResolve(response);
  await late;
  assert.equal(timeoutStates.at(-1).snapshot.question, '다시 전송');
  const cancelled: unknown[] = [];
  let finish!: (value: ChatResponse) => void;
  const unmounted = createChatSession((state: unknown) => cancelled.push(state), () => new Promise<ChatResponse>(yes => { finish = yes; }));
  const pending = unmounted.submit('닫기', target);
  unmounted.cancel();
  finish(response);
  await pending;
  assert.equal(cancelled.length, 1);

  globalThis.fetch = async (path, init) => {
    assert.equal(path, '/api/chat');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.cache, 'no-store');
    assert.deepEqual(JSON.parse(String(init?.body)), { question: '질문', videoIds: [videos[0].id] });
    return Response.json(response);
  };
  await postJson('/api/chat', { question: '질문', videoIds: [videos[0].id] }, new AbortController().signal);
  const snapshot = { label: '이전 상세', question: '질문', videos: [videos[0]] };
  const render = (state: unknown, current = { label: '관심 영상', videos: [] as typeof videos }, question = '질문') => renderToStaticMarkup(createElement(ChatPanel, { target: current, chat: { state, question, setQuestion() {}, submit() {} } }));
  assert.match(render({ status: 'idle' }), /분석할 영상이 없습니다/);
  assert.match(render({ status: 'idle' }), /type="submit" disabled=""/);
  assert.match(render({ status: 'pending', snapshot }, target), /분석 중…/);
  assert.match(render({ status: 'pending', snapshot }, target), /요청 대상: 이전 상세/);
  for (const code of ['TIMEOUT', 'QUOTA_EXCEEDED', 'UPSTREAM_ERROR', 'EMPTY_RESPONSE', 'NETWORK_ERROR']) {
    const html = render({ status: 'error', snapshot, error: new ApiRequestError(code, '안내', 429) }, target);
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /type="submit" disabled/);
  }
  const html = render({ status: 'success', snapshot, response: { ...response, answer: '<script>alert(1)</script><img src=x onerror=alert(1)>' } }, target);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.doesNotMatch(html, /<script>|<img /);
  assert.match(html, /요청 대상: 이전 상세/);
  console.log('PASS: 0/1/20개·빈 질문·길이 제한, 동기 중복 차단, 대상 고정, 429/시간 초과/빈 답변/네트워크/외부 오류 후 수동 재전송, 취소·지연 응답 차단, POST 계약, HTML 이스케이프');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
