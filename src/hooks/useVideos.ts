import type { ApiRequestError } from '../lib/api';
import { useApiResource } from './useApiResource';
import type { SortOrder, Video, VideosResponse } from '../types/video';

export interface VideoQuery {
  /** 비어 있으면 인기 급상승 목록 */
  q: string;
  /** 비어 있으면 전체 카테고리 */
  categoryId: string;
  /** 비어 있으면 YouTube 기본 순서(인기 순위 / 관련도) */
  order: SortOrder | '';
}

export type VideosState =
  | { status: 'loading' }
  | { status: 'success'; videos: Video[] }
  | { status: 'error'; error: ApiRequestError };

/** 조건이 바뀔 때만 /api/videos를 호출한다. 검색은 검색어 제출 시에만 q가 바뀌므로 입력 중에는 호출하지 않는다. */
export function useVideos({ q, categoryId, order }: VideoQuery) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (categoryId) params.set('categoryId', categoryId);
  if (order) params.set('order', order);

  const resource = useApiResource<VideosResponse>(`/api/videos?${params}`);
  const state: VideosState = resource.state.status === 'success'
    ? { status: 'success', videos: resource.state.data.items }
    : resource.state;
  return { state, reload: resource.reload };
}
