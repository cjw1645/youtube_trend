import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Home, { type SearchRequest } from './pages/Home';
import Dashboard, { CHART_PATH } from './pages/Dashboard';
import Favorites from './pages/Favorites';
import VideoDetail from './components/VideoDetail';
import { useFavorites } from './hooks/useFavorites';
import { useCategories } from './hooks/useCategories';
import { ErrorView } from './components/StatusView';
import { useChat } from './hooks/useChat';
import ChatPanel from './components/ChatPanel';
import { ChatVideoList } from './components/ChatResult';
import Sidebar, { type Page } from './components/Sidebar';
import { popularChartTarget, selectChatVideos, type ChatTarget } from './lib/chat-session';
import { loadShared } from './hooks/useApiResource';
import { POPULAR_CACHE_MS } from './hooks/useVideos';
import { toApiRequestError } from './lib/api';
import type { VideosResponse } from './types/video';
import InfoDisclosure from './components/InfoDisclosure';
import { useTargets } from './hooks/useTargets';
import { makeTarget } from './lib/analysis-target';
import type { StoredVideo } from './types/trend';

function currentPage(): Page {
  const hash = location.hash;
  if (hash === '#ai') return 'ai';
  if (hash === '#favorites') return 'favorites';
  // 이전 주소(#home)는 영상 검색으로 연결한다.
  if (hash === '#search' || hash === '#home') return 'search';
  return 'dashboard';
}
export default function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [visited, setVisited] = useState<ReadonlySet<Page>>(() => new Set([currentPage()]));
  const [searchRequest, setSearchRequest] = useState<SearchRequest>();
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const targets = useTargets();
  const { lastHome, setLastHome, setActive } = targets;
  const target: ChatTarget = targets.active ?? { label: '대상 미선택', videos: [] };
  const scroll = useRef<Record<Page, number>>({
    dashboard: 0,
    search: 0,
    ai: 0,
    favorites: 0,
  });
  const favorites = useFavorites();
  const [chartLoad, setChartLoad] = useState<{ loading: boolean; error?: string }>({
    loading: false,
  });
  // 대시보드와 같은 인기 차트 응답을 공유한다. 대시보드를 이미 열었다면 추가 호출이 없다.
  const applyChartTop = async () => {
    setChartLoad({ loading: true });
    try {
      const { items } = await loadShared<VideosResponse>(CHART_PATH, POPULAR_CACHE_MS);
      if (!items.length) throw new Error('인기 차트 영상이 없습니다.');
      setActive(
        makeTarget(
          popularChartTarget(items, 'YouTube 인기 차트 상위 20개', Date.now()),
          'dashboard',
        ),
      );
      setChartLoad({ loading: false });
    } catch (error) {
      setChartLoad({ loading: false, error: toApiRequestError(error).message });
    }
  };
  const chat = useChat();
  const {
    categories,
    nameById,
    resolveNames,
    state: categoryState,
    reload: reloadCategories,
  } = useCategories();
  useEffect(() => {
    resolveNames(favorites.videos.map((video) => video.categoryId));
  }, [favorites.videos, resolveNames]);
  const navigate = (next: Page) => {
    scroll.current[page] = window.scrollY;
    setVisited((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
    if (next === 'ai' && !targets.active && lastHome) setActive(lastHome);
    setPage(next);
    history.replaceState(null, '', `#${next}`);
  };
  useEffect(() => {
    const change = () => {
      const next = currentPage();
      setPage(next);
      setVisited((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useLayoutEffect(() => {
    window.scrollTo(0, scroll.current[page]);
  }, [page]);
  const receiveHome = useCallback(
    (value: ChatTarget) => setLastHome(makeTarget(value, 'home', value.query)),
    [setLastHome],
  );
  const analyze = (value: ChatTarget) => {
    navigate('ai');
    setActive(makeTarget(value, value.source ?? 'detail', value.query));
  };
  const onSelect = (video: { id: string }) => setSelectedVideoId(video.id);
  // 저장된 목록 상위 20개를 AI 대상으로 가져온다. 이미 선택한 대상이 있으면 덮어쓰지 않고 유지한다.
  const importStored = (
    stored: readonly StoredVideo[],
    label: string,
    popular: boolean,
    slot?: 1 | 2,
  ): 'set' | 'kept' => {
    if (targets.active) return 'kept';
    const items = stored
      .slice(0, 20)
      .map((video) => ({ id: video.video_id, title: video.title, popularRank: video.position }));
    const now = Date.now();
    setActive(
      makeTarget(
        popular
          ? popularChartTarget(items, label, now)
          : {
              label,
              videos: items,
              source: 'home',
              capturedAt: now,
              ...(slot ? { rankingSource: 'search' as const, searchSlot: slot } : {}),
            },
        popular ? 'dashboard' : 'home',
      ),
    );
    return 'set';
  };
  const searchKeyword = (q: string) => {
    setSearchRequest({ q, id: Date.now() });
    navigate('search');
  };
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#workspace"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('workspace')?.focus();
        }}
      >
        본문으로 이동
      </a>
      <Sidebar page={page} count={favorites.videos.length} navigate={navigate} />
      <main id="workspace" tabIndex={-1} className="workspace">
        {favorites.error && (
          <div role="alert" className="mb-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            <p>{favorites.error}</p>
            <button type="button" onClick={favorites.reload} className="mt-2 underline">
              저장 상태 다시 확인
            </button>
          </div>
        )}
        <div hidden={page !== 'dashboard'}>
          {visited.has('dashboard') && (
            <Dashboard
              categoryNames={nameById}
              resolveCategoryNames={resolveNames}
              onSelect={onSelect}
              onOpenVideo={(id) => setSelectedVideoId(id)}
              onImport={(stored) => importStored(stored, '저장된 인기 목록 상위 20개', true)}
              onImportSearch={(stored, label, slot) => importStored(stored, label, false, slot)}
              onSearchKeyword={searchKeyword}
              onAnalyze={analyze}
            />
          )}
        </div>
        <div hidden={page !== 'search'}>
          {categoryState.status === 'error' && (
            <ErrorView
              compact
              title="카테고리를 불러오지 못했습니다"
              error={categoryState.error}
              onRetry={reloadCategories}
            />
          )}
          {visited.has('search') && (
            <Home
              searchRequest={searchRequest}
              initialQuery={lastHome?.query}
              favorites={favorites}
              categories={categories}
              nameById={nameById}
              resolveCategoryNames={resolveNames}
              onSelect={onSelect}
              onResults={receiveHome}
              onAnalyze={analyze}
            />
          )}
        </div>
        <div hidden={page !== 'ai'} className="ai-workspace">
          <header className="page-heading">
            <h1>AI 대화</h1>
            <p className="target-line">
              분석 대상 {selectChatVideos(target.videos).length}개 · {target.label}
            </p>
          </header>
          <InfoDisclosure summary="분석 대상과 대화 보관 기준">
            <p>분석할 영상을 확인하고 공개 정보를 바탕으로 질문하세요.</p>
            <p>
              기본은 목록 앞쪽 최대 20개, 직접 선택은 화면 안의 1~20개, 상세는 선택한 1개입니다.
              영상·음성 자체는 분석하지 않습니다.
            </p>
            <p>
              목록을 바꿔도 전달한 대상은 유지됩니다. 전송 시 서버가 최신 공개 정보를 다시
              조회합니다.
            </p>
            {target.capturedAt && (
              <p>
                대상 목록 시점: {new Date(target.capturedAt).toLocaleString('ko-KR')} · 저장된 영상
                구성입니다. 답변의 통계는 전송 시점에 다시 조회합니다.
              </p>
            )}
            <p>
              대화는 로그인한 계정에 7일간 저장되어 다른 기기에서도 이어 볼 수 있습니다. 분석에는
              최근 3회 문답만 사용합니다.
            </p>
          </InfoDisclosure>
          <section className="target-toolbar" aria-label="분석 대상 선택">
            <span className="text-sm font-semibold">분석 대상 바꾸기</span>
            <div className="flex flex-wrap gap-2">
              <button
                className="secondary-button"
                type="button"
                disabled={!lastHome?.videos.length}
                onClick={() => setActive(lastHome)}
              >
                현재 검색 결과 사용 ({lastHome?.videos.length ?? 0})
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={chartLoad.loading}
                onClick={applyChartTop}
              >
                {chartLoad.loading ? '인기 차트 불러오는 중…' : '인기 차트 상위 20개 사용'}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!favorites.videos.length}
                onClick={() =>
                  setActive(
                    makeTarget(
                      { label: '관심 영상 · 전달 시점 기준', videos: favorites.videos },
                      'favorites',
                    ),
                  )
                }
              >
                현재 관심 영상 사용 ({Math.min(favorites.videos.length, 20)})
              </button>
              <button className="secondary-button" type="button" onClick={targets.clear}>
                대상 기록 지우기
              </button>
            </div>
          </section>
          {chartLoad.error && (
            <p role="alert" className="mb-4 text-sm text-red-700">
              인기 차트를 불러오지 못했습니다: {chartLoad.error}
            </p>
          )}
          {targets.notice && (
            <p role="status" className="mb-4 text-sm text-amber-900">
              {targets.notice}
            </p>
          )}
          {selectChatVideos(target.videos).length > 0 ? (
            <details className="target-videos">
              <summary>전송할 영상 확인 ({selectChatVideos(target.videos).length}개)</summary>
              <ChatVideoList videos={selectChatVideos(target.videos)} />
            </details>
          ) : (
            <p className="mb-4 text-sm text-amber-800">
              분석할 영상이 없습니다. 영상을 조회한 뒤 질문해 주세요.
            </p>
          )}
          <ChatPanel chat={chat} target={target} />
        </div>
        <div hidden={page !== 'favorites'}>
          <header className="page-heading">
            <h1>관심 영상</h1>
            <p>저장한 영상을 다시 살펴보고 다음 기획의 근거로 사용하세요.</p>
          </header>
          <Favorites
            favorites={favorites}
            categoryNames={nameById}
            onSelect={onSelect}
            onBrowse={() => navigate('search')}
            onAnalyze={analyze}
          />
        </div>
        {selectedVideoId && (
          <VideoDetail
            key={selectedVideoId}
            videoId={selectedVideoId}
            categoryNames={nameById}
            onClose={() => setSelectedVideoId(null)}
            favorites={favorites}
            onAnalyze={(value) => {
              setSelectedVideoId(null);
              analyze(value);
            }}
          />
        )}
      </main>
    </div>
  );
}
