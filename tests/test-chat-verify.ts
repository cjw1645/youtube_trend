import assert from 'node:assert/strict';
import { createServer } from 'vite';
// 답변 숫자 검증과 한 번 재작성 로직을 모의 생성기로 검증한다. 외부 호출 0회.

const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { ungroundedNumbers, generateVerified, unverifiedNotice, RETRY_WITHIN_MS } =
    await vite.ssrLoadModule('/api/_lib/chat-verify.ts');
  const prompt = JSON.stringify({
    question: '고양이 영상 트렌드 분석해줘',
    videos: [{ title: '2026 월드컵 하이라이트 1000회 달성', viewCount: 733587 }],
    serverStats: { total: 163, median: 776 },
    trend: { keywordDailySeries: [{ points: [{ videoCount: 113 }] }] },
  });

  // 입력에 있는 숫자는 쉼표·표기와 상관없이 통과
  assert.deepEqual(
    ungroundedNumbers('조회수는 733,587회이고 163개 중 776과 113개입니다.', prompt),
    [],
  );
  // 입력에 없는 큰 숫자만 걸러낸다(작은 숫자·퍼센트는 검사하지 않음)
  assert.deepEqual(
    ungroundedNumbers('조회수는 812,000회, 비중 59.1퍼센트, 3개입니다.', prompt),
    [812000],
  );
  // 중복 제거
  assert.deepEqual(ungroundedNumbers('999명, 999명', prompt), [999]);
  // 영상 표시 토큰·날짜·연도·단위가 붙은 환산 표현은 제외
  assert.deepEqual(
    ungroundedNumbers(
      '{{영상 12345678901:12345678901}} 2026-10-12 업로드, 2027년 전망, 1,500만 회',
      prompt,
    ),
    [],
  );
  console.log('  ok 근거 없는 숫자 탐지');

  const input = { systemInstruction: '지시', prompt };
  const usage = (i: number, o: number) => ({ inputTokens: i, outputTokens: o });
  const make = (texts: string[], failSecond = false) => {
    const calls: string[] = [];
    const generate = async (value: { systemInstruction: string; prompt: string }) => {
      calls.push(value.systemInstruction);
      if (calls.length === 2 && failSecond) throw new Error('boom');
      return { text: texts[calls.length - 1] ?? texts.at(-1)!, model: 'm', usage: usage(10, 5) };
    };
    return { calls, generate };
  };

  // 처음부터 문제 없으면 한 번만 호출
  {
    const { calls, generate } = make(['조회수 733,587회']);
    const out = await generateVerified(generate, input);
    assert.equal(calls.length, 1);
    assert.deepEqual(out.unverified, []);
    assert.equal(out.retried, false);
  }
  // 문제 있으면 그 숫자를 알려 한 번 다시 쓰고, 고쳐지면 안내 없음·사용량 합산
  {
    const { calls, generate } = make(['조회수 812,000회', '조회수 733,587회']);
    const out = await generateVerified(generate, input);
    assert.equal(calls.length, 2);
    assert.match(calls[1], /812,000/);
    assert.equal(out.result.text, '조회수 733,587회');
    assert.deepEqual(out.unverified, []);
    assert.deepEqual(out.result.usage, usage(20, 10));
  }
  // 다시 써도 문제면 숫자가 더 적은 쪽을 쓰고 안내 대상으로 남긴다(최대 2회 호출)
  {
    const { calls, generate } = make(['812,000과 555,000', '812,000회']);
    const out = await generateVerified(generate, input);
    assert.equal(calls.length, 2);
    assert.equal(out.result.text, '812,000회');
    assert.deepEqual(out.unverified, [812000]);
    assert.match(unverifiedNotice(out.unverified), /812,000/);
  }
  // 다시 쓴 답이 더 나쁘면 처음 답을 쓴다
  {
    const { generate } = make(['812,000회', '812,000과 555,000']);
    const out = await generateVerified(generate, input);
    assert.equal(out.result.text, '812,000회');
    assert.deepEqual(out.unverified, [812000]);
  }
  // 재작성이 실패해도 처음 답을 돌려준다
  {
    const { generate } = make(['812,000회'], true);
    const out = await generateVerified(generate, input);
    assert.equal(out.result.text, '812,000회');
    assert.deepEqual(out.unverified, [812000]);
    assert.equal(out.retried, false);
  }
  // 첫 호출이 오래 걸렸으면 제한 시간을 지키려고 다시 묻지 않는다
  {
    let now = 0;
    const calls: number[] = [];
    const generate = async () => {
      calls.push(1);
      now += RETRY_WITHIN_MS;
      return { text: '812,000회', model: 'm' };
    };
    const out = await generateVerified(generate, input, { clock: () => now });
    assert.equal(calls.length, 1);
    assert.deepEqual(out.unverified, [812000]);
  }
  console.log('  ok 한 번 재작성·사용량 합산·시간 제한');
  console.log('test-chat-verify: all passed');
} finally {
  await vite.close();
}
