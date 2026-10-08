import { useState } from 'react';
import type { useConversations } from '../hooks/useConversations';

interface Props {
  history: ReturnType<typeof useConversations>;
  /** 지금 채팅창에 열려 있는 서버 대화 */
  activeId: string | undefined;
  onOpen: (id: string) => Promise<void>;
  onDeleted: (id: string) => void;
  disabled: boolean;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** 저장된 대화 목록: 누르면 채팅창에 불러오고, 삭제할 수 있다. 다른 기기에서도 같은 목록이 보인다. */
export default function ConversationHistory({
  history,
  activeId,
  onOpen,
  onDeleted,
  disabled,
}: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!history.signedIn) return null;
  return (
    <section className="conversation-history" aria-label="저장된 대화">
      {history.loading && history.items.length === 0 && (
        <p role="status" className="dash-empty">
          불러오는 중…
        </p>
      )}
      {history.error && (
        <p role="alert" className="text-sm text-red-700">
          {history.error}{' '}
          <button type="button" className="trend-link" onClick={() => void history.reload()}>
            다시 시도
          </button>
        </p>
      )}
      {!history.loading && !history.error && history.items.length === 0 && (
        <p className="dash-empty">저장된 대화가 없습니다. 질문하면 자동으로 저장됩니다.</p>
      )}
      <ul className="conversation-list">
        {history.items.map((item) => (
          <li key={item.id}>
            <div className="conversation-row">
              <button
                type="button"
                className="conversation-title"
                disabled={disabled}
                aria-current={activeId === item.id ? 'true' : undefined}
                onClick={() => void onOpen(item.id)}
              >
                {item.first_question ?? '(질문 없음)'}
              </button>
              <span className="conversation-meta">
                {Number(item.turns)}회 · {when(item.updated_at)} · {when(item.expires_at)}까지
              </span>
              <span className="conversation-actions">
                {activeId === item.id && <span className="chat-time">열려 있음</span>}
                {confirming === item.id ? (
                  <>
                    <button
                      type="button"
                      className="trend-link is-danger"
                      onClick={async () => {
                        if (await history.remove(item.id)) onDeleted(item.id);
                        setConfirming(null);
                      }}
                    >
                      삭제 확인
                    </button>
                    <button
                      type="button"
                      className="trend-link"
                      onClick={() => setConfirming(null)}
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="trend-link"
                    disabled={disabled}
                    onClick={() => setConfirming(item.id)}
                  >
                    삭제
                  </button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
