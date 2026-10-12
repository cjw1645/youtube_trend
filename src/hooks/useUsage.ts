import { useCallback, useEffect, useState } from 'react';
import { authedJson } from '../lib/api';
import { useAuth } from './useAuth';

export interface Usage {
  ai: { used: number; limit: number };
  search: { used: number; limit: number };
}

const CHANGED = 'youtube-trend:usage-changed';

/** AI 질문·검색을 쓴 뒤 호출하면 화면의 남은 횟수가 다시 계산된다. */
export function notifyUsageChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** 같은 순간에 여러 화면이 요청해도 한 번만 조회한다. */
let inflight: { token: string; promise: Promise<Usage> } | undefined;

function loadUsage(token: string): Promise<Usage> {
  if (inflight?.token === token) return inflight.promise;
  const promise = authedJson<{ usage: Usage }>('/api/account', token, 'GET').then(
    (body) => body.usage,
  );
  inflight = { token, promise };
  const clear = () => {
    if (inflight?.promise === promise) inflight = undefined;
  };
  promise.then(clear, clear);
  return promise;
}

/**
 * 로그인 사용자의 오늘 사용량. 로그아웃이면 usage는 null이다.
 * 불러오지 못하면 이전 값을 유지하고(없으면 null) failed를 켜서 화면이 "확인하지 못했다"고 알릴 수 있게 한다.
 */
export function useUsageState(): { usage: Usage | null; failed: boolean; retry: () => void } {
  const { user, getToken } = useAuth();
  const userId = user?.id ?? null;
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUsage(null);
      return setFailed(false);
    }
    try {
      setUsage(await loadUsage(token));
      setFailed(false);
    } catch {
      /* 표시용이라 실패해도 기능은 막지 않는다. */
      setFailed(true);
    }
  }, [getToken]);

  useEffect(() => {
    setUsage(null);
    setFailed(false);
    if (!userId) return;
    void refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [userId, refresh]);

  return { usage: userId ? usage : null, failed: !!userId && failed, retry: () => void refresh() };
}

/** 로그인 사용자의 오늘 사용량. 로그아웃이거나 불러오지 못하면 null. */
export function useUsage(): Usage | null {
  return useUsageState().usage;
}
