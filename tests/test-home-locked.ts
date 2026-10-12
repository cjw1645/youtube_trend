import assert from 'node:assert/strict';
import * as React from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { jsxDEV } from 'react/jsx-dev-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
// 로그인하지 않은 영상 검색 화면: 검색창과 로그인 안내만 보이고 필터·AI 질문·직접 선택은 숨긴다.

// Windows Vite SSR의 CJS 재평가를 피하고 native React와 같은 dispatcher를 사용한다.
const g = globalThis as typeof globalThis & { __r?: unknown; __j?: unknown };
g.__r = React;
g.__j = { jsx, jsxs, Fragment, jsxDEV };
const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  plugins: [
    {
      name: 'native-react',
      enforce: 'pre',
      resolveId(id) {
        if (['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'].includes(id))
          return `\0native:${id}`;
      },
      load(id) {
        const names = Object.keys(React)
          .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default')
          .join(',');
        if (id === '\0native:react')
          return `const R = globalThis.__r; export default R; export const {${names}} = R;`;
        if (id === '\0native:react/jsx-runtime')
          return 'export const {jsx,jsxs,Fragment} = globalThis.__j;';
        if (id === '\0native:react/jsx-dev-runtime')
          return 'export const {jsxDEV,Fragment} = globalThis.__j;';
      },
    },
  ],
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { default: Home } = await vite.ssrLoadModule('/src/pages/Home.tsx');
  const html = renderToStaticMarkup(
    React.createElement(Home, {
      onResults: () => undefined,
      onAnalyze: () => undefined,
      favorites: {
        has: () => false,
        toggle: () => undefined,
        videos: [],
      },
      nameById: new Map(),
      onSelect: () => undefined,
      resolveCategoryNames: () => undefined,
    }),
  );
  assert.match(html, /role="search"/, '검색창은 로그아웃 상태에서도 보임');
  assert.match(html, /class="search-locked"/, '로그인 안내 영역');
  assert.match(html, /검색하려면 로그인하세요/);
  assert.doesNotMatch(html, /filter-bar/, '필터 숨김');
  assert.doesNotMatch(html, /상위 20개로 AI 질문/, 'AI 질문 숨김');
  assert.doesNotMatch(html, /분석 영상 직접 선택/, '직접 선택 숨김');
  assert.doesNotMatch(html, /keyword-row/, '키워드 칩 숨김');
  console.log(
    'PASS: 로그아웃 영상 검색 화면(검색창·로그인 안내만, 필터·AI 질문·직접 선택·키워드 칩 숨김)',
  );

  // 홈의 분야 칩처럼 다른 화면의 검색 요청으로 처음 열려도 그 검색어로 로그인을 안내한다.
  const requested = renderToStaticMarkup(
    React.createElement(Home, {
      onResults: () => undefined,
      onAnalyze: () => undefined,
      favorites: { has: () => false, toggle: () => undefined, videos: [] },
      nameById: new Map(),
      onSelect: () => undefined,
      resolveCategoryNames: () => undefined,
      searchRequest: { q: '반려동물', id: 1 },
    }),
  );
  assert.match(requested, /‘반려동물’ 검색은 로그인 후에 할 수 있어요/);
  assert.match(requested, /바로 이어서 찾아 줍니다/);
  assert.doesNotMatch(requested, /<h2>검색하려면 로그인하세요<\/h2>/);
  console.log('PASS: 칩으로 처음 열린 로그아웃 검색 화면에 요청한 검색어를 안내');
} finally {
  await vite.close();
}
