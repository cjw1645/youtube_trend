import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnswerBody, answerRevealPlan } from './ChatResult';
import { useTypedReveal } from '../hooks/useTypedReveal';
import { copyChatText } from '../lib/chat-export';
import { formatNumericRanges } from '../lib/format';
import type { AnswerVideoInfo } from '../lib/answer-sections';
import type { ChatState } from '../lib/chat-session';
import type { ThreadItem } from '../lib/chat-thread';

function Bubble({
  item,
  animate,
  onReveal,
}: {
  item: ThreadItem;
  animate: boolean;
  onReveal: () => void;
}) {
  if (item.role === 'user')
    return (
      <li className="chat-turn is-user">
        <p className="chat-bubble">{item.text}</p>
        {item.createdAt && <time className="chat-time">{when(item.createdAt)}</time>}
      </li>
    );
  return <AssistantBubble item={item} animate={animate} onReveal={onReveal} />;
}

function AssistantBubble({
  item,
  animate,
  onReveal,
}: {
  item: ThreadItem;
  animate: boolean;
  onReveal: () => void;
}) {
  const [copied, setCopied] = useState<'done' | 'fail' | null>(null);
  const { response, snapshot } = item;
  const text = formatNumericRanges(item.text);
  const info = new Map<string, AnswerVideoInfo>([
    ...(snapshot?.videos ?? []).map(({ id, title }) => [id, { title }] as const),
    ...(response?.context.videos ?? []).map(
      ({ id, title, tags }) => [id, { title, tags }] as const,
    ),
  ]);
  // 방금 받은 답변만 채팅처럼 앞에서부터 보여 주고, 불러온 이전 대화는 그대로 전부 보여 준다.
  const plan = animate ? answerRevealPlan(text, info) : null;
  const { reveal, typing, skip } = useTypedReveal(
    plan?.total ?? 0,
    plan?.slowUntil ?? 0,
    animate,
    onReveal,
  );
  return (
    <li className="chat-turn is-assistant">
      <div
        className={`chat-bubble ${typing ? 'is-typing' : ''}`}
        aria-busy={typing}
        onClick={typing ? skip : undefined}
        title={typing ? '눌러서 전체 보기' : undefined}
      >
        {response && response.context.excludedIds.length > 0 && (
          <p className="chat-caution">
            조회할 수 없는 영상 {response.context.excludedIds.length}개를 제외하고{' '}
            {response.context.videos.length}개를 분석했습니다.
          </p>
        )}
        <AnswerBody
          answer={text}
          videos={response?.context.videos ?? []}
          ranking={response?.ranking?.ids}
          info={info}
          reveal={reveal}
        />
        {!typing && response?.notice && <p className="chat-caution">{response.notice}</p>}
      </div>
      <div className="chat-meta">
        {item.createdAt && <time className="chat-time">{when(item.createdAt)}</time>}
        <button
          type="button"
          className="trend-link"
          onClick={async () => {
            try {
              await copyChatText(item.text);
              setCopied('done');
            } catch {
              setCopied('fail');
            }
          }}
        >
          답변 복사
        </button>
        {copied && (
          <span role="status" className="chat-time">
            {copied === 'done' ? '복사했습니다' : '복사하지 못했습니다'}
          </span>
        )}
      </div>
    </li>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** 답변을 기다리는 동안 보이는 단계 표시. 실제 서버 진행률이 아니라 대기 중임을 알리는 표시다. */
function PendingSteps() {
  const [step, setStep] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(() => setStep(2), 1800);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div role="status" className="chat-steps">
      <p className="chat-steps-count">{step}단계 / 2단계 진행 중</p>
      <div className={`chat-step ${step === 1 ? 'is-active' : 'is-done'}`}>
        <span className="step-mark" aria-hidden="true">
          {step === 1 ? <span className="spinner" /> : '✓'}
        </span>
        질문을 파악하고 있습니다
      </div>
      <div className={`chat-step ${step === 2 ? 'is-active' : 'is-wait'}`}>
        <span className="step-mark" aria-hidden="true">
          {step === 2 ? <span className="spinner" /> : '2'}
        </span>
        답변을 생성하고 있습니다…
      </div>
    </div>
  );
}

const ERROR_TITLE: Record<string, string> = {
  INTERRUPTED: '이전 요청의 결과 수신이 중단되었습니다',
  QUOTA_EXCEEDED: '호출이 제한되었습니다',
  TIMEOUT: '분석 시간이 초과되었습니다',
  UNAUTHORIZED: '로그인이 필요합니다',
};

/** 대화 형식의 메시지 목록. 질문은 오른쪽, 답변은 왼쪽. 진행 중·오류는 마지막 답변 자리에 표시한다. */
export default function ChatThread({
  items,
  state,
}: {
  items: readonly ThreadItem[];
  state: ChatState;
}) {
  const end = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const live = state.status === 'pending' || state.status === 'error';
  // 답변을 기다리다 방금 도착한 마지막 답변만 채팅처럼 나타나게 한다(이전 대화를 열 때는 해당 없음).
  const [typingKey, setTypingKey] = useState<string | null>(null);
  const previous = useRef(state.status);
  useLayoutEffect(() => {
    if (previous.current === 'pending' && state.status === 'success') {
      const last = items.at(-1);
      if (last?.role === 'assistant') setTypingKey(last.key);
    }
    previous.current = state.status;
  }, [state.status, items]);
  // 글자가 늘어나는 동안 사용자가 위로 올려 읽고 있지 않을 때만 맨 아래를 따라간다.
  const follow = () => {
    const element = list.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 200)
      end.current?.scrollIntoView?.({ block: 'end' });
  };
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [items.length, state.status]);
  if (!items.length && !live) return null;
  return (
    <ol ref={list} className="chat-thread" aria-label="대화 내용" aria-live="polite">
      {items.map((item) => (
        <Bubble key={item.key} item={item} animate={item.key === typingKey} onReveal={follow} />
      ))}
      {live && (
        <>
          <li className="chat-turn is-user">
            <p className="chat-bubble">{state.snapshot.question}</p>
          </li>
          {state.status === 'pending' ? (
            <li className="chat-turn is-assistant">
              <PendingSteps />
            </li>
          ) : (
            state.status === 'error' && (
              <li className="chat-turn is-assistant">
                <div role="alert" className="chat-bubble is-error">
                  <p className="font-semibold">
                    {ERROR_TITLE[state.error.code] ?? 'AI 분석을 완료하지 못했습니다'}
                  </p>
                  <p>{state.error.message}</p>
                  <p className="chat-time">
                    현재 분석 대상을 확인하고 전송 버튼으로 다시 요청해 주세요.
                  </p>
                </div>
              </li>
            )
          )}
        </>
      )}
      <div ref={end} />
    </ol>
  );
}
