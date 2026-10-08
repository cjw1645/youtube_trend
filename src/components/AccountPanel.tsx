import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function AccountPanel() {
  const auth = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!auth.enabled) return null;
  if (auth.loading)
    return (
      <p className="sidebar-info" role="status">
        로그인 상태 확인 중…
      </p>
    );

  if (!auth.user) {
    return (
      <div className="flex flex-col gap-2">
        <button className="secondary-button" type="button" onClick={() => void auth.signIn()}>
          Google로 로그인
        </button>
        <p className="sidebar-info">
          로그인하면 관심 영상이 계정에 저장되어 다른 기기에서도 볼 수 있습니다.
        </p>
        {auth.error && (
          <p role="alert" className="text-sm text-red-700">
            {auth.error}
          </p>
        )}
      </div>
    );
  }

  const remove = async () => {
    setBusy(true);
    const failure = await auth.deleteAccount();
    setBusy(false);
    if (failure) setMessage(failure);
    else {
      setConfirming(false);
      setTyped('');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="sidebar-info" title={auth.user.email ?? undefined}>
        {auth.user.email ?? '로그인됨'}
      </p>
      <button className="secondary-button" type="button" onClick={() => void auth.signOut()}>
        로그아웃
      </button>
      {!confirming ? (
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setConfirming(true);
            setMessage(null);
          }}
        >
          계정 삭제
        </button>
      ) : (
        <div className="flex flex-col gap-2" role="group" aria-label="계정 삭제 확인">
          <p className="text-sm">
            관심 영상, AI 대화, 검색어 설정이 즉시 삭제되며 되돌릴 수 없습니다. 계속하려면
            <strong> 삭제 </strong>를 입력하세요.
          </p>
          <input
            className="account-input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label="삭제 확인 입력"
            autoComplete="off"
          />
          <div className="flex gap-2">
            <button
              className="secondary-button"
              type="button"
              disabled={busy || typed.trim() !== '삭제'}
              onClick={() => void remove()}
            >
              {busy ? '삭제 중…' : '계정 영구 삭제'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setTyped('');
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}
    </div>
  );
}
