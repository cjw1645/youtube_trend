import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowUpIcon,
  ChatBubbleIcon,
  ClockIcon,
  MixerHorizontalIcon,
  PlusIcon,
} from '@radix-ui/react-icons';
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
/** 시작 화면의 빠른 입력. 누르면 입력창에 채워질 뿐 전송하지 않는다. */
const QUICK_PROMPTS = [
  { icon: '↗', label: '현재 트렌드 분석', text: '현재 유튜브 트렌드를 분석해줘' },
  { icon: '?', label: '인기 이유 분석', text: '이 영상이 인기 있는 이유를 분석해줘' },
  { icon: '+', label: '콘텐츠 아이디어', text: '다음 콘텐츠 아이디어 3개를 제안해줘' },
];
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

type Popover = 'target' | 'history' | null;

export default function ChatPanel({
  chat,
  target,
  tools,
}: {
  chat: ChatController;
  target: ChatTarget;
  /** 분석 대상을 바꾸는 컨트롤(도구 팝오버 안에 표시) */
  tools?: ReactNode;
}) {
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
  const [popover, setPopover] = useState<Popover>(null);
  const area = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!popover) return;
    const onPointer = (event: PointerEvent) => {
      if (!area.current?.contains(event.target as Node)) setPopover(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPopover(null);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover]);

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

  const started = (chat.thread?.length ?? 0) > 0 || state.status !== 'idle';
  const toggle = (next: Exclude<Popover, null>) =>
    setPopover((now) => (now === next ? null : next));
  const canReset = !pending && (!!chat.conversationId || !!chat.thread?.length);

  const composer = (
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
        ref={field}
        aria-describedby={`${inputId}-help`}
        value={question}
        disabled={pending}
        onChange={(event) => chat.setQuestion(event.target.value)}
        onKeyDown={submitChatOnEnter}
        rows={3}
        placeholder={EXAMPLE_PLACEHOLDER}
      />
      <div className="chat-compose-bar">
        <button
          type="button"
          className={`tool-button ${popover === 'target' ? 'is-open' : ''}`}
          aria-expanded={popover === 'target'}
          onClick={() => toggle('target')}
        >
          <MixerHorizontalIcon aria-hidden="true" />
          분석 대상
          <span className="tool-count">{videos.length}</span>
        </button>
        <span id={`${inputId}-help`} className="chat-time chat-help">
          Enter로 전송 · Shift+Enter로 줄바꿈
        </span>
        <span className={`chat-time ${length > MAX_QUESTION_CHARS ? 'text-red-700' : ''}`}>
          {length.toLocaleString('ko-KR')} / {MAX_QUESTION_CHARS}자
        </span>
        <button
          type="submit"
          disabled={disabled}
          className={`send-button ${pending ? 'is-pending' : ''}`}
          aria-label={pending ? '분석 중…' : '질문 전송'}
        >
          {pending ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <ArrowUpIcon aria-hidden="true" />
          )}
          <span className="sr-only">{pending ? '분석 중…' : '전송'}</span>
        </button>
      </div>
    </form>
  );

  return (
    <section
      aria-label="AI 데이터 분석"
      className={`chat-window ${started ? 'is-started' : 'is-empty'}`}
      ref={area}
    >
      <header className="chat-window-head">
        <div className="chat-head-title">
          <h2>
            <ChatBubbleIcon aria-hidden="true" />
            AI 대화
          </h2>
          <p>
            최근 3회 문답만 분석에 사용됩니다 · 대화는 {CONVERSATION_RETENTION_DAYS}일간 저장되어
            채팅으로 남습니다
          </p>
        </div>
        <div className="chat-head-actions">
          {chat.signedIn && (
            <button
              type="button"
              className={`ghost-button ${popover === 'history' ? 'is-open' : ''}`}
              aria-expanded={popover === 'history'}
              onClick={() => toggle('history')}
            >
              <ClockIcon aria-hidden="true" />
              저장된 대화
              <span className="tool-count">{history.items.length}</span>
            </button>
          )}
          <button
            type="button"
            className="ghost-button"
            disabled={!canReset}
            onClick={() => chat.startNew?.()}
          >
            <PlusIcon aria-hidden="true" />새 대화
          </button>
        </div>
        {popover === 'history' && (
          <div className="popover is-history" role="dialog" aria-label="저장된 대화">
            <ConversationHistory
              history={history}
              activeId={chat.conversationId}
              disabled={pending}
              onOpen={async (id) => {
                const messages = await history.open(id);
                if (messages) {
                  chat.loadConversation?.(id, messages);
                  setPopover(null);
                }
              }}
              onDeleted={(id) => {
                if (chat.conversationId === id) chat.startNew?.();
              }}
            />
          </div>
        )}
      </header>

      {chat.notice && (
        <p role="status" className="chat-caution">
          {chat.notice}
        </p>
      )}

      {!started && (
        <div className="chat-hero">
          <h2 className="chat-hero-title">어떤 유튜브 트렌드가 궁금하세요?</h2>
          <p className="chat-hero-sub">
            조회한 영상의 공개 정보만 근거로 답합니다. 분석 대상은 {videos.length}개입니다.
          </p>
        </div>
      )}

      <ChatThread items={chat.thread ?? []} state={state} />

      <div className="chat-dock">
        {!chat.signedIn && (
          <div role="status" className="chat-login">
            <p>AI 질문은 로그인한 사용자만 사용할 수 있습니다(하루 10회, 30초 간격).</p>
            {chat.authEnabled && (
              <button type="button" className="login-button" onClick={() => void chat.signIn()}>
                Google로 로그인
              </button>
            )}
          </div>
        )}
        <div className="chat-compose-wrap">
          {popover === 'target' && (
            <div className="popover is-target" role="dialog" aria-label="분석 대상">
              <p className="popover-title">
                분석 대상 {videos.length}개 · {target.label}
              </p>
              {tools}
            </div>
          )}
          {composer}
        </div>
        {!started && (
          <ul className="quick-prompts" aria-label="질문 예시">
            {QUICK_PROMPTS.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  className="quick-prompt"
                  onClick={() => {
                    chat.setQuestion(item.text);
                    field.current?.focus();
                  }}
                >
                  <span className="quick-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="chat-disclaimer">
          AI는 실수를 할 수 있습니다. 중요한 정보는 직접 확인하세요.
        </p>
      </div>
    </section>
  );
}
