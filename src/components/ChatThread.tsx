import { useEffect, useRef, useState } from 'react';
import { AnswerBody } from './ChatResult';
import { copyChatText } from '../lib/chat-export';
import { formatNumericRanges } from '../lib/format';
import type { AnswerVideoInfo } from '../lib/answer-sections';
import type { ChatState } from '../lib/chat-session';
import type { ThreadItem } from '../lib/chat-thread';

function Bubble({ item }: { item: ThreadItem }) {
  const [copied, setCopied] = useState<'done' | 'fail' | null>(null);
  if (item.role === 'user')
    return (
      <li className="chat-turn is-user">
        <p className="chat-bubble">{item.text}</p>
        {item.createdAt && <time className="chat-time">{when(item.createdAt)}</time>}
      </li>
    );
  const { response, snapshot } = item;
  return (
    <li className="chat-turn is-assistant">
      <div className="chat-bubble">
        {response && response.context.excludedIds.length > 0 && (
          <p className="chat-caution">
            조회할 수 없는 영상 {response.context.excludedIds.length}개를 제외하고{' '}
            {response.context.videos.length}개를 분석했습니다.
          </p>
        )}
        <AnswerBody
          answer={formatNumericRanges(item.text)}
          videos={response?.context.videos ?? []}
          ranking={response?.ranking?.ids}
          info={
            new Map<string, AnswerVideoInfo>([
              ...(snapshot?.videos ?? []).map(({ id, title }) => [id, { title }] as const),
              ...(response?.context.videos ?? []).map(
                ({ id, title, tags }) => [id, { title, tags }] as const,
              ),
            ])
          }
        />
        {response?.notice && <p className="chat-caution">{response.notice}</p>}
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
  const live = state.status === 'pending' || state.status === 'error';
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [items.length, state.status]);
  if (!items.length && !live)
    return (
      <p className="chat-empty">
        아직 대화가 없습니다. 아래 입력창에 질문하면 이곳에 대화가 이어집니다.
      </p>
    );
  return (
    <ol className="chat-thread" aria-label="대화 내용" aria-live="polite">
      {items.map((item) => (
        <Bubble key={item.key} item={item} />
      ))}
      {live && (
        <>
          <li className="chat-turn is-user">
            <p className="chat-bubble">{state.snapshot.question}</p>
          </li>
          {state.status === 'pending' ? (
            <li className="chat-turn is-assistant">
              <p role="status" className="chat-bubble is-pending">
                영상 정보를 분석하고 있습니다…
              </p>
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
