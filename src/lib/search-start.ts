import type { VideoQuery } from '../hooks/useVideos';

/** 대시보드 키워드 클릭처럼 다른 화면에서 요청한 검색. id가 바뀔 때마다 한 번 실행한다. */
export interface SearchRequest {
  q: string;
  id: number;
}

const EMPTY: VideoQuery = { q: '', categoryId: '', order: '' };

/**
 * 영상 검색 화면이 처음 열릴 때의 시작 상태.
 * - 다른 화면이 검색을 요청했으면 그 검색어로 바로 검색한다.
 * - 세션에 남은 이전 검색어는 입력창에만 채우고 검색은 실행하지 않는다.
 *   (실행하면 사용자가 누르지 않았는데 하루 검색 횟수가 줄어든다. 이전 결과의 필터도 되살리지 않는다.)
 */
export function resolveSearchStart(
  searchRequest: SearchRequest | undefined,
  restored: VideoQuery | undefined,
): { query: VideoQuery; draft: string } {
  if (searchRequest) return { query: { ...EMPTY, q: searchRequest.q }, draft: searchRequest.q };
  return { query: EMPTY, draft: restored?.q ?? '' };
}
