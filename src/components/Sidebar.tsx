import { useEffect, useRef } from 'react';
import {
  BookmarkIcon,
  ChatBubbleIcon,
  Cross2Icon,
  HamburgerMenuIcon,
  DashboardIcon,
  MagnifyingGlassIcon,
} from '@radix-ui/react-icons';

import AccountPanel from './AccountPanel';
import { useAuth } from '../hooks/useAuth';

export const PAGE_LABEL: Record<Page, string> = {
  dashboard: '대시보드',
  search: '영상 검색',
  ai: 'AI 대화',
  favorites: '관심 영상',
};

/** 본문 위쪽 줄: 현재 위치(왼쪽)와 계정(오른쪽). 로그인·로그아웃은 항상 여기 있다. */
export function TopBar({ page }: { page: Page }) {
  return (
    <div className="topbar">
      <p className="topbar-page">{PAGE_LABEL[page]}</p>
      <AccountPanel />
    </div>
  );
}

export type Page = 'dashboard' | 'search' | 'ai' | 'favorites';
const NAV: { page: Page; label: string }[] = [
  { page: 'dashboard', label: '대시보드' },
  { page: 'search', label: '영상 검색' },
  { page: 'ai', label: 'AI 대화' },
  { page: 'favorites', label: '관심 영상' },
];
export function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button className="brand" type="button" onClick={onClick} aria-label="유튜브 트렌드 대시보드">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="4" fill="currentColor" />
        <path d="M8 22V16M15 22V10M22 22V7" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span>
        유튜브 트렌드<span className="brand-caption">공개 영상 · AI 분석</span>
      </span>
    </button>
  );
}
function Navigation({
  page,
  count,
  navigate,
}: {
  page: Page;
  count: number;
  navigate: (page: Page) => void;
}) {
  return (
    <nav aria-label="화면 전환" className="app-nav">
      {NAV.map(({ page: item, label }) => (
        <button
          key={item}
          type="button"
          aria-current={page === item ? 'page' : undefined}
          onClick={() => navigate(item)}
        >
          <span className="nav-symbol" aria-hidden="true">
            {item === 'dashboard' ? (
              <DashboardIcon />
            ) : item === 'search' ? (
              <MagnifyingGlassIcon />
            ) : item === 'ai' ? (
              <ChatBubbleIcon />
            ) : (
              <BookmarkIcon />
            )}
          </span>
          {label}
          {item === 'favorites' && <span className="nav-count">{count}</span>}
        </button>
      ))}
    </nav>
  );
}
export default function Sidebar({
  page,
  count,
  navigate,
}: {
  page: Page;
  count: number;
  navigate: (page: Page) => void;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const close = () => drawer.current?.close();
  useEffect(() => {
    const wide = matchMedia('(min-width: 1024px)');
    const onResize = () => {
      if (wide.matches) close();
    };
    wide.addEventListener('change', onResize);
    return () => {
      wide.removeEventListener('change', onResize);
      document.body.style.overflow = '';
    };
  }, []);
  const auth = useAuth();
  const info = (
    <>
      <p className="sidebar-info">
        공개 메타데이터로 영상을 탐색하고 기획에 활용하세요.
        <br />
        <br />
        {auth.user
          ? '관심 영상은 로그인한 계정에 저장됩니다.'
          : '관심 영상은 로그인하지 않으면 이 브라우저에 저장됩니다.'}
      </p>
    </>
  );
  return (
    <>
      <aside className="sidebar">
        <Logo onClick={() => navigate('dashboard')} />
        <Navigation page={page} count={count} navigate={navigate} />
        {info}
      </aside>
      <header className="mobile-header">
        <Logo onClick={() => navigate('dashboard')} />
        <div className="mobile-header-actions">
          <AccountPanel />
          <button
            ref={menu}
            className="icon-button"
            type="button"
            aria-label="메뉴 열기"
            aria-haspopup="dialog"
            onClick={() => {
              drawer.current?.showModal();
              document.body.style.overflow = 'hidden';
            }}
          >
            <HamburgerMenuIcon aria-hidden="true" />
          </button>
        </div>
      </header>
      <dialog
        ref={drawer}
        className="nav-drawer"
        aria-label="화면 메뉴"
        onClose={() => {
          document.body.style.overflow = '';
          if (menu.current?.getClientRects().length) menu.current.focus();
          else
            document
              .querySelector<HTMLButtonElement>('.sidebar nav button[aria-current="page"]')
              ?.focus();
        }}
        onClick={(event) => {
          if (event.target === drawer.current) {
            const bounds = drawer.current.getBoundingClientRect();
            if (event.clientX > bounds.right) close();
          }
        }}
      >
        <div className="drawer-header">
          <Logo
            onClick={() => {
              close();
              navigate('dashboard');
            }}
          />
          <button
            className="icon-button"
            autoFocus
            type="button"
            aria-label="메뉴 닫기"
            onClick={close}
          >
            <Cross2Icon aria-hidden="true" />
          </button>
        </div>
        <Navigation
          page={page}
          count={count}
          navigate={(next) => {
            close();
            navigate(next);
          }}
        />
        {info}
      </dialog>
    </>
  );
}
