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

/** 로그인 사용자의 오늘 사용량. 로그아웃이거나 불러오지 못하면 null(표시하지 않는다). */
export function useUsage(): Usage | null {
  const { user, getToken } = useAuth();
  const userId = user?.id ?? null;
  const [usage, setUsage] = useState<Usage | null>(null);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) return setUsage(null);
    try {
      setUsage(await loadUsage(token));
    } catch {
      /* 표시용이라 실패해도 기능은 막지 않는다. 이전 값을 유지한다. */
    }
  }, [getToken]);

  useEffect(() => {
    setUsage(null);
    if (!userId) return;
    void refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [userId, refresh]);

  return userId ? usage : null;
}
