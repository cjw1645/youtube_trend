import assert from 'node:assert/strict';
import { applyLocalFilter } from '../src/lib/local-filter.ts';
import type { Video } from '../src/types/video.ts';
// 카테고리·정렬은 받은 목록 안에서만 적용한다: 필터, 정렬, 원본 불변, popularRank 유지.

const v = (id: string, categoryId: string, viewCount: number | null, day: number, rank?: number) =>
  ({
    id,
    title: id,
    channelId: 'c',
    channelTitle: 'c',
    thumbnailUrl: '',
    publishedAt: `2026-10-0${day}T00:00:00Z`,
    categoryId,
    durationSeconds: 60,
    viewCount,
    likeCount: null,
    commentCount: null,
    popularRank: rank,
  }) satisfies Video;

const list = [
  v('a', '10', 5, 1, 1),
  v('b', '20', 50, 3, 2),
  v('c', '10', null, 2, 3),
  v('d', '10', 500, 4, 4),
];
const ids = (videos: Video[]) => videos.map((video) => video.id).join('');

assert.equal(ids(applyLocalFilter(list, '', '')), 'abcd', '필터·정렬 없음은 API 순서 유지');
assert.equal(ids(applyLocalFilter(list, '10', '')), 'acd', '카테고리 필터는 순서를 바꾸지 않음');
assert.equal(
  ids(applyLocalFilter(list, '', 'viewCount')),
  'dbac',
  '조회수순, 비공개(null)는 맨 뒤',
);
assert.equal(ids(applyLocalFilter(list, '', 'date')), 'dbca', '최신순');
assert.equal(ids(applyLocalFilter(list, '10', 'viewCount')), 'dac', '필터 후 정렬');
assert.equal(ids(applyLocalFilter(list, '99', '')), '', '없는 카테고리는 빈 목록');
assert.equal(ids(list), 'abcd', '원본 배열은 바뀌지 않음');
assert.deepEqual(
  applyLocalFilter(list, '10', 'date').map((video) => video.popularRank),
  [4, 3, 1],
  '재정렬해도 인기 차트 순위(popularRank)는 영상에 그대로 남음',
);
console.log('PASS: 로컬 필터(카테고리·정렬·null 조회수·원본 불변·popularRank 유지)');
