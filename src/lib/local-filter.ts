import type { SortOrder, Video } from '../types/video';

/**
 * 받아 둔 목록 안에서만 카테고리로 거르고 정렬한다(서버 호출 없음).
 * 정렬하지 않으면(order='') API가 준 순서를 유지하고, popularRank는 어느 경우에도 영상에 그대로 남는다.
 */
export function applyLocalFilter(
  videos: readonly Video[],
  categoryId: string,
  order: SortOrder | '',
): Video[] {
  const filtered = categoryId
    ? videos.filter((video) => video.categoryId === categoryId)
    : [...videos];
  if (order === 'viewCount')
    return filtered.sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
  if (order === 'date') return filtered.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return filtered;
}
