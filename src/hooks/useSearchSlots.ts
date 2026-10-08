import { useCallback, useEffect, useState } from 'react';
import { authedJson, toApiRequestError } from '../lib/api';
import { useAuth } from './useAuth';
import type { SearchOrder, SearchWindow, SlotsResponse, SlotView } from '../types/trend';

export interface AddSearchInput {
  query: string;
  order: SearchOrder;
  window: SearchWindow;
}

/** 로그인 사용자의 검색어(최대 2개) 목록과 추가·해제. 계정이 바뀌면 이전 계정 데이터를 즉시 비운다. */
export function useSearchSlots() {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const { getToken } = auth;
  const [slots, setSlots] = useState<SlotView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const call = useCallback(
    async <T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> => {
      const token = await getToken();
      if (!token) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      return authedJson<T>(path, token, method, body);
    },
    [getToken],
  );

  const reload = useCallback(async () => {
    try {
      const data = await call<SlotsResponse>('/api/search-slots', 'GET');
      setSlots(data.slots);
      setError(null);
    } catch (failure) {
      setError(toApiRequestError(failure).message);
    }
  }, [call]);

  useEffect(() => {
    setSlots([]);
    setMessage(null);
    setError(null);
    if (userId) void reload();
  }, [userId, reload]);

  /** 빈 슬롯에 추가한다. 성공하면 추가된 슬롯 번호, 아니면 null(사유는 message). */
  const add = async (input: AddSearchInput): Promise<1 | 2 | null> => {
    const free = ([1, 2] as const).find((n) => !slots.some((s) => s.slot === n));
    if (!free) {
      setMessage('검색어는 최대 2개까지 추가할 수 있습니다.');
      return null;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await call<{ state: string; items?: number }>('/api/search-slots', 'POST', {
        slot: free,
        ...input,
        requestId: crypto.randomUUID(),
      });
      const failed: Record<string, string> = {
        budget_exhausted:
          '서비스의 오늘 검색 예산이 소진되어 조회하지 못했습니다. 내일 다시 시도해 주세요.',
        busy: '같은 조건의 조회가 진행 중입니다. 잠시 후 다시 확인해 주세요.',
        incomplete: '조회를 마치지 못했습니다. 잠시 후 다시 시도해 주세요.',
        store_failed: '조회를 마치지 못했습니다. 잠시 후 다시 시도해 주세요.',
        storage_hold: '저장 공간 보호를 위해 새 조회를 잠시 멈췄습니다.',
      };
      if (failed[result.state]) setMessage(failed[result.state]);
      await reload();
      return free;
    } catch (failure) {
      setMessage(toApiRequestError(failure).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slot: 1 | 2) => {
    setBusy(true);
    try {
      await call('/api/search-slots', 'DELETE', { slot });
      setMessage(null);
    } catch (failure) {
      setMessage(toApiRequestError(failure).message);
    } finally {
      setBusy(false);
      await reload();
    }
  };

  return { slots, error, busy, message, add, remove, call, reload };
}
