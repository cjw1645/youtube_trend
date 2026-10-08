import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { postJson } from '../lib/api';
import type { ChatResponse } from '../types/chat';
import type { ThreadItem } from '../lib/chat-thread';
import type { StoredMessage } from './useConversations';
import { createChatSession, type ChatState, type ChatSnapshot } from '../lib/chat-session';
import { ApiRequestError } from '../lib/api';
import {
  CHAT_KEY,
  completedState,
  emptyConversation,
  persistConversation,
  readConversation,
} from '../lib/chat-storage';

const interruptedState = (snapshot: ChatSnapshot): ChatState => ({
  status: 'error',
  snapshot,
  error: new ApiRequestError(
    'INTERRUPTED',
    '새로고침 또는 페이지 이동으로 결과 수신이 중단되었습니다. 서버는 기존 요청을 계속 처리할 수 있습니다. 자동으로 재전송하지 않습니다. 다시 전송하면 새 호출이 발생합니다.',
    0,
  ),
});

export function useChat() {
  const auth = useAuth();
  const getToken = useRef(auth.getToken);
  getToken.current = auth.getToken;
  // 서버에 저장된 대화 ID(이어 묻기용). 새로고침하면 새 대화로 시작한다.
  const conversationId = useRef<string | undefined>(undefined);
  const [activeConversation, setActiveConversationState] = useState<string | undefined>();
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const setConversation = (id: string | undefined) => {
    conversationId.current = id;
    setActiveConversationState(id);
  };
  const userId = useRef<string | null>(auth.user?.id ?? null);
  const [initial] = useState(() => {
    try {
      return readConversation(sessionStorage);
    } catch {
      return {
        data: emptyConversation(),
        notice: '대화 저장소에 접근할 수 없습니다. 새로고침 복원이 제한됩니다.',
      };
    }
  });
  const memory = useRef(initial.data);
  const [question, renderQuestion] = useState(initial.data.draft);
  const [entries, setEntries] = useState(initial.data.entries);
  const [notice, setNotice] = useState(initial.notice);
  const [state, setState] = useState<ChatState>(() =>
    initial.data.pending
      ? interruptedState(initial.data.pending.snapshot)
      : initial.data.entries.length
        ? completedState(initial.data.entries.at(-1)!)
        : { status: 'idle' },
  );
  const pending = useRef(false);
  const leaving = useRef(false);
  function save() {
    memory.current.updatedAt = Date.now();
    try {
      setNotice(persistConversation(sessionStorage, memory.current));
    } catch {
      setNotice('대화 저장소에 접근할 수 없습니다. 새로고침 복원이 제한됩니다.');
    }
  }
  const [session] = useState(() =>
    createChatSession(
      (next) => {
        if (leaving.current) return;
        if (next.status === 'success' && next.response.conversationId) {
          conversationId.current = next.response.conversationId;
          setActiveConversationState(next.response.conversationId);
        }
        if (next.status === 'success') {
          const stamp = Date.now();
          const createdAt = new Date(stamp).toISOString();
          setThread((prev) => [
            ...prev,
            { key: `u${stamp}`, role: 'user', text: next.snapshot.question, createdAt },
            {
              key: `a${stamp}`,
              role: 'assistant',
              text: next.response.answer,
              createdAt,
              response: next.response,
              snapshot: next.snapshot,
            },
          ]);
        }
        pending.current = next.status === 'pending';
        // 채팅처럼 전송하면 입력창을 비우고, 실패하면 질문을 되돌려 다시 전송할 수 있게 한다.
        if (next.status === 'pending') {
          memory.current.draft = '';
          renderQuestion('');
        } else if (next.status === 'error' && !memory.current.draft) {
          memory.current.draft = next.snapshot.question;
          renderQuestion(next.snapshot.question);
        }
        memory.current.pending =
          next.status === 'pending' ? { snapshot: next.snapshot, startedAt: Date.now() } : null;
        if (next.status === 'success') {
          memory.current.entries = [
            ...memory.current.entries,
            { snapshot: next.snapshot, response: next.response, completedAt: Date.now() },
          ].slice(-10);
          setEntries(memory.current.entries);
        }
        setState(next);
        save();
      },
      async (body, signal) => {
        const token = await getToken.current();
        if (!token)
          throw new ApiRequestError(
            'UNAUTHORIZED',
            'AI 질문은 로그인한 뒤 사용할 수 있습니다.',
            401,
          );
        return postJson<ChatResponse>('/api/chat', body, signal, token);
      },
    ),
  );
  // 계정이 바뀌면 이전 계정의 서버 대화를 이어 가지 않는다.
  useEffect(() => {
    if (userId.current !== (auth.user?.id ?? null)) {
      setConversation(undefined);
      setThread([]);
      setState({ status: 'idle' });
    }
    userId.current = auth.user?.id ?? null;
  }, [auth.user?.id]);
  useEffect(() => {
    // 문서 이탈로 fetch가 실패해도 저장된 진행 표시를 오류 완료로 덮지 않는다.
    const leave = () => {
      leaving.current = true;
      session.cancel();
    };
    const restore = () => {
      if (!leaving.current) return;
      leaving.current = false;
      pending.current = false;
      if (memory.current.pending) setState(interruptedState(memory.current.pending.snapshot));
    };
    leaving.current = false;
    window.addEventListener('beforeunload', leave);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', restore);
      session.cancel();
    };
  }, [session]);
  function setQuestion(value: string) {
    memory.current.draft = value;
    renderQuestion(value);
    save();
  }
  function clear() {
    if (pending.current) return;
    setConversation(undefined);
    memory.current = emptyConversation();
    renderQuestion('');
    setEntries([]);
    setState({ status: 'idle' });
    try {
      sessionStorage.removeItem(CHAT_KEY);
      setNotice('대화 기록과 초안을 지웠습니다. 분석 대상과 관심 영상은 유지됩니다.');
    } catch {
      setNotice(
        '메모리 대화는 지웠지만 저장소 삭제에 실패했습니다. 새로고침 시 기록이 다시 나타날 수 있습니다.',
      );
    }
  }
  /** 저장된 대화를 채팅창에 불러오고 이어서 묻는 대상으로 지정한다. */
  function loadConversation(id: string, messages: StoredMessage[]) {
    if (pending.current) return;
    setThread(
      messages.map((message, index) => ({
        key: `s${id}-${index}`,
        role: message.role,
        text: message.content,
        createdAt: message.created_at,
      })),
    );
    setConversation(id);
    setState({ status: 'idle' });
  }
  function startNew() {
    if (pending.current) return;
    setConversation(undefined);
    setThread([]);
    setState({ status: 'idle' });
  }
  return {
    thread,
    loadConversation,
    startNew,
    question,
    setQuestion,
    state,
    submit: (text: string, target: Parameters<typeof session.submit>[1]) =>
      session.submit(text, target, conversationId.current),
    entries,
    notice,
    clear,
    userId: auth.user?.id ?? null,
    conversationId: activeConversation,
    setConversation,
    getToken: auth.getToken,
    signedIn: !!auth.user,
    authEnabled: auth.enabled,
    signIn: auth.signIn,
  };
}
export type ChatController = ReturnType<typeof useChat>;
