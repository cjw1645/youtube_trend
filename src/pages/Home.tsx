import { useEffect, useState } from 'react';
import FilterBar from '../components/FilterBar';
import SearchBar from '../components/SearchBar';
import { EmptyView, ErrorView, LoadingGrid } from '../components/StatusView';
import VideoCard from '../components/VideoCard';
import { useVideos, type VideoQuery } from '../hooks/useVideos';
import type { FavoritesController } from '../hooks/useFavorites';
import type { Category, Video } from '../types/video';
import { selectChatVideos, type ChatTarget } from '../lib/chat-session';
import {useAnalysisSelection} from '../hooks/useAnalysisSelection';
import AnalysisSelectionBar from '../components/AnalysisSelectionBar';

const INITIAL_QUERY: VideoQuery = { q: '', categoryId: '', order: '' };
const EMPTY:Video[]=[];

interface Props {
  onResults: (target: ChatTarget) => void;
  onAnalyze: (target: ChatTarget) => void;
  initialQuery?: VideoQuery;
  favorites: FavoritesController;
  categories: Category[];
  nameById: ReadonlyMap<string, string>;
  onSelect: (video: Video) => void;
}

export default function Home({ onResults, onAnalyze, favorites, categories, nameById, onSelect, initialQuery }: Props) {
  const [query, setQuery] = useState<VideoQuery>(initialQuery ?? INITIAL_QUERY);
  const [draft, setDraft] = useState<VideoQuery>(initialQuery ?? INITIAL_QUERY);
  const { state, reload } = useVideos(query);

  const update = (patch: Partial<VideoQuery>) => setDraft((prev) => ({ ...prev, ...patch }));
  const apply = () => { const next = { ...draft, q: draft.q.trim() }; setDraft(next); if (JSON.stringify(query) === JSON.stringify(next)) reload(); else setQuery(next); };
  const reset = () => { setDraft(INITIAL_QUERY); setQuery(INITIAL_QUERY); };
  const label = `${query.q ? `검색: ${query.q}` : query.categoryId ? '카테고리 검색' : 'YouTube API 인기 목록'}${query.categoryId ? ` · ${nameById.get(query.categoryId) ?? '선택 카테고리'}` : ''} · ${query.order === 'viewCount' || (!query.q && query.categoryId && !query.order) ? '조회수순' : query.order === 'date' ? '최신순' : query.q ? '관련도순' : 'API 제공 순서'}`;
  const videos = state.status === 'success' ? state.videos : undefined;
  const fetchedAt=state.status==='success'?state.fetchedAt:undefined;
  const selection=useAnalysisSelection(videos??EMPTY,JSON.stringify(query));
  const analysisVideos=selection.enabled?selection.selected:videos??EMPTY;
  useEffect(() => { if (videos) onResults({ label, videos: selectChatVideos(videos), source: 'home', query,capturedAt:fetchedAt }); }, [videos, label, query, onResults,fetchedAt]);

  return (
    <div className="flex flex-col gap-6">
      <header className="page-heading"><p className="eyebrow">영상 탐색</p><h1>홈</h1><p>관심 있는 영상을 찾고, 다음 콘텐츠의 방향을 살펴보세요.</p></header>
      <section className="flex flex-col gap-4">
        <SearchBar value={draft.q} onChange={(q) => update({ q })} onSearch={apply} />
        <FilterBar
          categories={categories}
          categoryId={draft.categoryId}
          onCategoryChange={(categoryId) => update({ categoryId })}
          order={draft.order}
          onOrderChange={(order) => update({ order })}
          searching={!!draft.q.trim()}
          onApply={apply}
          onReset={reset}
        />
      </section>
      <p className="text-sm text-zinc-600">적용 조건: {label}{JSON.stringify(draft) !== JSON.stringify(query) && <span className="ml-2 font-semibold text-red-700">변경한 조건은 아직 적용되지 않았습니다.</span>}</p>

      <div className="result-actions"><p>{query.q || query.categoryId ? '한국에서 시청 가능한 검색 결과입니다. 한국 채널·한국어 영상만을 보장하지 않습니다.' : query.order ? '조회한 인기 목록 안에서 정렬합니다. 전체 YouTube 순위가 아닙니다.' : 'YouTube API 제공 목록입니다. 전체 YouTube의 인기 순위를 보장하지 않습니다.'}</p><button className="primary-button" type="button" disabled={!analysisVideos.length} onClick={() => onAnalyze({ label:label+(selection.enabled?' · 직접 선택':''), videos: analysisVideos, source: 'home', query,capturedAt:fetchedAt })}>{selection.enabled?`선택 ${analysisVideos.length}개로 AI 질문`:'이 목록으로 AI 질문'}</button></div>
      <AnalysisSelectionBar selection={selection} available={videos?.length??0}/>

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
            ) : (
              query.categoryId ? '카테고리 검색 결과' : '인기 영상'
            )}
          </h2>
          {state.status === 'success' && state.videos.length > 0 && (
            <span className="shrink-0 text-sm text-zinc-500">{state.videos.length}개 영상</span>
          )}
        </div>

        {state.status === 'loading' && <LoadingGrid />}
        {state.status === 'error' && <ErrorView title="영상 목록을 불러오지 못했습니다" error={state.error} onRetry={reload} />}
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
                analysisSelection={selection.enabled?{selected:selection.ids.includes(video.id),toggle:()=>selection.toggle(video.id)}:undefined}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
