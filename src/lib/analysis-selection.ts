/** 최대20개, 선택 순서가 아닌 화면 순서로 전달한다. */
export function toggleAnalysisId(
  ids: readonly string[],
  id: string,
): { ids: string[]; limited: boolean } {
  if (ids.includes(id)) return { ids: ids.filter((value) => value !== id), limited: false };
  if (ids.length >= 20) return { ids: [...ids], limited: true };
  return { ids: [...ids, id], limited: false };
}
export function selectedAnalysisVideos<T extends { id: string }>(
  videos: readonly T[],
  ids: readonly string[],
): T[] {
  const selected = new Set(ids);
  return videos.filter((video) => selected.has(video.id)).slice(0, 20);
}
