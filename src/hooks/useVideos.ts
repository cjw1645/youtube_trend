import { useEffect, useState } from 'react';
import { ApiRequestError, getJson, toApiRequestError } from '../lib/api';
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
  const [state, setState] = useState<VideosState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (categoryId) params.set('categoryId', categoryId);
    if (order) params.set('order', order);

    setState({ status: 'loading' });
    getJson<VideosResponse>(`/api/videos?${params}`, controller.signal)
      .then((res) => setState({ status: 'success', videos: res.items }))
      .catch((err) => {
        if (!controller.signal.aborted) setState({ status: 'error', error: toApiRequestError(err) });
      });

    return () => controller.abort();
  }, [q, categoryId, order, reloadKey]);

  return { state, reload: () => setReloadKey((k) => k + 1) };
}
