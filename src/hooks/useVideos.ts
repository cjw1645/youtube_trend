import type { ApiRequestError } from '../lib/api';
import { useMemo } from 'react';
import { useApiResource } from './useApiResource';
import type { SortOrder, Video, VideosResponse } from '../types/video';

export interface VideoQuery {
  /** 검색어와 카테고리가 둘 다 비어 있으면 API 인기 목록 */
  q: string;
  /** 비어 있으면 전체 카테고리 */
  categoryId: string;
  /** 비어 있으면 인기순 표시로 API 제공 순서 유지(검색은 기본 관련도) */
  order: SortOrder | '';
}

export type VideosState =
  | { status: 'loading' }
  | { status: 'success'; videos: Video[]; fetchedAt:number }
  | { status: 'error'; error: ApiRequestError };

/** 조건이 바뀔 때만 /api/videos를 호출한다. 검색은 검색어 제출 시에만 q가 바뀌므로 입력 중에는 호출하지 않는다. */
export function useVideos({ q, categoryId, order }: VideoQuery) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (categoryId) params.set('categoryId', categoryId);
  if (order && (q || categoryId)) params.set('order', order);

  const resource = useApiResource<VideosResponse>(`/api/videos?${params}`);
  const fetchedAt=useMemo(()=>Date.now(),[resource.state]);
  const state = useMemo<VideosState>(() => {
    if (resource.state.status !== 'success') return resource.state;
    const videos = resource.state.data.items;
    const sorted = q || categoryId || !order ? videos : [...videos].sort(order === 'viewCount' ? (a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1) : (a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return { status: 'success', videos: sorted, fetchedAt };
  }, [resource.state, q, categoryId, order,fetchedAt]);
  return { state, reload: resource.reload };
}
