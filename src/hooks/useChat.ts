import { useEffect, useRef, useState } from 'react';
import { createChatSession, type ChatState,type ChatSnapshot } from '../lib/chat-session';
import { ApiRequestError } from '../lib/api';
import { CHAT_KEY, completedState, emptyConversation, persistConversation, readConversation } from '../lib/chat-storage';

const interruptedState=(snapshot:ChatSnapshot):ChatState=>({status:'error',snapshot,error:new ApiRequestError('INTERRUPTED','새로고침 또는 페이지 이동으로 결과 수신이 중단되었습니다. 서버는 기존 요청을 계속 처리할 수 있습니다. 자동으로 재전송하지 않습니다. 다시 전송하면 새 호출이 발생합니다.',0)});

export function useChat() {
  const [initial] = useState(() => { try { return readConversation(sessionStorage); } catch { return { data: emptyConversation(), notice: '대화 저장소에 접근할 수 없습니다. 새로고침 복원이 제한됩니다.' }; } });
  const memory = useRef(initial.data);
  const [question, renderQuestion] = useState(initial.data.draft);
  const [entries, setEntries] = useState(initial.data.entries);
  const [notice, setNotice] = useState(initial.notice);
  const [state, setState] = useState<ChatState>(() => initial.data.pending ? interruptedState(initial.data.pending.snapshot) : initial.data.entries.length ? completedState(initial.data.entries.at(-1)!) : { status: 'idle' });
  const pending = useRef(false);
  const leaving = useRef(false);
  function save() {
    memory.current.updatedAt = Date.now();
    try { setNotice(persistConversation(sessionStorage, memory.current)); }
    catch { setNotice('대화 저장소에 접근할 수 없습니다. 새로고침 복원이 제한됩니다.'); }
  }
  const [session] = useState(() => createChatSession(next => {
    if (leaving.current) return;
    pending.current = next.status === 'pending';
    memory.current.pending = next.status === 'pending' ? { snapshot: next.snapshot, startedAt: Date.now() } : null;
    if (next.status === 'success') {
      memory.current.entries = [...memory.current.entries, { snapshot: next.snapshot, response: next.response, completedAt: Date.now() }].slice(-10);
      setEntries(memory.current.entries);
    }
    setState(next);
    save();
  }));
  useEffect(() => {
    // 문서 이탈로 fetch가 실패해도 저장된 진행 표시를 오류 완료로 덮지 않는다.
    const leave = () => { leaving.current = true; session.cancel(); };
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
  function setQuestion(value: string) { memory.current.draft = value; renderQuestion(value); save(); }
  function clear() {
    if (pending.current) return;
    memory.current = emptyConversation();
    renderQuestion(''); setEntries([]); setState({ status: 'idle' });
    try { sessionStorage.removeItem(CHAT_KEY); setNotice('대화 기록과 초안을 지웠습니다. 분석 대상과 관심 영상은 유지됩니다.'); }
    catch { setNotice('메모리 대화는 지웠지만 저장소 삭제에 실패했습니다. 새로고침 시 기록이 다시 나타날 수 있습니다.'); }
  }
  return { question, setQuestion, state, submit: session.submit, entries, notice, clear };
}
export type ChatController = ReturnType<typeof useChat>;
