import assert from 'node:assert/strict';
import { createServer } from 'vite';
// 로컬 전용: /api/chat 입력 검증(질문 100자, 요청 ID, 출처, 검색 슬롯). 외부 API 호출 없음.
const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { readChatRequest } = await vite.ssrLoadModule('/api/_lib/chat-input.ts');
  const req = (body: unknown) =>
    new Request('http://local/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const a = 'aaaaaaaaaaa';
  const b = 'bbbbbbbbbbb';
  const rid = '3f0c9d3e-5b1a-4c2d-8e7f-1a2b3c4d5e6f';
  const cid = '4a1d0e4f-6c2b-4d3e-9f80-2b3c4d5e6f70';
  const bad = async (body: unknown) =>
    assert.equal(
      await readChatRequest(req(body)).then(
        () => 'ok',
        (e: { status?: number }) => e.status,
      ),
      400,
    );
  const base = { question: 'q', videoIds: [a], requestId: rid };
  assert.deepEqual(await readChatRequest(req(base)), base);
  // 요청 ID는 대문자도 소문자로 맞춘다. 중복 ID는 하나로 합친다.
  assert.deepEqual(
    await readChatRequest(req({ ...base, videoIds: [a, b, a], requestId: rid.toUpperCase() })),
    { ...base, videoIds: [a, b] },
  );
  assert.deepEqual(
    await readChatRequest(req({ ...base, source: 'popular', conversationId: cid })),
    {
      ...base,
      source: 'popular',
      conversationId: cid,
    },
  );
  assert.deepEqual(await readChatRequest(req({ ...base, source: 'search', searchSlot: 2 })), {
    ...base,
    source: 'search',
    searchSlot: 2,
  });
  // 질문 길이: 100자(코드 포인트) 허용, 101자 거부. 이모지는 1자로 센다.
  await readChatRequest(req({ ...base, question: '가'.repeat(100) }));
  await readChatRequest(req({ ...base, question: '😀'.repeat(100) }));
  await readChatRequest(req({ ...base, question: 'é'.repeat(50) })); // 조합 문자는 코드 포인트 2개
  await bad({ ...base, question: '가'.repeat(101) });
  await bad({ ...base, question: '😀'.repeat(101) });
  await bad({ ...base, question: 'é'.repeat(51) });
  await bad({ ...base, question: '   ' });
  // 클라이언트가 순위·통계를 보내는 경로는 없다
  await bad({ ...base, popularRanks: [1] });
  await bad({ ...base, userId: cid });
  await bad({ ...base, videos: [{ viewCount: 1 }] });
  // 요청 ID·대화 ID·출처·슬롯 검증
  await bad({ question: 'q', videoIds: [a] });
  await bad({ ...base, requestId: 'not-a-uuid' });
  await bad({ ...base, conversationId: 'x' });
  await bad({ ...base, source: 'trending' });
  await bad({ ...base, source: 'search' }); // 슬롯 없음
  await bad({ ...base, source: 'popular', searchSlot: 1 });
  await bad({ ...base, source: 'search', searchSlot: 3 });
  await bad({ ...base, extra: true });
  console.log('test-chat-ranking: ok');
} finally {
  await vite.close();
}
