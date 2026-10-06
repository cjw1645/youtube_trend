import { useState } from 'react';
import FilterBar from '../components/FilterBar';
import SearchBar from '../components/SearchBar';
import { EmptyView, ErrorView, LoadingGrid } from '../components/StatusView';
import VideoCard from '../components/VideoCard';
import { useCategories } from '../hooks/useCategories';
import { useVideos, type VideoQuery } from '../hooks/useVideos';

const INITIAL_QUERY: VideoQuery = { q: '', categoryId: '', order: '' };

export default function Home() {
  const [query, setQuery] = useState<VideoQuery>(INITIAL_QUERY);
  const { categories, nameById } = useCategories();
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
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
