import { useEffect, useState } from 'react';
import { Cross2Icon, PlusIcon } from '@radix-ui/react-icons';
import { useAuth } from '../hooks/useAuth';
import type { AddSearchInput } from '../hooks/useSearchSlots';
import type { SearchOrder, SearchWindow, SlotView } from '../types/trend';

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
const PENDING_KEY = 'youtube-trend:add-search-after-login';
const MAX_SLOTS = 2;

interface Props {
  slots: readonly SlotView[];
  selected: 1 | 2 | null;
  busy: boolean;
  message: string | null;
  onSelect: (slot: 1 | 2) => void;
  onAdd: (input: AddSearchInput) => Promise<1 | 2 | null>;
  onRemove: (slot: 1 | 2) => void;
}

/** 카테고리 탭 아래의 「내 검색어」 탭 줄. 추가를 누르면 로그아웃 상태에서는 로그인으로 보낸다. */
export default function SearchTabs({
  slots,
  selected,
  busy,
  message,
  onSelect,
  onAdd,
  onRemove,
}: Props) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<SearchOrder>('relevance');
  const [window, setWindow] = useState<SearchWindow>('');

  // 로그인하러 갔다 돌아오면 입력창을 다시 연다.
  useEffect(() => {
    if (!auth.user) return;
    try {
      if (sessionStorage.getItem(PENDING_KEY)) {
        sessionStorage.removeItem(PENDING_KEY);
        setOpen(true);
      }
    } catch {
      /* 저장소를 못 쓰면 사용자가 다시 추가를 누른다 */
    }
  }, [auth.user]);

  if (!auth.enabled && slots.length === 0) return null;

  const startAdd = () => {
    if (!auth.user) {
      try {
        sessionStorage.setItem(PENDING_KEY, '1');
      } catch {
        /* 무시 */
      }
      void auth.signIn();
      return;
    }
    setOpen((value) => !value);
  };

  return (
    <div className="search-tabs">
      <nav className="dash-tabs" aria-label="내 검색어">
        <span className="tab-group-label">내 검색어</span>
        {slots.map((item) => (
          <span key={item.slot} className="search-tab">
            <button
              type="button"
              aria-pressed={selected === item.slot}
              onClick={() => onSelect(item.slot)}
              title={`${ORDER_LABEL[item.conditions.order]} · ${WINDOW_LABEL[item.conditions.window]}`}
            >
              {item.conditions.query}
            </button>
            <button
              type="button"
              className="tab-remove"
              disabled={busy}
              aria-label={`${item.conditions.query} 검색어 해제`}
              onClick={() => onRemove(item.slot)}
            >
              <Cross2Icon aria-hidden="true" />
            </button>
          </span>
        ))}
        {slots.length < MAX_SLOTS ? (
          <button type="button" className="tab-add" onClick={startAdd} aria-expanded={open}>
            <PlusIcon aria-hidden="true" /> 검색어 추가
          </button>
        ) : (
          <span className="tab-limit">
            {MAX_SLOTS}/{MAX_SLOTS}
          </span>
        )}
      </nav>
      {open && auth.user && slots.length < MAX_SLOTS && (
        <form
          className="search-add"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!query.trim()) return;
            const added = await onAdd({ query, order, window });
            if (added) {
              setQuery('');
              setOpen(false);
              onSelect(added);
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
          <button type="submit" className="primary-button" disabled={busy || !query.trim()}>
            {busy ? '조회 중…' : '추가'}
          </button>
          <p className="trend-note">
            한국(KR)·한국어 기준 YouTube 검색 결과 최대 200개를 한 번 조회하고 이후 매일 갱신합니다.
            검색 호출 한도를 사용합니다.
          </p>
        </form>
      )}
      {message && (
        <p role="status" className="trend-note">
          {message}
        </p>
      )}
    </div>
  );
}
