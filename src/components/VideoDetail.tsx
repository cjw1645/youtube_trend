import { useEffect, useRef } from 'react';
import { useApiResource } from '../hooks/useApiResource';
import { formatDate, formatDuration } from '../lib/format';
import type { VideoDetail as VideoDetailData } from '../types/video';
import { ErrorView } from './StatusView';
import FavoriteButton from './FavoriteButton';
import type { FavoritesController } from '../hooks/useFavorites';

interface Props {
  videoId: string;
  categoryNames: ReadonlyMap<string, string>;
  onClose: () => void;
  favorites: FavoritesController;
}

export function formatDetailCount(value: number | null): string {
  return value === null ? '정보 없음' : value.toLocaleString('ko-KR');
}

export default function VideoDetail({ videoId, categoryNames, onClose, favorites }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const { state, reload } = useApiResource<VideoDetailData>(`/api/video/${encodeURIComponent(videoId)}`);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    closeButton.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      else document.querySelector<HTMLButtonElement>('nav[aria-label="화면 전환"] button[aria-current="page"]')?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="video-detail-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl border-0 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/60"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4">
        <h2 id="video-detail-title" className="font-bold">영상 상세</h2>
        <div className="ml-auto flex items-center gap-2">
          <FavoriteButton
            saved={favorites.has(videoId)}
            title={state.status === 'success' ? state.data.title : '선택한 영상'}
            disabled={!favorites.has(videoId) && state.status !== 'success'}
            onClick={() => {
              if (favorites.has(videoId)) favorites.remove(videoId);
              else if (state.status === 'success') favorites.toggle(state.data);
            }}
          />
        <button ref={closeButton} autoFocus type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-red-600">
          닫기
        </button>
        </div>
      </header>
      <div className="p-5 sm:p-6" aria-live="polite">
        {favorites.error && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{favorites.error}</p>}
        {state.status === 'loading' && (
          <div role="status" className="py-16 text-center text-zinc-500">영상 상세를 불러오는 중…</div>
        )}
        {state.status === 'error' && (
          <ErrorView error={state.error} onRetry={reload} />
        )}
        {state.status === 'success' && (
          <DetailContent video={state.data} categoryName={categoryNames.get(state.data.categoryId)} />
        )}
      </div>
    </dialog>
  );
}

function DetailContent({ video, categoryName }: { video: VideoDetailData; categoryName?: string }) {
  const statistics = [
    ['조회수', video.viewCount],
    ['좋아요', video.likeCount],
    ['댓글 수', video.commentCount],
    ['채널 구독자 수', video.subscriberCount],
  ] as const;

  return (
    <article className="flex flex-col gap-5">
      <img src={video.thumbnailUrl} alt={`${video.title} 썸네일`} className="aspect-video w-full rounded-xl bg-zinc-100 object-cover" />
      <div>
        <h3 className="text-xl font-bold leading-snug">{video.title}</h3>
        <p className="mt-2 text-sm font-medium text-zinc-700">{video.channelTitle}</p>
        <p className="mt-1 text-sm text-zinc-500">
          업로드 <time dateTime={video.publishedAt}>{formatDate(video.publishedAt)}</time>
          {categoryName && ` · ${categoryName}`}
          {video.durationSeconds > 0 && ` · ${formatDuration(video.durationSeconds)}`}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statistics.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-zinc-50 p-3">
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="mt-1 break-words text-lg font-semibold">{formatDetailCount(value)}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h4 className="mb-2 text-sm font-bold">설명</h4>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-700">{video.description || '등록된 설명이 없습니다.'}</p>
      </section>
      <section>
        <h4 className="mb-2 text-sm font-bold">태그</h4>
        {video.tags.length ? (
          <ul className="flex flex-wrap gap-2">
            {video.tags.map((tag, index) => (
              <li key={`${index}-${tag}`} className="max-w-full break-words rounded-lg bg-zinc-100 px-2 py-1 text-xs text-zinc-600">#{tag}</li>
            ))}
          </ul>
        ) : <p className="text-sm text-zinc-500">등록된 태그가 없습니다.</p>}
      </section>
      <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" className="w-fit rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
        YouTube에서 보기 ↗
      </a>
    </article>
  );
}
