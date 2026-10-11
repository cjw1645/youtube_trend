import { useEffect, useRef } from 'react';
import {
  BookmarkIcon,
  ChatBubbleIcon,
  Cross2Icon,
  HamburgerMenuIcon,
  DashboardIcon,
  HomeIcon,
  MagnifyingGlassIcon,
} from '@radix-ui/react-icons';

import AccountPanel from './AccountPanel';
import UsageBadge from './UsageBadge';

export type Page = 'main' | 'dashboard' | 'search' | 'ai' | 'favorites';
const NAV: { page: Page; label: string }[] = [
  { page: 'main', label: '홈' },
  { page: 'dashboard', label: '대시보드' },
  { page: 'search', label: '영상 검색' },
  { page: 'ai', label: 'AI 대화' },
  { page: 'favorites', label: '관심 영상' },
];
/** 누르면 페이지를 새로 불러와 메인 맨 위로 간다. */
export function Logo() {
  return (
    <a className="brand" href="/" aria-label="유튜브 트렌드 메인으로 새로고침">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="4" fill="currentColor" />
        <path d="M8 22V16M15 22V10M22 22V7" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span>
        유튜브 트렌드<span className="brand-caption">공개 영상 · AI 분석</span>
      </span>
    </a>
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
            {item === 'main' ? (
              <HomeIcon />
            ) : item === 'dashboard' ? (
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
  return (
    <>
      <aside className="sidebar">
        <Logo />
        <Navigation page={page} count={count} navigate={navigate} />
        {/* 계정과 오늘 남은 횟수는 메뉴 아래에 모은다. */}
        <div className="sidebar-account">
          <UsageBadge />
          <AccountPanel />
        </div>
      </aside>
      <header className="mobile-header">
        <Logo />
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
          <Logo />
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
      </dialog>
    </>
  );
}
