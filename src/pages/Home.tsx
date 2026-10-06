import { useState } from 'react';
import FilterBar from '../components/FilterBar';
import SearchBar from '../components/SearchBar';
import { EmptyView, ErrorView, LoadingGrid } from '../components/StatusView';
import VideoCard from '../components/VideoCard';
import { useVideos, type VideoQuery } from '../hooks/useVideos';
import type { FavoritesController } from '../hooks/useFavorites';
import type { Category, Video } from '../types/video';
import ChatPanel from '../components/ChatPanel';
import type { ChatController } from '../hooks/useChat';

const INITIAL_QUERY: VideoQuery = { q: '', categoryId: '', order: '' };

interface Props {
  chat: ChatController;
  favorites: FavoritesController;
  categories: Category[];
  nameById: ReadonlyMap<string, string>;
  onSelect: (video: Video) => void;
}

export default function Home({ chat, favorites, categories, nameById, onSelect }: Props) {
  const [query, setQuery] = useState<VideoQuery>(INITIAL_QUERY);
  const { state, reload } = useVideos(query);

  const update = (patch: Partial<VideoQuery>) => setQuery((prev) => ({ ...prev, ...patch }));
  const showRank = !query.q && !query.order && state.status === 'success';

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <SearchBar value={query.q} onSearch={(q) => update({ q })} />
        <FilterBar
          categories={categories}
          categoryId={query.categoryId}
          onCategoryChange={(categoryId) => update({ categoryId })}
          order={query.order}
          onOrderChange={(order) => update({ order })}
          searching={!!query.q}
        />
      </section>

      <ChatPanel chat={chat} target={{ label: `${query.q ? `검색: ${query.q}` : '한국 인기 급상승'}${query.categoryId ? ` · ${nameById.get(query.categoryId) ?? '선택 카테고리'}` : ''}${query.order === 'viewCount' ? ' · 조회수순' : query.order === 'date' ? ' · 최신순' : ''}`, videos: state.status === 'success' ? state.videos : [] }} />

      <section aria-live="polite" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-bold text-zinc-900">
            {query.q ? (
              <>
                ‘{query.q}’ 검색 결과
                <button
                  type="button"
                  onClick={() => update({ q: '' })}
                  className="ml-2 align-middle text-sm font-normal text-zinc-500 underline hover:text-zinc-800"
                >
                  검색 해제
                </button>
              </>
            ) : (
              '한국 인기 급상승'
            )}
          </h2>
          {state.status === 'success' && state.videos.length > 0 && (
            <span className="shrink-0 text-sm text-zinc-500">{state.videos.length}개 영상</span>
          )}
        </div>

        {state.status === 'loading' && <LoadingGrid />}
        {state.status === 'error' && <ErrorView error={state.error} onRetry={reload} />}
        {state.status === 'success' && state.videos.length === 0 && (
          <EmptyView query={query.q} onReset={() => setQuery(INITIAL_QUERY)} />
        )}
        {state.status === 'success' && state.videos.length > 0 && (
          <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {state.videos.map((video, i) => (
              <VideoCard
                key={video.id}
                video={video}
                categoryName={nameById.get(video.categoryId)}
                rank={showRank ? i + 1 : undefined}
                onSelect={onSelect}
                saved={favorites.has(video.id)}
                onFavoriteToggle={() => favorites.toggle(video)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
