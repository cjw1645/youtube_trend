import type { ApiRequestError } from '../lib/api';
import { useMemo } from 'react';
import { useApiResource } from './useApiResource';
import type { SortOrder, Video, VideosResponse } from '../types/video';

export const POPULAR_CACHE_MS = 5 * 60 * 1000;

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
  | { status: 'success'; videos: Video[]; fetchedAt: number }
  | { status: 'error'; error: ApiRequestError };

/** 검색은 적용 조건으로 조회하고, 기본 인기 목록의 재정렬은 클라이언트에서 처리한다. */
export function useVideos({ q, categoryId, order }: VideoQuery) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (categoryId) params.set('categoryId', categoryId);
  if (order && (q || categoryId)) params.set('order', order);

  // 기본 인기 목록은 대시보드와 같은 응답을 5분간 공유한다.
  const resource = useApiResource<VideosResponse>(`/api/videos?${params}`, {
    cacheMs: q || categoryId ? 0 : POPULAR_CACHE_MS,
  });
  const state = useMemo<VideosState>(() => {
    if (resource.state.status !== 'success') return resource.state;
    const videos = resource.state.data.items;
    const sorted =
      q || categoryId || !order
        ? videos
        : [...videos].sort(
            order === 'viewCount'
              ? (a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1)
              : (a, b) => b.publishedAt.localeCompare(a.publishedAt),
          );
    return { status: 'success', videos: sorted, fetchedAt: resource.state.receivedAt };
  }, [resource.state, q, categoryId, order]);
  return { state, reload: resource.reload };
}
