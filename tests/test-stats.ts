import assert from 'node:assert/strict';
import {
  categoryDistribution,
  engagementRate,
  hoursSinceUpload,
  lengthBucket,
  lengthDistribution,
  median,
  summarizeList,
  topRanking,
  viewsPerDay,
  viewsPerHour,
} from '../src/lib/stats/metrics.ts';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const v = (
  id: string,
  hours: number,
  viewCount: number | null,
  extra: Partial<{
    durationSeconds: number;
    categoryId: string;
    likeCount: number | null;
    commentCount: number | null;
  }> = {},
) => ({
  id,
  publishedAt: ago(hours),
  viewCount,
  durationSeconds: 300,
  categoryId: '10',
  likeCount: 10,
  commentCount: 5,
  ...extra,
});

// 경과 시간·일평균·시간당 조회수
assert.equal(hoursSinceUpload(ago(5), NOW), 5);
assert.equal(hoursSinceUpload(new Date(NOW + 3_600_000).toISOString(), NOW), 0);
assert.equal(viewsPerDay(v('a', 48, 1000), NOW), 500);
// 업로드 직후(1일 미만)는 1일로, 1시간 미만은 1시간으로 나눈다
assert.equal(viewsPerDay(v('a', 2, 1000), NOW), 1000);
assert.equal(viewsPerHour(v('a', 0.25, 1000), NOW), 1000);
assert.equal(viewsPerHour(v('a', 10, 1000), NOW), 100);
// null 통계는 null, 조회수 0은 유효한 0
assert.equal(viewsPerDay(v('a', 48, null), NOW), null);
assert.equal(viewsPerHour(v('a', 48, null), NOW), null);
assert.equal(viewsPerDay(v('a', 48, 0), NOW), 0);

// 중앙값
assert.equal(median([]), null);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 3, 2]), 2.5);

// 길이 구간: 경계는 위쪽 포함(60초는 1분 이하), 길이 모름은 null. 쇼츠로 단정하지 않는다.
assert.equal(lengthBucket({ durationSeconds: 60 }), 'u60');
assert.equal(lengthBucket({ durationSeconds: 61 }), 'u180');
assert.equal(lengthBucket({ durationSeconds: 180 }), 'u180');
assert.equal(lengthBucket({ durationSeconds: 181 }), 'u600');
assert.equal(lengthBucket({ durationSeconds: 600 }), 'u600');
assert.equal(lengthBucket({ durationSeconds: 601 }), 'o600');
assert.equal(lengthBucket({ durationSeconds: 0 }), null);
assert.equal(lengthBucket({ durationSeconds: null }), null);

// 참여율: null·조회수 기준 미만·조회수 0 제외
assert.equal(engagementRate({ viewCount: 10_000, likeCount: 150, commentCount: 50 }), 2);
assert.equal(engagementRate({ viewCount: 999, likeCount: 10, commentCount: 1 }), null);
assert.equal(engagementRate({ viewCount: 0, likeCount: 0, commentCount: 0 }, 0), null);
assert.equal(engagementRate({ viewCount: 10_000, likeCount: null, commentCount: 5 }), null);

// 요약 수치: 빈 목록
assert.deepEqual(summarizeList([], NOW), {
  count: 0,
  recentShare: null,
  medianViews: null,
});
// 요약 수치: 24시간 내 비율, 조회수 null 제외 중앙값
assert.deepEqual(
  summarizeList(
    [
      v('a', 1, 100, { durationSeconds: 60 }),
      v('b', 30, null, { durationSeconds: 600 }),
      v('c', 23.9, 0, { durationSeconds: 0 }),
      v('d', 100, 300, { durationSeconds: 120 }),
    ],
    NOW,
  ),
  { count: 4, recentShare: 0.5, medianViews: 100 },
);

// 길이 구간 분포: 길이 모름은 비율 분모에서 제외하고 따로 센다
assert.deepEqual(
  lengthDistribution([
    v('a', 1, 100, { durationSeconds: 60 }),
    v('b', 1, 300, { durationSeconds: 90 }),
    v('c', 1, null, { durationSeconds: 900 }),
    v('d', 1, 50, { durationSeconds: 0 }),
  ]),
  {
    buckets: [
      { key: 'u60', label: '1분 이하', count: 1, share: 1 / 3, medianViews: 100 },
      { key: 'u180', label: '1~3분', count: 1, share: 1 / 3, medianViews: 300 },
      { key: 'u600', label: '3~10분', count: 0, share: 0, medianViews: null },
      { key: 'o600', label: '10분 초과', count: 1, share: 1 / 3, medianViews: null },
    ],
    unknown: 1,
  },
);

// 카테고리 분포: 빈 목록, 조회수 합 0, 동률 정렬
assert.deepEqual(
  categoryDistribution([], (x: { categoryId: string }) => x.categoryId),
  [],
);
assert.deepEqual(
  categoryDistribution(
    [v('a', 1, 0, { categoryId: '20' }), v('b', 1, null, { categoryId: '10' })],
    (x) => x.categoryId,
  ),
  [
    { key: '20', count: 1, share: 0.5, views: 0, viewShare: null },
    { key: '10', count: 1, share: 0.5, views: 0, viewShare: null },
  ],
);
assert.deepEqual(
  categoryDistribution(
    [
      v('a', 1, 100, { categoryId: '10' }),
      v('b', 1, 300, { categoryId: '20' }),
      v('c', 1, 100, { categoryId: '10' }),
      v('d', 1, null, { categoryId: '24' }),
    ],
    (x) => x.categoryId,
  ).map(({ key, count, viewShare }) => [key, count, viewShare]),
  [
    ['10', 2, 0.4],
    ['20', 1, 0.6],
    ['24', 1, 0],
  ],
);

// 인기순 topRanking: popular는 YouTube 인기 순위(화면 정렬과 무관)
const list = [v('a', 48, 100), v('b', 24, 5000), v('c', 2, 300), v('d', 10, null)];
const popular = topRanking(list, 'popular', NOW, {
  popularRank: new Map([
    ['c', 1],
    ['d', 2],
    ['a', 3],
    ['b', 4],
  ]),
});
assert.equal(popular.basisLabel, 'YouTube 인기 순위');
assert.deepEqual(
  popular.items.map((i) => i.id),
  ['c', 'd', 'a'],
);
// popularRank가 없으면 화면 순서
assert.deepEqual(
  topRanking(list, 'popular', NOW).items.map((i) => i.id),
  ['a', 'b', 'c'],
);
// 그 밖 출처는 일평균 조회수, null 제외
const search = topRanking(list, 'search', NOW);
assert.equal(search.basisLabel, '업로드 후 일평균 조회수');
assert.deepEqual(
  search.items.map((i) => [i.id, i.viewsPerDay]),
  [
    ['b', 5000],
    ['c', 300],
    ['a', 50],
  ],
);
// 동률: 일평균 같으면 조회수 → 화면 순서, 조회수 0도 순위에 포함
assert.deepEqual(
  topRanking([v('x', 1, 100), v('y', 48, 200), v('z', 12, 100), v('w', 5, 0)], 'favorites', NOW, {
    limit: 4,
  }).items.map((i) => i.id),
  ['y', 'x', 'z', 'w'],
);
// 빈 목록·전부 null
assert.deepEqual(topRanking([], 'detail', NOW).items, []);
assert.deepEqual(topRanking([v('a', 1, null)], 'selection', NOW).items, []);

console.log('test-stats: ok');

// topBy: null 제외, 동률은 목록 순서, limit
import('../src/lib/stats/metrics.ts').then(({ topBy }) => {
  assert.deepEqual(
    topBy([3, null, 5, 3, 1], (x) => x, 3).map((e) => e.score),
    [5, 3, 3],
  );
  const tied = topBy(['a', 'b', 'c'], () => 1, 2).map((e) => e.item);
  assert.deepEqual(tied, ['a', 'b']);
  assert.deepEqual(
    topBy([], () => 1, 5),
    [],
  );
  // 시간당 조회수 Top: 업로드 직후 영상은 1시간으로 나눈다
  const fast = topBy(
    [v('a', 0.2, 500), v('b', 10, 3000), v('c', 2, null)],
    (x) => viewsPerHour(x, NOW),
    5,
  ).map((e) => [e.item.id, e.score]);
  assert.deepEqual(fast, [
    ['a', 500],
    ['b', 300],
  ]);
  console.log('test-stats topBy: ok');
});

// aggregates: 빈 목록, null 섞임, 0 포함, 짝수 개 중앙값, 동률 최댓값은 먼저 나온 영상
import('../src/lib/stats/metrics.ts').then(({ aggregates, aggregateMetric }) => {
  const empty = aggregates([], NOW);
  for (const metric of Object.values(empty))
    assert.deepEqual(metric, {
      total: 0,
      nullExcluded: 0,
      sum: null,
      average: null,
      median: null,
      max: null,
      min: null,
    });
  const allNull = aggregateMetric([{ id: 'a' }, { id: 'b' }], () => null);
  assert.deepEqual(
    [allNull.total, allNull.nullExcluded, allNull.sum, allNull.average],
    [2, 2, null, null],
  );

  const list = [
    v('a', 48, 1000, { likeCount: 0, commentCount: null }),
    v('b', 24, null, { likeCount: null, commentCount: null }),
    v('c', 72, 0, { likeCount: 5, commentCount: 3 }),
    v('d', 2, 2001, { likeCount: 5, commentCount: 1 }),
    v('e', 96, 400, { likeCount: 2, commentCount: null }),
  ];
  const result = aggregates(list, NOW);
  assert.deepEqual(result.viewCount, {
    total: 5,
    nullExcluded: 1,
    sum: 3401,
    average: 850, // 3401 ÷ 4 = 850.25
    median: 700, // 짝수 개: (400 + 1000) ÷ 2
    max: { value: 2001, id: 'd' },
    min: { value: 0, id: 'c' },
  });
  // 0은 유효 값, 동률 최댓값은 먼저 나온 c
  assert.deepEqual(result.likeCount, {
    total: 5,
    nullExcluded: 1,
    sum: 12,
    average: 3,
    median: 3.5,
    max: { value: 5, id: 'c' },
    min: { value: 0, id: 'a' },
  });
  assert.deepEqual(result.commentCount, {
    total: 5,
    nullExcluded: 3,
    sum: 4,
    average: 2,
    median: 2,
    max: { value: 3, id: 'c' },
    min: { value: 1, id: 'd' },
  });
  // 일평균: a 1000÷2=500, c 0, d 2001(1일 미만은 1일), e 400÷4=100 → 영상별 정수 반올림 후 집계
  assert.deepEqual(result.viewsPerDay, {
    total: 5,
    nullExcluded: 1,
    sum: 2601,
    average: 650,
    median: 300,
    max: { value: 2001, id: 'd' },
    min: { value: 0, id: 'c' },
  });
  assert.equal(
    aggregateMetric(
      [
        { id: 'x', n: 1 },
        { id: 'y', n: 2 },
      ],
      (i) => i.n,
    ).average,
    2,
  ); // 1.5 반올림
  console.log('test-stats aggregates: ok');
});
