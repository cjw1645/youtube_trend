import { useEffect, useMemo, useRef, useState } from 'react';
import FilterBar from '../components/FilterBar';
import SearchBar from '../components/SearchBar';
import { EmptyView, ErrorView, FilteredEmptyView, LoadingGrid } from '../components/StatusView';
import VideoCard from '../components/VideoCard';
import { useVideos, type VideoQuery } from '../hooks/useVideos';
import { useAuth } from '../hooks/useAuth';
import type { FavoritesController } from '../hooks/useFavorites';
import type { Video } from '../types/video';
import { listRanking, selectChatVideos, type ChatTarget } from '../lib/chat-session';
import { applyLocalFilter } from '../lib/local-filter';
import { categoryDistribution } from '../lib/stats';
import { useAnalysisSelection } from '../hooks/useAnalysisSelection';
import AnalysisSelectionBar from '../components/AnalysisSelectionBar';
import InfoDisclosure from '../components/InfoDisclosure';
import KeywordChips from '../components/KeywordChips';

const INITIAL_QUERY: VideoQuery = { q: '', categoryId: '', order: '' };
const EMPTY: Video[] = [];
/** 로그아웃 상태에서 검색을 시도하면 검색어를 저장해 두었다가, 로그인 복귀 후 바로 검색한다. */
export const SEARCH_AFTER_LOGIN_KEY = 'youtube-trend:search-after-login';
/** 로그인 전 검색창 아래에 흐리게 보여 주는 인기 영상 수 */
const LOCKED_PREVIEW = 8;

/** 대시보드 키워드 클릭처럼 다른 화면에서 요청한 검색. id가 바뀔 때마다 한 번 실행한다. */
export interface SearchRequest {
  q: string;
  id: number;
}

interface Props {
  searchRequest?: SearchRequest;
  onResults: (target: ChatTarget) => void;
  onAnalyze: (target: ChatTarget) => void;
  initialQuery?: VideoQuery;
  favorites: FavoritesController;
  nameById: ReadonlyMap<string, string>;
  onSelect: (video: Video) => void;
  resolveCategoryNames: (ids: readonly string[]) => void;
}

function readPendingSearch(): string {
  try {
    return sessionStorage.getItem(SEARCH_AFTER_LOGIN_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function Home({
  onResults,
  onAnalyze,
  favorites,
  nameById,
  onSelect,
  initialQuery,
  resolveCategoryNames,
  searchRequest,
}: Props) {
  const auth = useAuth();
  const signedIn = !!auth.user;
  // 처음 열 때 외부 검색 요청이 있으면 기본 목록을 거치지 않고 바로 그 검색으로 시작한다.
  const [start] = useState<VideoQuery>(() =>
    searchRequest ? { ...INITIAL_QUERY, q: searchRequest.q } : (initialQuery ?? INITIAL_QUERY),
  );
  // q: 적용된 검색어(서버 조회), categoryId·order: 받은 목록 안에서 즉시 적용하는 화면 필터
  const [q, setQ] = useState(signedIn ? start.q : '');
  const [categoryId, setCategoryId] = useState(start.categoryId);
  const [order, setOrder] = useState(start.order);
  const [draft, setDraft] = useState(start.q);
  const appliedRequest = useRef(searchRequest?.id);
  const { state, reload } = useVideos(signedIn ? q : '', auth.getToken);

  const search = (value: string) => {
    const next = Array.from(value.trim()).slice(0, 100).join('');
    setDraft(next);
    if (!signedIn) {
      if (next) {
        try {
          sessionStorage.setItem(SEARCH_AFTER_LOGIN_KEY, next);
        } catch {
          /* 저장소를 못 쓰면 로그인 뒤에 다시 입력한다 */
        }
        void auth.signIn();
      }
      return;
    }
    setCategoryId('');
    setOrder('');
    if (next === q) reload();
    else setQ(next);
  };
  const clearSearch = () => {
    setDraft('');
    setCategoryId('');
    setOrder('');
    if (q) setQ('');
    else reload();
  };
  // 로그인 복귀 후 저장해 둔 검색어를 한 번 실행한다.
  useEffect(() => {
    if (!signedIn) return;
    const pending = readPendingSearch();
    if (!pending) return;
    try {
      sessionStorage.removeItem(SEARCH_AFTER_LOGIN_KEY);
    } catch {
      /* 무시 */
    }
    setDraft(pending);
    setQ(pending);
  }, [signedIn]);
  useEffect(() => {
    if (!searchRequest || appliedRequest.current === searchRequest.id) return;
    appliedRequest.current = searchRequest.id;
    setCategoryId('');
    setOrder('');
    setDraft(searchRequest.q);
    // 로그아웃 상태에서는 검색어만 채워 두고, 사용자가 검색을 눌러 로그인하게 한다.
    if (signedIn) setQ(searchRequest.q);
  }, [searchRequest, signedIn]);

  const raw = state.status === 'success' ? state.videos : undefined;
  const fetchedAt = state.status === 'success' ? state.fetchedAt : undefined;
  const categoryOptions = useMemo(
    () =>
      categoryDistribution(raw ?? EMPTY, (video) => video.categoryId).map(({ key, count }) => ({
        id: key,
        label: nameById.get(key) ?? '카테고리 정보 없음',
        count,
      })),
    [raw, nameById],
  );
  // 목록이 바뀌어 사라진 카테고리가 선택돼 있으면 전체로 본다.
  const activeCategory = categoryOptions.some((option) => option.id === categoryId)
    ? categoryId
    : '';
  const videos = useMemo(
    () => (raw ? applyLocalFilter(raw, activeCategory, order) : undefined),
    [raw, activeCategory, order],
  );
  const query: VideoQuery = { q, categoryId: activeCategory, order };
  const categoryName = activeCategory
    ? (nameById.get(activeCategory) ?? '선택 카테고리')
    : undefined;
  const label = `${q ? `검색: ${q}` : '인기 차트 200개'}${categoryName ? ` · ${categoryName}` : ''} · ${order === 'viewCount' ? '조회수순' : order === 'date' ? '최신순' : q ? '관련도순' : '인기순'}`;
  const selection = useAnalysisSelection(videos ?? EMPTY, JSON.stringify(query));
  const analysisVideos = selection.enabled ? selection.selected : (videos ?? EMPTY);
  // 인기 차트를 다시 정렬했어도 영상에 남은 popularRank를 쓴다. 검색 결과는 순위 기준이 아니다.
  const ranking = useMemo(() => listRanking(videos ?? EMPTY, !q, !order), [videos, q, order]);
  useEffect(() => {
    if (raw) resolveCategoryNames(raw.map((video) => video.categoryId));
  }, [raw, resolveCategoryNames]);
  useEffect(() => {
    if (signedIn && videos)
      onResults({
        label,
        videos: selectChatVideos(videos),
        source: 'home',
        query: { q, categoryId: activeCategory, order },
        capturedAt: fetchedAt,
        ...ranking,
      });
  }, [signedIn, videos, label, q, activeCategory, order, onResults, fetchedAt, ranking]);

  const locked = !signedIn;
  const listTitle = q ? `‘${q}’ 검색 결과` : '인기 영상';

  return (
    <div className="home-page flex flex-col gap-6">
      <header className="page-heading">
        <h1>영상 검색</h1>
        <p>키워드로 영상을 찾고, 카테고리·정렬로 바로 좁혀 다음 콘텐츠의 방향을 살펴보세요.</p>
      </header>
      <section className="discovery-controls" aria-label="영상 검색">
        <SearchBar value={draft} onChange={setDraft} onSearch={() => search(draft)} />
        {!locked && (
          <div className="applied-query">
            <div className="applied-query-text">
              <p className="text-sm text-zinc-600">현재 목록: {label}</p>
              <InfoDisclosure summary="목록 기준 안내">
                <p>
                  {q
                    ? '한국에서 시청 가능한 검색 결과 50개(API 관련도순)입니다. 카테고리·정렬은 이 50개 안에서만 적용하며 한국 채널·한국어 영상만을 보장하지 않습니다.'
                    : 'YouTube 인기 차트를 응답 순서대로 200개까지 보여줍니다. 카테고리·정렬은 이 목록 안에서만 적용하며 전체 YouTube 인기 순위를 뜻하지 않습니다.'}
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
                  ...(selection.enabled ? { rankingSource: 'selection' } : ranking),
                })
              }
            >
              {selection.enabled
                ? `선택 ${analysisVideos.length}개로 AI 질문`
                : '상위 20개로 AI 질문'}
            </button>
          </div>
        )}
      </section>

      {locked ? (
        <LockedPreview
          loading={auth.loading}
          enabled={auth.enabled}
          videos={raw?.slice(0, LOCKED_PREVIEW)}
          nameById={nameById}
          onSignIn={() => void auth.signIn()}
        />
      ) : (
        <>
          <AnalysisSelectionBar selection={selection} available={videos?.length ?? 0} />

          <section aria-live="polite" className="flex flex-col gap-4">
            <div className="list-heading">
              <h2 className="text-lg font-bold text-zinc-900">
                {listTitle}
                {q && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="ml-2 align-middle text-sm font-normal text-zinc-500 underline hover:text-zinc-800"
                  >
                    검색 해제
                  </button>
                )}
                {videos && videos.length > 0 && (
                  <span className="ml-3 text-sm font-normal text-zinc-500">
                    {videos.length}개 영상
                  </span>
                )}
              </h2>
              {raw && raw.length > 0 && (
                <FilterBar
                  categories={categoryOptions}
                  categoryId={activeCategory}
                  onCategoryChange={setCategoryId}
                  order={order}
                  onOrderChange={setOrder}
                  defaultOrderLabel={q ? '관련도순' : '인기순'}
                />
              )}
            </div>

            {videos && videos.length > 0 && (
              <KeywordChips videos={videos} query={q} onSearch={search} />
            )}
            {state.status === 'loading' && <LoadingGrid />}
            {state.status === 'error' && (
              <ErrorView
                title="영상 목록을 불러오지 못했습니다"
                error={state.error}
                onRetry={reload}
              />
            )}
            {raw && raw.length === 0 && <EmptyView query={q} onReset={clearSearch} />}
            {raw && raw.length > 0 && videos?.length === 0 && (
              <FilteredEmptyView
                total={raw.length}
                categoryName={categoryName ?? '선택한 카테고리'}
                onReset={() => setCategoryId('')}
              />
            )}
            {videos && videos.length > 0 && (
              <div className="video-grid">
                {videos.map((video) => (
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
        </>
      )}
    </div>
  );
}

/** 로그아웃 상태: 인기 영상 몇 개를 흐리게 보여 주고 그 위에 로그인 안내를 겹친다. */
function LockedPreview({
  loading,
  enabled,
  videos,
  nameById,
  onSignIn,
}: {
  loading: boolean;
  enabled: boolean;
  videos: readonly Video[] | undefined;
  nameById: ReadonlyMap<string, string>;
  onSignIn: () => void;
}) {
  if (loading) return <LoadingGrid count={LOCKED_PREVIEW} />;
  return (
    <section className="search-locked" aria-label="로그인 안내">
      <div className="search-locked-preview" aria-hidden="true" inert>
        <div className="video-grid">
          {(videos ?? []).map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              categoryName={nameById.get(video.categoryId)}
              onSelect={() => undefined}
              saved={false}
              onFavoriteToggle={() => undefined}
            />
          ))}
        </div>
      </div>
      <div className="search-locked-cta">
        <h2>검색하려면 로그인하세요</h2>
        <p>키워드 검색은 YouTube 검색 할당량을 사용해 로그인한 사용자만 쓸 수 있습니다.</p>
        {enabled ? (
          <button type="button" className="login-button" onClick={onSignIn}>
            Google로 로그인
          </button>
        ) : (
          <p className="text-sm text-zinc-500">로그인 기능이 설정되지 않았습니다.</p>
        )}
      </div>
    </section>
  );
}
