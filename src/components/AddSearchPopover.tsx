import { useEffect, useRef, useState } from 'react';
import { PlusIcon } from '@radix-ui/react-icons';
import { useAuth } from '../hooks/useAuth';
import type { AddSearchInput } from '../hooks/useSearchSlots';
import type { SearchOrder, SearchWindow } from '../types/trend';

export const ORDER_LABEL: Record<SearchOrder, string> = {
  relevance: '관련도순',
  date: '최신순',
  viewCount: '조회수순',
};
export const WINDOW_LABEL: Record<SearchWindow, string> = {
  '': '기간 제한 없음',
  '1d': '최근 1일',
  '7d': '최근 7일',
  '30d': '최근 30일',
};
/** 로그아웃 상태에서 추가를 누르면 저장해 두었다가, 로그인 복귀 후 추가 창을 자동으로 연다. */
export const PENDING_ADD_KEY = 'youtube-trend:add-search-after-login';
export const MAX_SLOTS = 2;

interface Props {
  full: boolean;
  busy: boolean;
  onAdd: (input: AddSearchInput) => Promise<1 | 2 | null>;
  onAdded: (slot: 1 | 2) => void;
}

/** 「＋ 검색어 추가」 버튼과, 버튼 바로 아래에 붙어 뜨는 작은 입력 창(모달이 아니며 바깥 클릭·Esc로 닫힌다). */
export default function AddSearchPopover({ full, busy, onAdd, onAdded }: Props) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<SearchOrder>('relevance');
  const [window, setWindow] = useState<SearchWindow>('');
  const root = useRef<HTMLDivElement>(null);

  // 로그인하러 갔다 돌아오면 추가 창을 연다.
  useEffect(() => {
    if (!auth.user) return;
    try {
      if (sessionStorage.getItem(PENDING_ADD_KEY)) {
        sessionStorage.removeItem(PENDING_ADD_KEY);
        setOpen(true);
      }
    } catch {
      /* 저장소를 못 쓰면 사용자가 다시 추가를 누른다 */
    }
  }, [auth.user]);

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

  const start = () => {
    if (!auth.user) {
      try {
        sessionStorage.setItem(PENDING_ADD_KEY, '1');
      } catch {
        /* 무시 */
      }
      void auth.signIn();
      return;
    }
    setOpen((value) => !value);
  };

  return (
    <div className="add-search" ref={root}>
      <button
        type="button"
        className="primary-button add-search-button"
        onClick={start}
        disabled={full}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={full ? `검색어는 최대 ${MAX_SLOTS}개까지 추가할 수 있습니다` : undefined}
      >
        <PlusIcon aria-hidden="true" /> 검색어 추가
      </button>
      {open && auth.user && !full && (
        <form
          className="popover add-search-popover"
          role="dialog"
          aria-label="검색어 추가"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!query.trim()) return;
            const added = await onAdd({ query, order, window });
            if (added) {
              setQuery('');
              setOpen(false);
              onAdded(added);
            }
          }}
        >
          <label>
            검색어 (1~100자)
            <input
              autoFocus
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="예: 고양이 간식"
            />
          </label>
          <div className="add-search-row">
            <label>
              정렬
              <select value={order} onChange={(e) => setOrder(e.target.value as SearchOrder)}>
                {Object.entries(ORDER_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              게시 기간
              <select value={window} onChange={(e) => setWindow(e.target.value as SearchWindow)}>
                {Object.entries(WINDOW_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="primary-button" disabled={busy || !query.trim()}>
            {busy ? '조회 중…' : '추가'}
          </button>
          <p className="trend-note">
            한국(KR)·한국어 기준 YouTube 검색 결과 최대 200개를 한 번 조회하고 이후 매일 갱신합니다.
            검색 호출 한도를 사용합니다.
          </p>
        </form>
      )}
    </div>
  );
}
