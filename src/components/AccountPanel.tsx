import { useEffect, useRef, useState } from 'react';
import { ExitIcon, PersonIcon, TrashIcon } from '@radix-ui/react-icons';
import { useAuth } from '../hooks/useAuth';

/** 화면 오른쪽 위에 놓는 계정 영역. 로그아웃 상태는 로그인 버튼, 로그인 상태는 이메일을 누르면 열리는 메뉴. */
export default function AccountPanel() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!auth.enabled) return null;
  if (auth.loading)
    return (
      <span className="account-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        로그인 확인 중
      </span>
    );

  if (!auth.user) {
    return (
      <div className="account">
        <button className="login-button" type="button" onClick={() => void auth.signIn()}>
          <PersonIcon aria-hidden="true" />
          Google로 로그인
        </button>
        {auth.error && (
          <p role="alert" className="account-error">
            {auth.error}
          </p>
        )}
      </div>
    );
  }

  const email = auth.user.email ?? '로그인됨';
  const remove = async () => {
    setBusy(true);
    const failure = await auth.deleteAccount();
    setBusy(false);
    if (failure) setMessage(failure);
    else {
      setConfirming(false);
      setTyped('');
      setOpen(false);
    }
  };

  return (
    <div className="account" ref={root}>
      <button
        className="account-chip"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-avatar" aria-hidden="true">
          {email.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-email">{email}</span>
      </button>
      {open && (
        <div className="account-menu" role="menu" aria-label="계정">
          <p className="account-menu-email">{email}</p>
          <button
            className="menu-item"
            role="menuitem"
            type="button"
            onClick={() => void auth.signOut()}
          >
            <ExitIcon aria-hidden="true" />
            로그아웃
          </button>
          {!confirming ? (
            <button
              className="menu-item is-danger"
              role="menuitem"
              type="button"
              onClick={() => {
                setConfirming(true);
                setMessage(null);
              }}
            >
              <TrashIcon aria-hidden="true" />
              계정 삭제
            </button>
          ) : (
            <div className="account-confirm" role="group" aria-label="계정 삭제 확인">
              <p>
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
              <div className="account-confirm-actions">
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
            <p role="alert" className="account-error">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
