import assert from 'node:assert/strict';
import { createElement, forwardRef, useId, useState } from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { jsxDEV } from 'react/jsx-dev-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
// 방금 받은 답변을 채팅처럼 앞에서부터 보여 주는 계획과 렌더링을 검증한다. 외부 호출 0회.

// Windows Vite SSR의 CJS 재평가를 피하고 native React와 동일한 dispatcher를 사용한다(test-chat-ui.ts와 같은 방식).
const nativeRuntime = globalThis as typeof globalThis & {
  __reviewReact?: unknown;
  __reviewJsx?: unknown;
};
nativeRuntime.__reviewReact = { createElement, forwardRef, useId, useState };
nativeRuntime.__reviewJsx = { jsx, jsxs, Fragment, jsxDEV };
const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  plugins: [
    {
      name: 'native-react-review',
      enforce: 'pre',
      resolveId(id) {
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'].includes(id))
          return `\0review:${id}`;
      },
      load(id) {
        if (id === '\0review:react')
          return 'export const {useId,useState,createElement,forwardRef,Fragment} = globalThis.__reviewReact;';
        if (id === '\0review:react/jsx-runtime')
          return 'export const {jsx,jsxs,Fragment} = globalThis.__reviewJsx;';
        if (id === '\0review:react/jsx-dev-runtime')
          return 'export const {jsxDEV,Fragment} = globalThis.__reviewJsx;';
      },
    },
  ],
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { AnswerBody, answerRevealPlan } = await vite.ssrLoadModule(
    '/src/components/ChatResult.tsx',
  );
  const answer = [
    '[핵심 요약]',
    '첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다. 넷째 문장입니다.',
    '[근거 데이터]',
    '근거 본문입니다.',
    '[콘텐츠 제안]',
    '1. 제목: 제안 제목',
  ].join('\n');
  const info = new Map();
  const render = (reveal?: number) =>
    renderToStaticMarkup(
      createElement(AnswerBody, { answer, videos: [], info, ranking: [], reveal }),
    );
  const headings = (html: string) => [...html.matchAll(/<h3>(.*?)<\/h3>/g)].map((m) => m[1]);

  const plan = answerRevealPlan(answer, info);
  assert.equal(plan.blocks.length, 3);
  assert.equal(plan.starts[0], 0);
  assert.ok(plan.starts[1] > plan.starts[0] && plan.starts[2] > plan.starts[1]);
  // 핵심 요약이 끝나는 위치까지가 천천히 보이는 구간
  assert.ok(plan.slowUntil > 0 && plan.slowUntil < plan.starts[1]);
  assert.ok(plan.total > plan.starts[2]);
  console.log('  ok 보여 줄 계획(블록 시작·요약 구간·전체 길이)');

  // reveal이 없으면 전부 보이고 커서가 없다
  const full = render();
  assert.deepEqual(headings(full), ['핵심 요약', '근거 데이터', '콘텐츠 제안']);
  assert.ok(!full.includes('typing-caret'));
  assert.ok(full.includes('넷째 문장입니다.') && full.includes('제안 제목'));

  // 시작 직후: 요약 머리말만, 본문은 비어 있고 커서가 보인다
  const start = render(0);
  assert.deepEqual(headings(start), ['핵심 요약']);
  assert.ok(start.includes('typing-caret'));
  assert.ok(!start.includes('첫째'));

  // 요약을 일부만: 앞에서부터 그만큼만 보이고 다음 섹션은 아직 없다
  const part = render(6);
  assert.deepEqual(headings(part), ['핵심 요약']);
  assert.ok(part.includes('첫째 문장') && !part.includes('둘째'));
  assert.ok(part.includes('typing-caret'));

  // 요약을 다 보여 주고 잠깐 멈추는 동안에는 다음 섹션이 나오지 않는다
  assert.deepEqual(headings(render(plan.starts[1] - 1)), ['핵심 요약']);
  assert.ok(render(plan.starts[1] - 1).includes('넷째 문장입니다.'));
  // 다음 섹션은 시작 위치에 닿으면 머리말부터 나타난다
  assert.deepEqual(headings(render(plan.starts[1])), ['핵심 요약', '근거 데이터']);
  assert.deepEqual(headings(render(plan.starts[2])), ['핵심 요약', '근거 데이터', '콘텐츠 제안']);
  // 끝까지 보이면 커서가 사라진다
  const done = render(plan.total);
  assert.ok(done.includes('제안 제목') && !done.includes('typing-caret'));
  console.log('  ok 앞에서부터 보이기(요약 먼저·섹션 순서·커서)');

  // 섹션 머리말이 없는 일반 답변도 앞에서부터 보인다
  const plain = '짧은 답변입니다. 두 번째 문장입니다.';
  const plainPlan = answerRevealPlan(plain, info);
  assert.equal(plainPlan.parsed, null);
  assert.equal(plainPlan.total, plain.length);
  const plainHtml = renderToStaticMarkup(
    createElement(AnswerBody, { answer: plain, videos: [], info, reveal: 5 }),
  );
  assert.ok(
    plainHtml.includes('짧은 답변') &&
      !plainHtml.includes('두 번째') &&
      plainHtml.includes('typing-caret'),
  );
  console.log('  ok 머리말 없는 답변');
  console.log('test-chat-reveal: all passed');
} finally {
  await vite.close();
}
