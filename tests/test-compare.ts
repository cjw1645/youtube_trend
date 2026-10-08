import assert from 'node:assert/strict';
import { createServer } from 'vite';
// 내 검색어와 인기 차트 비교: 합성 입력으로 비율·pp·공통/한쪽만 분리·영상 겹침·카테고리 차이·인기 실행 없음 처리,
// 검색어 토큰화 규칙이 수집 때 저장하는 키워드 규칙과 같은지, 인증 없는 호출 거부를 확인한다. 외부 호출 0회.

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-placeholder';

const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { buildCompare, tokenizeQuery, summarizeCompare } =
    await vite.ssrLoadModule('/api/_lib/compare.ts');
  const { storedKeywordCounts } = await vite.ssrLoadModule('/src/lib/stats/keywords.ts');

  // 1. 토큰화는 수집 때 저장하는 키워드 규칙과 같다(같은 입력에 같은 토큰)
  for (const text of ['고양이 간식', 'Official 고양이 MV 3화', '영상', '#고양이 / 간식!']) {
    const stored = storedKeywordCounts(
      [1, 2].map((i) => ({ title: text, tags: [] as string[], channelId: `c${i}` })),
    ).map((k: { keyword: string }) => k.keyword);
    assert.deepEqual(tokenizeQuery(text).sort(), stored.sort(), text);
  }
  assert.deepEqual(tokenizeQuery('영상'), [], '불용어만이면 토큰 없음');
  assert.deepEqual(tokenizeQuery('고양이 간식').sort(), ['간식', '고양이']);

  const raw = {
    query: '고양이 간식',
    slotRunId: 11,
    slotScheduledFor: '2026-10-08T04:00:00Z',
    slotItemCount: 200,
    popularRunId: 7,
    popularScheduledFor: '2026-10-08T05:00:00Z',
    popularItemCount: 100,
    slotKeywords: [
      { keyword: '고양이', videoCount: 80 },
      { keyword: '간식', videoCount: 40 },
      { keyword: '장난감', videoCount: 30 },
      { keyword: '사료', videoCount: 20 },
    ],
    popularKeywords: [
      { keyword: '게임', videoCount: 21 },
      { keyword: '고양이', videoCount: 3 },
      { keyword: '간식', videoCount: 2 },
      { keyword: '음악', videoCount: 2 },
    ],
    slotCategories: [
      { categoryId: '15', videoCount: 160 },
      { categoryId: '24', videoCount: 40 },
    ],
    popularCategories: [
      { categoryId: '20', videoCount: 50 },
      { categoryId: '24', videoCount: 30 },
      { categoryId: '15', videoCount: 1 },
    ],
    slotVideos: [
      { viewCount: 100, likeCount: 10 },
      { viewCount: 300, likeCount: null },
      { viewCount: 200, likeCount: 30 },
    ],
    popularVideos: [
      { title: '게임 신작 공개', tags: ['게임'], viewCount: 1000, likeCount: 100 },
      { title: '게임 리뷰 영상', tags: null, viewCount: 3000, likeCount: null },
      { title: '귀여운 고양이', tags: ['고양이'], viewCount: 500, likeCount: 50 },
      { title: '음악 방송', tags: [], viewCount: 700, likeCount: 70 },
    ],
    videoOverlap: [
      { videoId: 'bbbbbbbbbbb', slotPosition: 9, popularPosition: 35 },
      { videoId: 'aaaaaaaaaaa', slotPosition: 2, popularPosition: 12 },
    ],
  };
  const c = buildCompare(raw, tokenizeQuery(raw.query));
  assert.equal(c.available, true);
  if (!c.available) throw new Error('unreachable');

  // A: 토큰별 인기 차트 노출·비율·순위(인기 키워드 순서 기준). 집계에 없으면 null
  const byToken = Object.fromEntries(
    c.exposure.tokens.map((t: { keyword: string }) => [t.keyword, t]),
  );
  assert.deepEqual(byToken['고양이'], {
    keyword: '고양이',
    popularCount: 3,
    popularShare: 0.03,
    rank: 2,
  });
  assert.equal(byToken['간식'].rank, 3);
  assert.equal(c.exposure.noTokens, false);
  const none = buildCompare({ ...raw, popularKeywords: [] }, ['고양이']);
  assert.ok(none.available);
  if (none.available)
    assert.deepEqual(none.exposure.tokens[0], {
      keyword: '고양이',
      popularCount: null,
      popularShare: null,
      rank: null,
    });
  const noTokens = buildCompare(raw, []);
  assert.ok(noTokens.available && noTokens.exposure.noTokens && noTokens.keywords.common.length);

  // B: 공통은 검색 비율 순, 비율은 각 실행의 item_count 기준, 차이는 pp
  assert.deepEqual(
    c.keywords.common.map((k: { keyword: string }) => k.keyword),
    ['고양이', '간식'],
  );
  assert.equal(c.keywords.commonTotal, 2);
  const cat = c.keywords.common[0];
  assert.equal(cat.slotShare, 0.4);
  assert.equal(cat.popularShare, 0.03);
  assert.ok(Math.abs((cat.deltaPp ?? 0) - 37) < 1e-9);
  assert.deepEqual(
    c.keywords.slotOnly.map((k: { keyword: string }) => k.keyword),
    ['장난감', '사료'],
  );
  assert.equal(c.keywords.slotOnly[0].popularShare, null);
  assert.equal(c.keywords.slotOnly[0].deltaPp, null);
  assert.deepEqual(
    c.keywords.popularOnly.map((k: { keyword: string }) => k.keyword),
    ['게임', '음악'],
  );

  // C: 영상 겹침 개수·비율·최고 순위, 인기 position 오름차순
  assert.equal(c.videos.count, 2);
  assert.equal(c.videos.share, 0.01);
  assert.equal(c.videos.bestPosition, 12);
  assert.deepEqual(
    c.videos.positions.map((p: { popularPosition: number }) => p.popularPosition),
    [12, 35],
  );

  // D: 카테고리 비율 차이(pp) 절댓값 큰 순, 한쪽에만 있으면 0%로 계산
  assert.deepEqual(
    c.categories.map((x: { categoryId: string }) => x.categoryId),
    ['15', '20', '24'],
  );
  assert.ok(Math.abs(c.categories[0].deltaPp - 79) < 1e-9);
  assert.equal(c.categories[1].slotShare, 0);
  assert.ok(Math.abs(c.categories[1].deltaPp + 50) < 1e-9);

  // 조회수·좋아요 중앙값: 내 검색 결과, 인기 차트 전체, 핫 키워드(검색어 토큰 제외, 인기 영상 수 순)
  assert.deepEqual(
    c.engagement.map((e: { kind: string; label: string }) => [e.kind, e.label]),
    [
      ['search', '고양이 간식'],
      ['popular', '인기 차트 전체'],
      ['hot', '게임'],
      ['hot', '음악'],
    ],
  );
  const [mine, all, game, music] = c.engagement;
  assert.deepEqual(
    [mine.videos, mine.medianViews, mine.medianLikes],
    [3, 200, 20],
    '비공개 좋아요는 제외',
  );
  assert.deepEqual([all.videos, all.medianViews, all.medianLikes], [4, 850, 70]);
  assert.deepEqual([game.videos, game.medianViews, game.medianLikes], [2, 2000, 100]);
  assert.deepEqual([music.videos, music.medianViews, music.medianLikes], [1, 700, 70]);
  assert.equal(c.slotKeywordCount, 4);
  const noStats = buildCompare({ ...raw, slotVideos: [{ viewCount: null, likeCount: null }] }, [
    '고양이',
  ]);
  assert.ok(noStats.available);
  if (noStats.available)
    assert.equal(noStats.engagement[0].medianViews, null, '모두 비공개면 null');
  const failedAggregate = buildCompare({ ...raw, slotKeywords: [] }, ['고양이']);
  assert.ok(failedAggregate.available && failedAggregate.slotKeywordCount === 0, '집계 실패 신호');

  // 인기 실행이 없으면 available=false (슬롯 정보만)
  const missing = buildCompare({ ...raw, popularRunId: null, popularScheduledFor: undefined }, []);
  assert.equal(missing.available, false);
  assert.equal(missing.slot.runId, 11);

  // 겹침·공통이 전혀 없어도 깨지지 않는다
  const empty = buildCompare({ ...raw, slotKeywords: [], popularKeywords: [], videoOverlap: [] }, [
    '고양이',
  ]);
  assert.ok(empty.available);
  if (empty.available) {
    assert.equal(empty.keywords.commonTotal, 0);
    assert.equal(empty.videos.count, 0);
    assert.equal(empty.videos.bestPosition, null);
  }

  // AI 입력 요약: 비율 위주, 카테고리는 이름으로, 인기 실행 없으면 비교하지 않음 표기
  const summary = summarizeCompare(c, (id: string) => `분야${id}`) as {
    available: boolean;
    categoryDifferencesTop3: { category: string }[];
    videosInBoth: { count: number };
  };
  assert.equal(summary.available, true);
  assert.equal(summary.categoryDifferencesTop3[0].category, '분야15');
  assert.equal(summary.videosInBoth.count, 2);
  assert.equal(
    (summarizeCompare(missing, (id: string) => id) as { available: boolean }).available,
    false,
  );

  // 2. 인증 없는 호출은 401이고 저장소를 호출하지 않는다
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    return new Response('{}');
  }) as typeof fetch;
  try {
    const { GET } = await vite.ssrLoadModule('/api/search-data.ts');
    const anon = await GET(new Request('http://localhost/api/search-data?kind=compare&slot=1'));
    assert.equal(anon.status, 401);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log(
    'PASS: 인기 차트 비교(토큰화 규칙 일치·노출/키워드/영상/카테고리 계산·인기 실행 없음·빈 입력·AI 요약·인증 없는 호출 401)',
  );
} finally {
  await vite.close();
}
