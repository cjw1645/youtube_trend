import { useEffect, useState } from 'react';
import { type ApiRequestError, getJson, toApiRequestError } from '../lib/api';
import { startRequest } from '../lib/request';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiRequestError };

export function useApiResource<T>(path: string) {
  const [retry, setRetry] = useState(0);
  const key = `${retry}:${path}`;
  const [result, setResult] = useState<{ key: string; state: ResourceState<T> }>({ key, state: { status: 'loading' } });
  useEffect(() => {
    setResult({ key, state: { status: 'loading' } });
    return startRequest(
      (signal) => getJson<T>(path, signal),
      (data) => setResult({ key, state: { status: 'success', data } }),
      (error) => setResult({ key, state: { status: 'error', error: toApiRequestError(error) } }),
    );
  }, [path, key]);
  // effect 실행 전 렌더에서도 이전 검색 조건의 결과를 표시하지 않는다.
  const state: ResourceState<T> = result.key === key ? result.state : { status: 'loading' };
  return { state, reload: () => setRetry((value) => value + 1) };
}
