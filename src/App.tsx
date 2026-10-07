import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Home from './pages/Home';
import Favorites from './pages/Favorites';
import VideoDetail from './components/VideoDetail';
import { useFavorites } from './hooks/useFavorites';
import { useCategories } from './hooks/useCategories';
import { ErrorView } from './components/StatusView';
import { useChat } from './hooks/useChat';
import ChatPanel from './components/ChatPanel';
import Sidebar, { type Page } from './components/Sidebar';
import { selectChatVideos, type ChatTarget } from './lib/chat-session';
import InfoDisclosure from './components/InfoDisclosure';
import { useTargets } from './hooks/useTargets';
import { makeTarget } from './lib/analysis-target';

function currentPage(): Page {
  return location.hash === '#ai' ? 'ai' : location.hash === '#favorites' ? 'favorites' : 'home';
}
export default function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [homeVisited, setHomeVisited] = useState(() => currentPage() === 'home');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const targets = useTargets();
  const { lastHome, setLastHome, setActive } = targets;
  const target: ChatTarget = targets.active ?? { label: '대상 미선택', videos: [] };
  const scroll = useRef<Record<Page, number>>({ home: 0, ai: 0, favorites: 0 });
  const favorites = useFavorites();
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
    if (next === 'home') setHomeVisited(true);
    if (next === 'ai' && !targets.active && lastHome) setActive(lastHome);
    setPage(next);
    history.replaceState(null, '', `#${next}`);
  };
  useEffect(() => {
    const change = () => {
      setPage(currentPage());
      if (currentPage() === 'home') setHomeVisited(true);
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
        <div hidden={page !== 'home'}>
          {categoryState.status === 'error' && (
            <ErrorView
              compact
              title="카테고리를 불러오지 못했습니다"
              error={categoryState.error}
              onRetry={reloadCategories}
            />
          )}
          {homeVisited && (
            <Home
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
              이 탭에 초안과 완료 대화를 최대 24시간 보관합니다. 최근 10건까지 복원하며 대화 이력은
              AI에 보내지 않습니다. 탭을 닫아도 브라우저 세션 복원 설정에 따라 남을 수 있습니다.
            </p>
          </InfoDisclosure>
          <section className="target-toolbar" aria-label="분석 대상 선택">
            <span className="text-sm font-semibold">대상 가져오기</span>
            <div className="flex flex-wrap gap-2">
              <button
                className="secondary-button"
                type="button"
                disabled={!lastHome?.videos.length}
                onClick={() => setActive(lastHome)}
              >
                현재 검색/홈 결과 사용 ({lastHome?.videos.length ?? 0})
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
          {targets.notice && (
            <p role="status" className="mb-4 text-sm text-amber-900">
              {targets.notice}
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
            onBrowse={() => navigate('home')}
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
