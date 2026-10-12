import assert from 'node:assert/strict';
import { createServer } from 'vite';
// 내 검색어의 평소 대비 판정: 날짜별 중앙값, 평소(직전 최대 7일 중앙값), 기준 부족·겹친 영상 부족, 오름·내림·비슷 문장,
// 인증 없는 호출 거부. 합성 입력만 쓰며 외부 호출 0회.

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
  const { buildHistory, historyVerdict, risingKeywords, HISTORY_MIN_DAYS } =
    await vite.ssrLoadModule('/src/lib/own-history.ts');

  // gains: 날짜별 영상 하루 증가 목록(null은 전날 수집에 없던 영상), fresh: 새 영상 수
  const run = (d: number, gains: (number | null)[], fresh = 0) => ({
    runId: d + 1,
    scheduledFor: new Date(Date.parse('2026-10-08T19:00:00Z') + d * 86400_000).toISOString(),
    itemCount: gains.length,
    videos: gains.map((dailyGain, i) => ({ dailyGain, ageHours: i < fresh ? 10 : 500 })),
  });
  const ten = (value: number) => Array.from({ length: 10 }, () => value);

  // 1. 날짜별 중앙값과 평소: 첫날은 전날이 없어 null, 평소는 직전 날들의 중앙값
  const up = buildHistory({
    query: '고양이 간식',
    runs: [
      run(
        0,
        ten(0).map(() => null),
      ),
      run(1, ten(100), 1),
      run(2, ten(120), 1),
      run(3, ten(80), 1),
      run(4, ten(300), 5),
    ],
  });
  assert.deepEqual(
    up.days.map((d: { medianDailyGain: number | null }) => d.medianDailyGain),
    [null, 100, 120, 80, 300],
  );
  assert.equal(up.usual.medianDailyGain, 100);
  assert.equal(up.usual.days, 3);
  assert.equal(up.gainRatio, 3);
  assert.equal(up.freshShare, 0.5);
  assert.equal(up.usual.freshShare, 0.1);
  const upVerdict = historyVerdict(up);
  assert.equal(upVerdict.tone, 'up');
  assert.equal(
    upVerdict.headline,
    '‘고양이 간식’ 영상들이 평소보다 약 3.0배 빠르게 조회수를 모으고 있습니다',
  );
  assert.match(upVerdict.detail, /평소 \+100, 지난 3일 기준/);
  assert.match(upVerdict.detail, /50%로 평소 10%보다 많습니다/);

  // 2. 내림·비슷
  const down = buildHistory({
    query: '강아지',
    runs: [run(0, ten(100)), run(1, ten(100)), run(2, ten(100)), run(3, ten(50))],
  });
  assert.equal(historyVerdict(down).tone, 'down');
  assert.match(historyVerdict(down).headline, /평소의 약 50% 수준으로 줄었습니다/);
  const flat = buildHistory({
    query: '강아지',
    runs: [run(0, ten(100)), run(1, ten(100)), run(2, ten(100)), run(3, ten(110))],
  });
  assert.equal(historyVerdict(flat).tone, 'flat');

  // 3. 평소 기준이 모자라면 판정하지 않고 진행 상황을 말한다
  const early = buildHistory({ query: '고양이', runs: [run(0, ten(100)), run(1, ten(150))] });
  assert.equal(early.gainRatio, null);
  const earlyVerdict = historyVerdict(early);
  assert.equal(earlyVerdict.tone, 'collecting');
  assert.equal(
    earlyVerdict.headline,
    `‘고양이’의 평소 기준을 쌓는 중입니다 (1/${HISTORY_MIN_DAYS}일)`,
  );

  // 4. 전날과 겹친 영상이 5개 미만인 날은 중앙값을 내지 않는다(검색 결과가 크게 바뀐 날)
  const sparse = buildHistory({
    query: '고양이',
    runs: [
      run(0, ten(100)),
      run(1, ten(100)),
      run(2, ten(100)),
      run(3, [500, 500, null, null, null, null, null, null, null, null]),
    ],
  });
  assert.equal(sparse.latest.medianDailyGain, null);
  assert.equal(sparse.gainRatio, null);
  assert.match(historyVerdict(sparse).headline, /전날과 겹친 영상이 적어/);

  // 5. 평소는 최근 7일만 쓴다(오래된 큰 값은 빠진다), 순서가 섞여 들어와도 날짜순으로 계산
  const long = buildHistory({
    query: '고양이',
    runs: [
      run(9, ten(100)),
      run(0, ten(9000)),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((d) => run(d, ten(100))),
    ],
  });
  assert.equal(long.usual.days, 7);
  assert.equal(long.usual.medianDailyGain, 100);
  assert.equal(long.latest.runId, 10);

  // 6. 같은 날 두 번 수집(검색어 추가 직후 즉시 수집): 전날과 비교할 수 있는 수집을 그날 값으로 쓴다
  const at = (iso: string, gains: (number | null)[], id: number) => ({
    runId: id,
    scheduledFor: iso,
    itemCount: gains.length,
    videos: gains.map((dailyGain, i) => ({
      dailyGain,
      ageHours: 500,
      videoId: `v${id}-${i}`,
      title: `영상 ${id}-${i}`,
    })),
  });
  const sameDay = buildHistory({
    query: '고양이 영상',
    runs: [
      at('2026-10-08T19:00:00Z', ten(100), 1),
      at('2026-10-09T19:00:00Z', ten(100), 2),
      at('2026-10-10T19:00:00Z', ten(100), 3),
      at('2026-10-11T19:00:00Z', [900, 800, 700, 200, 200, 200, 200, 200, 200, 200], 4), // 10/12 04:00 KST
      at(
        '2026-10-12T07:00:00Z',
        ten(0).map(() => null),
        5,
      ), // 10/12 16:00 KST, 18~30시간 전 수집 없음
    ],
  });
  assert.equal(sameDay.days.length, 4, '10/12의 두 수집은 하루로 묶인다');
  assert.equal(sameDay.latest.runId, 4, '비교할 수 있는 04:00 수집이 그날 값');
  assert.equal(historyVerdict(sameDay).tone, 'up');
  // 7. 판정과 상관없이 하루 조회수 증가가 큰 영상 3개(제목이 있는 최근 수집에서)
  assert.deepEqual(
    sameDay.risers.map((r: { videoId: string; dailyGain: number }) => [r.videoId, r.dailyGain]),
    [
      ['v4-0', 900],
      ['v4-1', 800],
      ['v4-2', 700],
    ],
  );
  assert.equal(sameDay.risersAt, '2026-10-11T19:00:00Z');
  assert.deepEqual(early.risers, [], '제목이 없는 오래된 수집에서는 고르지 않는다');

  assert.equal(buildHistory({ query: 'x', runs: [] }), null);

  // 9. 늘어난 키워드: 검색어가 붙은 해시태그는 소재만 남기고, 남는 게 불용어·한 글자면 뺀다
  const kw = (keyword: string, deltaPp: number | null, count = 5) => ({
    keyword,
    deltaPp,
    count,
    share: 0,
    baseCount: null,
    baseShare: null,
    channels: 1,
    belowBaseline: false,
  });
  const trendWith = (keywords: ReturnType<typeof kw>[]) => ({
    current: {},
    comparisons: [{ kind: 'day', available: true, keywords }],
    series: [],
  });
  const chips = risingKeywords(
    trendWith([
      kw('고양이일상', 4.7),
      kw('냥이', 3.2),
      kw('고양이게임', 3.0),
      kw('고양이장난감', 2.6),
      kw('고양이영상', 2.5),
      kw('고양이들', 2.4),
      kw('고양이', 9.0),
      kw('영상', 8.0),
      kw('장난감', 1.0),
      kw('간식', -1.0),
      kw('츄르', 5.0, 1),
    ]),
    '고양이 영상',
  );
  assert.deepEqual(
    chips.map((c: { label: string; keyword: string }) => [c.label, c.keyword]),
    [
      ['일상', '고양이일상'],
      ['냥이', '냥이'],
      ['게임', '고양이게임'],
      ['장난감', '고양이장난감'],
    ],
  );
  assert.deepEqual(risingKeywords(null, '고양이'), []);

  // 8. 인증 없는 호출은 401
  const handler = await vite.ssrLoadModule('/api/_lib/handlers/search-history.ts');
  const res = await handler.GET(new Request('http://localhost/api/search-history?slot=1'));
  assert.equal(res.status, 401);

  console.log(
    'PASS: 평소 대비 판정(중앙값·평소·기준 부족·겹침 부족·같은 날 두 수집·크는 영상·늘어난 키워드 정리·문장·인증); 외부 호출 0회',
  );
} finally {
  await vite.close();
}
