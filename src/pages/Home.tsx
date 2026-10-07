import { useEffect, useState } from 'react';
import FilterBar from '../components/FilterBar';
import SearchBar from '../components/SearchBar';
import { EmptyView, ErrorView, LoadingGrid } from '../components/StatusView';
import VideoCard from '../components/VideoCard';
import { useVideos, type VideoQuery } from '../hooks/useVideos';
import type { FavoritesController } from '../hooks/useFavorites';
import type { Category, Video } from '../types/video';
import { selectChatVideos, type ChatTarget } from '../lib/chat-session';
import { useAnalysisSelection } from '../hooks/useAnalysisSelection';
import AnalysisSelectionBar from '../components/AnalysisSelectionBar';
import InfoDisclosure from '../components/InfoDisclosure';
import KeywordChips from '../components/KeywordChips';

const INITIAL_QUERY: VideoQuery = { q: '', categoryId: '', order: '' };
const EMPTY: Video[] = [];

interface Props {
  onResults: (target: ChatTarget) => void;
  onAnalyze: (target: ChatTarget) => void;
  initialQuery?: VideoQuery;
  favorites: FavoritesController;
  categories: Category[];
  nameById: ReadonlyMap<string, string>;
  onSelect: (video: Video) => void;
  resolveCategoryNames: (ids: readonly string[]) => void;
}

export default function Home({
  onResults,
  onAnalyze,
  favorites,
  categories,
  nameById,
  onSelect,
  initialQuery,
  resolveCategoryNames,
}: Props) {
  const [query, setQuery] = useState<VideoQuery>(initialQuery ?? INITIAL_QUERY);
  const [draft, setDraft] = useState<VideoQuery>(initialQuery ?? INITIAL_QUERY);
  const { state, reload } = useVideos(query);

  const update = (patch: Partial<VideoQuery>) => setDraft((prev) => ({ ...prev, ...patch }));
  const run = (next: VideoQuery) => {
    setDraft(next);
    if (JSON.stringify(query) === JSON.stringify(next)) reload();
    else setQuery(next);
  };
  const apply = () => run({ ...draft, q: draft.q.trim() });
  const searchKeyword = (keyword: string) =>
    run({ ...query, q: Array.from(keyword).slice(0, 100).join('').trim() });
  const reset = () => {
    setDraft(INITIAL_QUERY);
    if (JSON.stringify(query) === JSON.stringify(INITIAL_QUERY)) reload();
    else setQuery(INITIAL_QUERY);
  };
  const label = `${query.q ? `검색: ${query.q}` : query.categoryId ? '카테고리 검색' : 'YouTube API 인기 목록'}${query.categoryId ? ` · ${nameById.get(query.categoryId) ?? '선택 카테고리'}` : ''} · ${query.order === 'viewCount' ? '조회수순' : query.order === 'date' ? '최신순' : '인기순'}`;
  const videos = state.status === 'success' ? state.videos : undefined;
  const fetchedAt = state.status === 'success' ? state.fetchedAt : undefined;
  const selection = useAnalysisSelection(videos ?? EMPTY, JSON.stringify(query));
  const analysisVideos = selection.enabled ? selection.selected : (videos ?? EMPTY);
  useEffect(() => {
    if (videos) resolveCategoryNames(videos.map((video) => video.categoryId));
  }, [videos, resolveCategoryNames]);
  useEffect(() => {
    if (videos)
      onResults({
        label,
        videos: selectChatVideos(videos),
        source: 'home',
        query,
        capturedAt: fetchedAt,
      });
  }, [videos, label, query, onResults, fetchedAt]);

  return (
    <div className="home-page flex flex-col gap-6">
      <header className="page-heading">
        <h1>지금 트렌드</h1>
        <p>관심 있는 영상을 찾고, 다음 콘텐츠의 방향을 살펴보세요.</p>
      </header>
      <section className="discovery-controls" aria-label="영상 검색과 필터">
        <SearchBar value={draft.q} onChange={(q) => update({ q })} onSearch={apply} />
        <FilterBar
          categories={categories}
          categoryId={draft.categoryId}
          onCategoryChange={(categoryId) => update({ categoryId })}
          order={draft.order}
          onOrderChange={(order) => update({ order })}
          onApply={apply}
          onReset={reset}
        />
        <div className="applied-query">
          <div className="applied-query-text">
            <p className="text-sm text-zinc-600">
              적용 조건: {label}
              {JSON.stringify(draft) !== JSON.stringify(query) && (
                <span className="ml-2 font-semibold text-red-700">
                  변경한 조건은 아직 적용되지 않았습니다.
                </span>
              )}
            </p>
            <InfoDisclosure summary="목록 기준 안내">
              <p>
                {query.q || query.categoryId
                  ? `한국에서 시청 가능한 검색 결과${query.order ? '' : '(API 관련도순)'}입니다. 한국 채널·한국어 영상만을 보장하지 않습니다.`
                  : query.order
                    ? '조회한 인기 목록 안에서 정렬합니다. 전체 YouTube 순위가 아닙니다.'
                    : 'YouTube API가 제공한 인기 목록을 응답 순서대로 보여줍니다. 전체 YouTube 인기 순위를 뜻하지 않습니다.'}
              </p>
            </InfoDisclosure>
          </div>
          <button
            className="primary-button analyze-action"
            type="button"
            disabled={!analysisVideos.length}
            onClick={() =>
              onAnalyze({
                label: label + (selection.enabled ? ' · 직접 선택' : ''),
                videos: analysisVideos,
                source: 'home',
                query,
                capturedAt: fetchedAt,
              })
            }
          >
            {selection.enabled
              ? `선택 ${analysisVideos.length}개로 AI 질문`
              : '이 목록으로 AI 질문'}
          </button>
        </div>
      </section>

      <AnalysisSelectionBar selection={selection} available={videos?.length ?? 0} />

      <section aria-live="polite" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-bold text-zinc-900">
            {query.q ? (
              <>
                ‘{query.q}’ 검색 결과
                <button
                  type="button"
                  onClick={reset}
                  className="ml-2 align-middle text-sm font-normal text-zinc-500 underline hover:text-zinc-800"
                >
                  검색 해제
                </button>
              </>
            ) : query.categoryId ? (
              '카테고리 검색 결과'
            ) : (
              '인기 영상'
            )}
          </h2>
          {state.status === 'success' && state.videos.length > 0 && (
            <span className="shrink-0 text-sm text-zinc-500">{state.videos.length}개 영상</span>
          )}
        </div>

        {state.status === 'success' && state.videos.length > 0 && (
          <KeywordChips videos={state.videos} query={query.q} onSearch={searchKeyword} />
        )}
        {state.status === 'loading' && <LoadingGrid />}
        {state.status === 'error' && (
          <ErrorView title="영상 목록을 불러오지 못했습니다" error={state.error} onRetry={reload} />
        )}
        {state.status === 'success' && state.videos.length === 0 && (
          <EmptyView query={query.q} onReset={reset} />
        )}
        {state.status === 'success' && state.videos.length > 0 && (
          <div className="video-grid">
            {state.videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                categoryName={nameById.get(video.categoryId)}
                onSelect={onSelect}
                saved={favorites.has(video.id)}
                onFavoriteToggle={() => favorites.toggle(video)}
                analysisSelection={
                  selection.enabled
                    ? {
                        selected: selection.ids.includes(video.id),
                        toggle: () => selection.toggle(video.id),
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
