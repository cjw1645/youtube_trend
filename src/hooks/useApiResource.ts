import { useEffect, useRef, useState } from 'react';
import { type ApiRequestError, getJson, toApiRequestError } from '../lib/api';
import { startRequest } from '../lib/request';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T; receivedAt: number }
  | { status: 'error'; error: ApiRequestError };

/** 같은 경로를 쓰는 화면(대시보드·영상 검색)이 성공 응답을 잠시 공유한다. 실패는 공유하지 않는다. */
const shared = new Map<string, { at: number; promise: Promise<unknown> }>();

function loadShared<T>(path: string, cacheMs: number, force: boolean): Promise<T> {
  const hit = shared.get(path);
  if (!force && hit && Date.now() - hit.at < cacheMs) return hit.promise as Promise<T>;
  // 공유 요청은 한 화면의 이탈로 취소하지 않는다. 결과 반영 여부는 startRequest가 정한다.
  const promise = getJson<T>(path).catch((error: unknown) => {
    if (shared.get(path)?.promise === promise) shared.delete(path);
    throw error;
  });
  shared.set(path, { at: Date.now(), promise });
  return promise;
}

export function useApiResource<T>(path: string, { cacheMs = 0 }: { cacheMs?: number } = {}) {
  const [retry, setRetry] = useState(0);
  const key = `${retry}:${path}`;
  const appliedRetry = useRef(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<T> }>({
    key,
    state: { status: 'loading' },
  });
  useEffect(() => {
    setResult({ key, state: { status: 'loading' } });
    // 다시 시도 버튼으로 바뀐 경우에만 공유 응답을 건너뛴다.
    const force = retry !== appliedRetry.current;
    appliedRetry.current = retry;
    return startRequest(
      (signal) => (cacheMs > 0 ? loadShared<T>(path, cacheMs, force) : getJson<T>(path, signal)),
      (data) =>
        setResult({
          key,
          // 공유 응답은 실제로 받은 시점을 유지한다.
          state: {
            status: 'success',
            data,
            receivedAt: (cacheMs > 0 && shared.get(path)?.at) || Date.now(),
          },
        }),
      (error) => setResult({ key, state: { status: 'error', error: toApiRequestError(error) } }),
    );
  }, [path, key, retry, cacheMs]);
  // effect 실행 전 렌더에서도 이전 검색 조건의 결과를 표시하지 않는다.
  const state: ResourceState<T> = result.key === key ? result.state : { status: 'loading' };
  return { state, reload: () => setRetry((value) => value + 1) };
}
