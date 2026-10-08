import type { ReactNode } from 'react';
import {
  BookmarkIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
} from '@radix-ui/react-icons';
import type { ApiRequestError } from '../lib/api';

/** 로딩: 카드 자리를 미리 잡아 레이아웃이 흔들리지 않게 한다 */
export function LoadingGrid({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-label="영상을 불러오는 중" className="video-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-video rounded-xl bg-zinc-200" />
          <div className="mt-3 h-4 w-11/12 rounded bg-zinc-200" />
          <div className="mt-2 h-4 w-2/3 rounded bg-zinc-200" />
          <div className="mt-2 h-3 w-1/3 rounded bg-zinc-100" />
        </div>
      ))}
    </div>
  );
}

function Panel({
  icon,
  title,
  children,
  error = false,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  error?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`flex flex-col items-center border-y border-zinc-200 px-6 ${compact ? 'py-5' : 'py-16'} text-center`}
    >
      <span aria-hidden className="status-icon">
        {icon}
      </span>
      <h2 className="mt-4 text-lg font-semibold text-zinc-900">{title}</h2>
      <div className="mt-2 max-w-md text-sm leading-relaxed text-zinc-600">{children}</div>
    </div>
  );
}

export function EmptyView({ query, onReset }: { query: string; onReset: () => void }) {
  return (
    <Panel
      icon={<MagnifyingGlassIcon />}
      title={query ? `'${query}' 검색 결과가 없습니다` : '조회한 영상이 없습니다'}
    >
      <p>다른 키워드를 입력해 보세요.</p>
      <button type="button" onClick={onReset} className="mt-4 primary-button">
        인기 영상 보기
      </button>
    </Panel>
  );
}

/** 받은 목록에는 영상이 있지만 화면 필터에 맞는 영상이 없을 때 */
export function FilteredEmptyView({
  total,
  categoryName,
  onReset,
}: {
  total: number;
  categoryName: string;
  onReset: () => void;
}) {
  return (
    <Panel icon={<MagnifyingGlassIcon />} title="조건에 맞는 영상이 없습니다">
      <p>
        이 목록 {total}개 중 {categoryName} 영상이 없습니다.
      </p>
      <button type="button" onClick={onReset} className="mt-4 primary-button">
        카테고리 해제
      </button>
    </Panel>
  );
}

export function EmptyFavoritesView({ onBrowse }: { onBrowse: () => void }) {
  return (
    <Panel icon={<BookmarkIcon />} title="아직 관심 영상이 없습니다">
      <p>영상 카드의 관심 영상 버튼을 눌러 저장해 보세요.</p>
      <button type="button" onClick={onBrowse} className="mt-4 primary-button">
        영상 둘러보기
      </button>
    </Panel>
  );
}

export function ErrorView({
  error,
  onRetry,
  title,
  compact,
}: {
  error: ApiRequestError;
  onRetry: () => void;
  title?: string;
  compact?: boolean;
}) {
  const quota = error.code === 'QUOTA_EXCEEDED';
  const missing = error.code === 'NOT_FOUND';
  return (
    <Panel
      error
      compact={compact}
      icon={quota ? <ClockIcon /> : <ExclamationTriangleIcon />}
      title={
        quota
          ? 'YouTube 조회가 제한되었습니다'
          : (title ?? (missing ? '이 영상을 찾을 수 없습니다' : '영상을 불러오지 못했습니다'))
      }
    >
      <p>{error.message}</p>
      {quota && (
        <p className="mt-2 text-xs text-zinc-500">
          잠시 후 다시 확인해 주세요. 자동으로 재시도하지 않습니다.
        </p>
      )}
      {missing && !title && (
        <p className="mt-2 text-xs text-zinc-500">
          삭제되었거나 비공개로 전환된 영상일 수 있습니다.
        </p>
      )}
      <button type="button" onClick={onRetry} className="mt-4 primary-button">
        {quota ? '다시 확인' : '다시 시도'}
      </button>
    </Panel>
  );
}

/** 대시보드처럼 카드 격자가 아닌 화면의 로딩 자리 */
export function LoadingPanel({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="dash-loading">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="animate-pulse rounded-xl bg-zinc-200" />
      ))}
    </div>
  );
}
