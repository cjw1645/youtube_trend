import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { PaperPlaneIcon } from '@radix-ui/react-icons';
import type { ChatController } from '../hooks/useChat';
import { useConversations } from '../hooks/useConversations';
import { MAX_QUESTION_CHARS, selectChatVideos, type ChatTarget } from '../lib/chat-session';
import ChatThread from './ChatThread';
import ConversationHistory from './ConversationHistory';

/** 입력창에 예시로만 보여준다(누르는 버튼이 아니다). */
const EXAMPLE_PLACEHOLDER = [
  '예) 현재 유튜브 트렌드를 분석해줘',
  '예) 이 영상이 인기 있는 이유를 분석해줘',
  '예) 다음 콘텐츠 아이디어 3개를 제안해줘',
].join('\n');
/** 대화 보관 기간(일). DB의 save_chat_turn 만료 기간과 같아야 한다. */
export const CONVERSATION_RETENTION_DAYS = 7;

export function submitChatOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229
  )
    return;
  event.preventDefault();
  if (!event.repeat) event.currentTarget.form?.requestSubmit();
}

const noToken = async () => null;

export default function ChatPanel({ chat, target }: { chat: ChatController; target: ChatTarget }) {
  const inputId = useId();
  const videos = selectChatVideos(target.videos);
  const { state, question } = chat;
  const pending = state.status === 'pending';
  const length = [...question.trim()].length;
  const disabled =
    pending || !videos.length || !length || length > MAX_QUESTION_CHARS || !chat.signedIn;
  const history = useConversations(
    chat.userId ?? null,
    chat.getToken ?? noToken,
    chat.conversationId,
  );

  // 로그인하면 가장 최근 대화를 채팅창에 자동으로 불러온다(계정당 한 번, 이미 열려 있으면 건드리지 않는다).
  const restored = useRef<string | null>(null);
  const first = history.items[0];
  useEffect(() => {
    if (!chat.userId || restored.current === chat.userId || !history.loaded) return;
    if (!first) {
      restored.current = chat.userId;
      return;
    }
    restored.current = chat.userId;
    if (chat.conversationId || chat.thread?.length) return;
    void history.open(first.id).then((messages) => {
      if (messages) chat.loadConversation?.(first.id, messages);
    });
    // history.open·chat은 매 렌더 새로 만들어지므로 의존성에 넣지 않는다(계정당 한 번만 실행).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.userId, first?.id, history.loaded]);

  return (
    <section aria-label="AI 데이터 분석" className="chat-window">
      <header className="chat-window-head">
        <div>
          <h2>AI 대화</h2>
          <p>
            최근 3회 문답만 분석에 사용됩니다 · 대화는 {CONVERSATION_RETENTION_DAYS}일간 저장되어
            채팅으로 남습니다
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={pending || (!chat.conversationId && !chat.thread?.length)}
          onClick={() => chat.startNew?.()}
        >
          새 대화
        </button>
      </header>
      {chat.notice && (
        <p role="status" className="chat-caution">
          {chat.notice}
        </p>
      )}
      <ChatThread items={chat.thread ?? []} state={state} />
      {!chat.signedIn && (
        <div role="status" className="chat-login">
          <p>AI 질문은 로그인한 사용자만 사용할 수 있습니다(하루 10회, 30초 간격).</p>
          {chat.authEnabled && (
            <button type="button" className="secondary-button" onClick={() => void chat.signIn()}>
              Google로 로그인
            </button>
          )}
        </div>
      )}
      <form
        className="chat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) void chat.submit(question, target);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          분석 질문
        </label>
        <textarea
          id={inputId}
          aria-describedby={`${inputId}-help`}
          value={question}
          disabled={pending}
          onChange={(event) => chat.setQuestion(event.target.value)}
          onKeyDown={submitChatOnEnter}
          rows={3}
          placeholder={EXAMPLE_PLACEHOLDER}
        />
        <div className="chat-compose-bar">
          <span id={`${inputId}-help`} className="chat-time">
            Enter로 전송 · Shift+Enter로 줄바꿈
          </span>
          <span className={`chat-time ${length > MAX_QUESTION_CHARS ? 'text-red-700' : ''}`}>
            {length.toLocaleString('ko-KR')} / {MAX_QUESTION_CHARS}자
          </span>
          <button type="submit" disabled={disabled} className="primary-button">
            <PaperPlaneIcon aria-hidden="true" />
            {pending ? '분석 중…' : '전송'}
          </button>
        </div>
      </form>
      <ConversationHistory
        history={history}
        activeId={chat.conversationId}
        disabled={pending}
        onOpen={async (id) => {
          const messages = await history.open(id);
          if (messages) chat.loadConversation?.(id, messages);
        }}
        onDeleted={(id) => {
          if (chat.conversationId === id) chat.startNew?.();
        }}
      />
    </section>
  );
}
