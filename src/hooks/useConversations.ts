import { useCallback, useEffect, useState } from 'react';
import { authedJson, toApiRequestError } from '../lib/api';

export interface ConversationSummary {
  id: string;
  updated_at: string;
  expires_at: string;
  first_question: string | null;
  turns: number | string;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
}

/** 서버에 저장된 내 AI 대화(7일 보관). 계정이 바뀌면 목록을 즉시 비운다. */
export function useConversations(
  userId: string | null,
  getToken: () => Promise<string | null>,
  /** 새 답변이 저장될 때마다 바뀌는 값. 바뀌면 목록을 다시 읽는다. */
  refreshKey: string | undefined,
) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  // 이 계정의 목록을 한 번이라도 읽어 왔는지(성공·실패 모두). 자동 복원 시점 판단용.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async <T>(path: string, method: 'GET' | 'DELETE'): Promise<T> => {
      const token = await getToken();
      if (!token) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      return authedJson<T>(path, token, method);
    },
    [getToken],
  );

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await call<{ conversations: ConversationSummary[] }>(
        '/api/conversations',
        'GET',
      );
      setItems(data.conversations);
      setError(null);
    } catch (failure) {
      setError(toApiRequestError(failure).message);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [call, userId]);

  useEffect(() => {
    setItems([]);
    setError(null);
    if (!userId) setLoaded(false);
    if (userId) void reload();
  }, [userId, reload, refreshKey]);

  const open = useCallback(
    async (id: string): Promise<StoredMessage[] | null> => {
      try {
        const data = await call<{ messages: StoredMessage[] }>(
          `/api/conversations?id=${id}`,
          'GET',
        );
        setError(null);
        return data.messages;
      } catch (failure) {
        setError(toApiRequestError(failure).message);
        return null;
      }
    },
    [call],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await call(`/api/conversations?id=${id}`, 'DELETE');
        setItems((prev) => prev.filter((item) => item.id !== id));
        setError(null);
        return true;
      } catch (failure) {
        setError(toApiRequestError(failure).message);
        return false;
      }
    },
    [call],
  );

  return { items, loading, loaded, error, reload, open, remove, signedIn: !!userId };
}
