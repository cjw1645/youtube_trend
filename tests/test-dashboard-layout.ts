import assert from 'node:assert/strict';
import * as React from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { jsxDEV } from 'react/jsx-dev-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
// 대시보드 첫 화면: 「검색어 추가」가 타이틀이고, 공통 인기 대시보드는 옵션 패널이다(열림 상태 기억, 로그아웃 기본 열림).

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
const noop = () => undefined;
const props = {
  categoryNames: new Map(),
  resolveCategoryNames: noop,
  onSelect: noop,
  onOpenVideo: noop,
  onImport: () => 'set',
  onImportSearch: () => 'set',
  onSearchKeyword: noop,
  onAnalyze: noop,
};
const store = globalThis as typeof globalThis & { localStorage?: unknown };
const setSaved = (value: string | null) => {
  store.localStorage = { getItem: () => value, setItem: noop };
};
try {
  const { default: Dashboard } = await vite.ssrLoadModule('/src/pages/Dashboard.tsx');
  const render = () => renderToStaticMarkup(React.createElement(Dashboard, props));

  // 저장된 선택이 없고 로그아웃이면 빈 메인을 피하려고 공통 대시보드가 열려 있다
  setSaved(null);
  const open = render();
  assert.match(open, /내 검색어로 트렌드 추적/, '메인 타이틀은 내 검색어');
  assert.match(open, /인기 차트 대시보드/, '옵션 패널 토글');
  assert.match(open, /class="popular-dash"/, '로그아웃·미선택은 기본 열림');
  assert.match(open, /stored-trend/, '저장 집계 섹션');

  // 사용자가 닫아 둔 상태는 기억한다: 공통 통계는 보이지 않는다
  setSaved('0');
  const closed = render();
  assert.match(closed, /내 검색어로 트렌드 추적/);
  assert.doesNotMatch(closed, /popular-dash/);
  assert.doesNotMatch(closed, /stored-trend/);
  assert.match(closed, /aria-expanded="false"/, '토글 상태 표시');

  // 열어 둔 상태도 기억한다
  setSaved('1');
  assert.match(render(), /class="popular-dash"/);

  // 같은 지표를 두 번 보여주지 않는다: 실시간 쪽 카테고리 분포·길이 구간은 없다
  assert.doesNotMatch(open, /카테고리 분포/);
  assert.doesNotMatch(open, /영상 길이 구간<\/h\d>/);
  // 인기 차트 비교 섹션: 값이 있으면 타일·표·칩, 인기 수집이 없으면 안내 한 줄
  const { default: Section } = await vite.ssrLoadModule(
    '/src/components/PopularCompareSection.tsx',
  );
  const run = (runId: number, scheduledFor: string, itemCount: number) => ({
    runId,
    scheduledFor,
    itemCount,
  });
  const row = (keyword: string, slotCount: number | null, popularCount: number | null) => ({
    keyword,
    slotCount,
    slotShare: slotCount === null ? null : slotCount / 200,
    popularCount,
    popularShare: popularCount === null ? null : popularCount / 100,
    deltaPp:
      slotCount !== null && popularCount !== null
        ? (slotCount / 200 - popularCount / 100) * 100
        : null,
  });
  const names = new Map([['15', '반려동물']]);
  const fullCompare = {
    available: true,
    query: '고양이 간식',
    slot: run(1, '2026-10-08T04:00:00Z', 200),
    popular: run(2, '2026-10-08T05:00:00Z', 100),
    exposure: {
      noTokens: false,
      tokens: [{ keyword: '고양이', popularCount: 3, popularShare: 0.03, rank: 2 }],
    },
    keywords: {
      commonTotal: 2,
      common: [row('고양이', 80, 3), row('게임', 7, 22)],
      slotOnly: [row('장난감', 30, null)],
      popularOnly: [],
    },
    videos: { count: 2, share: 0.01, bestPosition: 12, positions: [] },
    categories: [{ categoryId: '15', slotShare: 0.8, popularShare: 0.01, deltaPp: 79 }],
    engagement: [
      {
        kind: 'search',
        label: '고양이 간식',
        videos: 200,
        medianViews: 12000,
        medianLikes: 300,
      },
      {
        kind: 'popular',
        label: '인기 차트 전체',
        videos: 100,
        medianViews: 900000,
        medianLikes: 20000,
      },
      { kind: 'hot', label: '게임', videos: 21, medianViews: null, medianLikes: 5000 },
    ],
    slotKeywordCount: 4,
  };
  const full = renderToStaticMarkup(
    React.createElement(Section, {
      categoryNames: names,
      onSearchKeyword: noop,
      compare: fullCompare,
    }),
  );
  assert.match(full, /인기 차트와 비교/);
  assert.match(full, /compare-verdict/, '맨 위 판정 문장');
  assert.match(full, /인기 차트의 약 1% 수준입니다/, '조회수가 낮으면 퍼센트 수준으로 말함');
  assert.match(full, /compare-value">1%</, '큰 카드는 0.0배가 아니라 퍼센트');
  assert.doesNotMatch(full, /0\.0배/);
  assert.match(full, /3개 영상/);
  assert.match(full, /인기 키워드 2위/);
  assert.match(full, /최고 12위/);
  assert.match(full, /\+79\.0%p/);
  assert.match(full, /반려동물/);
  assert.match(full, /지금 인기 차트의 핫 키워드/, '인기 차트 쪽 단어 구름');
  assert.match(full, /검색 결과의 키워드/, '내 검색 쪽 단어 구름');
  assert.equal((full.match(/class="cloud"/g) ?? []).length, 2, '워드 클라우드 두 개');
  assert.match(full, /is-shared/, '겹치는 단어 표시');
  assert.doesNotMatch(full, /<table/, '비교 섹션에 표 없음');
  assert.match(full, /검색 결과에서 더 자주 나옴/, '▲▼ 범례');
  assert.match(full, /겹치는 키워드 2개/);
  assert.match(full, /▲ 37\.0%p/, '검색에서 더 자주 나온 키워드는 ▲와 크기만 표시');
  assert.match(
    full,
    /▼ 18\.5%p/,
    '인기 차트에서 더 자주 나온 키워드는 ▼와 크기만 표시(부호 중복 없음)',
  );
  assert.doesNotMatch(full, /▲ \+|▼ −|▼ \+/);
  assert.doesNotMatch(
    full,
    /engagement-bars/,
    '막대 차트는 이 블록이 아니라 하이라이트 아래에 둔다',
  );
  assert.doesNotMatch(full, /집계에 실패/, '집계가 있으면 실패 안내 없음');
  assert.match(full, /장난감/);

  // 조회수·좋아요 막대: 「지금 가장 눈에 띄는 것」 바로 아래에 끼워 넣는 별도 블록
  const { CompareEngagement } = await vite.ssrLoadModule(
    '/src/components/PopularCompareSection.tsx',
  );
  const bars = renderToStaticMarkup(
    React.createElement(CompareEngagement, { compare: fullCompare }),
  );
  assert.match(bars, /영상 조회수 비교 · 중앙값/);
  assert.match(bars, /engagement-bars/);
  assert.match(bars, /인기 차트 전체/);
  assert.match(bars, /정보 없음/, '비공개 값은 정보 없음');
  assert.equal(
    renderToStaticMarkup(
      React.createElement(CompareEngagement, {
        compare: { available: false, query: 'x', slot: run(1, '2026-10-08T04:00:00Z', 1) },
      }),
    ),
    '',
    '인기 차트 비교가 없으면 그리지 않음',
  );

  // 판정 문장: 인기 차트보다 높으면 배율, 비슷하면 비슷함
  const { compareVerdict } = await vite.ssrLoadModule('/src/components/PopularCompareSection.tsx');
  const withViews = (mine: number, all: number, hot: number) => ({
    ...fullCompare,
    engagement: [
      { kind: 'search', label: 'q', videos: 10, medianViews: mine, medianLikes: 1 },
      { kind: 'popular', label: '인기 차트 전체', videos: 10, medianViews: all, medianLikes: 1 },
      { kind: 'hot', label: '게임', videos: 5, medianViews: hot, medianLikes: 1 },
    ],
  });
  assert.match(
    compareVerdict(withViews(980000, 100000, 140000)).headline,
    /검색 결과는 인기 차트 영상보다 조회수가 약 9\.8배 높습니다/,
  );
  assert.match(
    compareVerdict(withViews(980000, 100000, 140000)).detail,
    /핫 키워드 1개 중 1개보다/,
  );
  assert.match(compareVerdict(withViews(100000, 100000, 140000)).headline, /비슷한 수준/);
  assert.equal(compareVerdict(withViews(100000, 100000, 140000)).detail.includes('0개보다'), true);
  const failed = renderToStaticMarkup(
    React.createElement(Section, {
      categoryNames: names,
      onSearchKeyword: noop,
      compare: {
        available: true,
        query: '희귀한검색어',
        slot: run(1, '2026-10-08T04:00:00Z', 200),
        popular: run(2, '2026-10-08T05:00:00Z', 100),
        exposure: { noTokens: false, tokens: [] },
        keywords: { commonTotal: 0, common: [], slotOnly: [], popularOnly: [] },
        videos: { count: 0, share: 0, bestPosition: null, positions: [] },
        categories: [],
        engagement: [],
        slotKeywordCount: 0,
      },
    }),
  );
  assert.match(failed, /키워드 집계에 실패했습니다/);
  assert.match(failed, /다른\s*키워드로 변경해 주세요/);
  const unavailable = renderToStaticMarkup(
    React.createElement(Section, {
      categoryNames: names,
      onSearchKeyword: noop,
      compare: { available: false, query: '고양이', slot: run(1, '2026-10-08T04:00:00Z', 200) },
    }),
  );
  assert.match(unavailable, /비교할 인기 차트 수집이 없습니다/);
  assert.doesNotMatch(unavailable, /class="cloud"/);
  console.log('PASS: 대시보드 메인(검색어 타이틀·옵션 패널 기본값·열림 상태 기억·중복 섹션 제거)');
} finally {
  await vite.close();
}
