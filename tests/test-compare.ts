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

  // 하루 조회수 증가: 이전 DB 함수(dailyGain 없음)면 null, 있으면 공개된 증가값만의 중앙값
  assert.deepEqual([mine.medianDailyGain, mine.gainVideos], [null, 0]);
  assert.deepEqual(c.gainBasis, { slotPrev: null, popularPrev: null });
  const { compareVerdict, gainUnavailableReason } = await vite.ssrLoadModule(
    '/src/components/PopularCompareSection.tsx',
  );
  // 누적 조회수만 있으면 몇 배라고 단정하지 않고 이유를 말한다
  const noGainVerdict = compareVerdict(c);
  assert.equal(noGainVerdict.ratio, null);
  assert.equal(noGainVerdict.headline, '‘고양이 간식’ 검색 결과를 인기 차트와 비교했습니다');
  assert.match(gainUnavailableReason(c), /24시간 전 검색 수집이 없어/);
  // 누적은 검색 쪽이 크지만(오래된 영상) 하루 증가는 인기 차트가 크다 → 하루 증가 기준으로 판정
  const gained = buildCompare(
    {
      ...raw,
      slotPrevScheduledFor: '2026-10-07T04:00:00Z',
      popularPrevScheduledFor: '2026-10-07T05:00:00Z',
      slotVideos: [
        { viewCount: 5_000_000, likeCount: 1, dailyGain: 2_000 },
        { viewCount: 4_000_000, likeCount: 1, dailyGain: 1_000 },
        { viewCount: 3_000_000, likeCount: 1, dailyGain: null },
      ],
      popularVideos: raw.popularVideos.map((v, i) => ({
        ...v,
        dailyGain: [10_000, 30_000, 20_000, null][i],
      })),
    },
    tokenizeQuery(raw.query),
  );
  assert.ok(gained.available);
  if (gained.available) {
    const [gMine, gAll] = gained.engagement;
    assert.deepEqual([gMine.medianDailyGain, gMine.gainVideos], [1_500, 2]);
    assert.deepEqual([gAll.medianDailyGain, gAll.gainVideos], [20_000, 3]);
    assert.ok(gMine.medianViews! > gAll.medianViews!, '누적은 검색 쪽이 더 크다');
    const verdict = compareVerdict(gained);
    assert.equal(verdict.ratio, 1_500 / 20_000);
    assert.match(verdict.headline, /하루 조회수 증가는 인기 차트의 약 8% 수준/);
    assert.equal(gainUnavailableReason(gained), null);
  }
  // 하루 증가가 없으면 업로드 후 기간이 같은 영상끼리 누적 조회수로 판정(3일 미만·3~30일·30일 이상, 한쪽 3개 미만은 배율 없음)
  const aged = buildCompare(
    {
      ...raw,
      slotVideos: [
        // 30일 이상 오래된 영상은 누적이 크다
        ...[9_000_000, 8_000_000, 7_000_000].map((viewCount) => ({
          viewCount,
          likeCount: 1,
          ageHours: 24 * 400,
        })),
        // 3일 미만 영상끼리 비교: 검색 중앙값 20,000
        ...[10_000, 20_000, 30_000].map((viewCount) => ({ viewCount, likeCount: 1, ageHours: 30 })),
        { viewCount: 50_000, likeCount: 1, ageHours: 24 * 10 },
        { viewCount: 60_000, likeCount: 1, ageHours: null },
      ],
      popularVideos: [100_000, 200_000, 300_000, 400_000].map((viewCount, i) => ({
        title: `인기${i}`,
        tags: [],
        viewCount,
        likeCount: 1,
        ageHours: 20,
      })),
    },
    tokenizeQuery(raw.query),
  );
  assert.ok(aged.available);
  if (aged.available) {
    const [under3d, mid, over30d] = aged.ageBands;
    assert.deepEqual(
      [under3d.label, under3d.slotVideos, under3d.popularVideos],
      ['3일 미만', 3, 4],
    );
    assert.deepEqual([under3d.slotMedianViews, under3d.popularMedianViews], [20_000, 250_000]);
    assert.equal(under3d.ratio, 20_000 / 250_000);
    assert.deepEqual([mid.slotVideos, mid.popularVideos, mid.ratio], [1, 0, null], '표본 부족');
    assert.deepEqual([over30d.slotVideos, over30d.ratio], [3, null], '인기 쪽에 30일 이상 없음');
    const verdict = compareVerdict(aged);
    assert.equal(verdict.basis, 'age');
    assert.equal(verdict.ratio, 20_000 / 250_000);
    assert.equal(
      verdict.headline,
      '‘고양이 간식’ 검색 결과를 업로드 3일 미만 영상끼리 보면 누적 조회수는 인기 차트의 약 8% 수준입니다',
    );
    assert.match(verdict.detail, /24시간 전 검색 수집이 없어/);
    const ai = summarizeCompare(aged, (id: string) => id) as {
      viewsByUploadAge: { uploadAge: string; searchToPopularRatio: number | null }[];
    };
    assert.deepEqual(
      ai.viewsByUploadAge.map((b) => [b.uploadAge, b.searchToPopularRatio]),
      [
        ['3일 미만', 0.08],
        ['3~30일', null],
        ['30일 이상', null],
      ],
    );
  }
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
  // 1% 미만도 0이 아니라 소수 1자리 퍼센트로 전달한다(분야15의 인기 차트 비중은 1%)
  assert.deepEqual(summary.categoryDifferencesTop3[0], {
    category: '분야15',
    searchSharePercent: 80,
    popularSharePercent: 1,
  });
  const tiny = summarizeCompare(
    buildCompare(
      {
        ...raw,
        popularCategories: [
          { categoryId: '15', videoCount: 0 },
          { categoryId: '24', videoCount: 1 },
        ],
        popularItemCount: 1000,
      },
      ['고양이'],
    ),
    (id: string) => id,
  ) as { categoryDifferencesTop3: { category: string; popularSharePercent: number }[] };
  assert.equal(
    tiny.categoryDifferencesTop3.find((c) => c.category === '24')?.popularSharePercent,
    0.1,
  );
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
