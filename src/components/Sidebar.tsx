import { useEffect, useRef } from 'react';
import {
  BookmarkIcon,
  ChatBubbleIcon,
  Cross2Icon,
  HamburgerMenuIcon,
  HomeIcon,
} from '@radix-ui/react-icons';

export type Page = 'home' | 'ai' | 'favorites';
export function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button className="brand" type="button" onClick={onClick} aria-label="유튜브 트렌드 홈">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="currentColor" />
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
      {(['home', 'ai', 'favorites'] as const).map((item, index) => (
        <button
          key={item}
          type="button"
          aria-current={page === item ? 'page' : undefined}
          onClick={() => navigate(item)}
        >
          <span className="nav-symbol" aria-hidden="true">
            {item === 'home' ? <HomeIcon /> : item === 'ai' ? <ChatBubbleIcon /> : <BookmarkIcon />}
          </span>
          {['홈', 'AI 대화', '관심 영상'][index]}
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
  const info = (
    <p className="sidebar-info">
      공개 메타데이터로 영상을 탐색하고 기획에 활용하세요.
      <br />
      <br />
      관심 영상은 이 브라우저에 저장됩니다.
    </p>
  );
  return (
    <>
      <aside className="sidebar">
        <Logo onClick={() => navigate('home')} />
        <Navigation page={page} count={count} navigate={navigate} />
        {info}
      </aside>
      <header className="mobile-header">
        <Logo onClick={() => navigate('home')} />
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
              navigate('home');
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
