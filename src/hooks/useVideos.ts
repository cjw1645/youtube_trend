import { useEffect, useMemo, useState } from 'react';
import { ApiRequestError, authedJson, toApiRequestError } from '../lib/api';
import { startRequest } from '../lib/request';
import { useApiResource } from './useApiResource';
import type { Video, VideosResponse } from '../types/video';

export const POPULAR_CACHE_MS = 5 * 60 * 1000;
/** 전체 인기 차트(200개)를 pageToken으로 끝까지 수집한 목록. 대시보드와 영상 검색이 같은 응답을 공유한다. */
export const CHART_PATH = '/api/videos?chart=popular&all=1';

export interface VideoQuery {
  /** 서버로 보내는 조건은 검색어뿐이다. 비어 있으면 인기 차트 */
  q: string;
  /** 받은 목록 안에서만 거르는 화면 필터. 비어 있으면 전체 카테고리 */
  categoryId: string;
  /** 화면 정렬. 비어 있으면 인기순(검색은 관련도순)으로 API 제공 순서 유지 */
  order: '' | 'viewCount' | 'date';
}

export type VideosState =
  | { status: 'loading' }
  | { status: 'success'; videos: Video[]; fetchedAt: number }
  | { status: 'error'; error: ApiRequestError };

// 같은 검색 요청(키)은 한 번만 보낸다. StrictMode의 effect 재실행이나 재마운트가 검색 한도를 두 번 쓰지 않게 한다.
let lastSearch: { key: string; at: number; promise: Promise<VideosResponse> } | undefined;
/** 같은 키의 요청을 재사용하는 시간. 개발 모드 effect 재실행·재마운트 같은 즉시 중복만 막고, 사용자가 다시 검색하면 새로 조회한다. */
const SEARCH_REUSE_MS = 5000;

function searchOnce(
  key: string,
  q: string,
  getToken: () => Promise<string | null>,
): Promise<VideosResponse> {
  if (lastSearch?.key === key && Date.now() - lastSearch.at < SEARCH_REUSE_MS)
    return lastSearch.promise;
  const promise = (async () => {
    const token = await getToken();
    if (!token) throw new ApiRequestError('UNAUTHORIZED', '검색하려면 로그인이 필요합니다.', 401);
    return authedJson<VideosResponse>(
      `/api/videos?q=${encodeURIComponent(q)}&requestId=${crypto.randomUUID()}`,
      token,
      'GET',
    );
  })();
  lastSearch = { key, at: Date.now(), promise };
  promise.catch(() => {
    if (lastSearch?.promise === promise) lastSearch = undefined;
  });
  return promise;
}

/** 검색어가 없으면 인기 차트 200개(공유 캐시), 있으면 로그인 사용자의 키워드 검색 결과 50개. */
export function useVideos(q: string, getToken: () => Promise<string | null>) {
  const chart = useApiResource<VideosResponse>(q ? null : CHART_PATH, {
    cacheMs: POPULAR_CACHE_MS,
  });
  const [retry, setRetry] = useState(0);
  const key = `${retry}:${q}`;
  const [searched, setSearched] = useState<{ key: string; state: VideosState }>({
    key: '',
    state: { status: 'loading' },
  });
  useEffect(() => {
    if (!q) return;
    return startRequest(
      () => searchOnce(key, q, getToken),
      (data) =>
        setSearched({
          key,
          state: { status: 'success', videos: data.items, fetchedAt: Date.now() },
        }),
      (error) => setSearched({ key, state: { status: 'error', error: toApiRequestError(error) } }),
    );
  }, [q, key, getToken]);

  const state = useMemo<VideosState>(() => {
    if (q) return searched.key === key ? searched.state : { status: 'loading' };
    if (chart.state.status !== 'success') return chart.state;
    return {
      status: 'success',
      videos: chart.state.data.items,
      fetchedAt: chart.state.receivedAt,
    };
  }, [q, key, searched, chart.state]);
  return {
    state,
    reload: q ? () => setRetry((value) => value + 1) : chart.reload,
  };
}
