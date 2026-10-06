import { useState } from 'react';
import Home from './pages/Home';
import Favorites from './pages/Favorites';
import VideoDetail from './components/VideoDetail';
import { useFavorites } from './hooks/useFavorites';
import { useCategories } from './hooks/useCategories';

export default function App() {
  const [page, setPage] = useState<'home' | 'favorites'>('home');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const favorites = useFavorites();
  const { categories, nameById } = useCategories();
  const onSelect = (video: { id: string }) => setSelectedVideoId(video.id);
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-red-600 text-xs font-bold text-white">
            ▶
          </span>
          <h1 className="text-base font-bold">유튜브 트렌드 AI 대시보드</h1>
          <span className="ml-auto hidden text-xs text-zinc-500 sm:inline">YouTube Data API 실시간 조회 · 한국</span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <nav aria-label="화면 전환" className="mb-6 flex gap-2 border-b border-zinc-200 pb-3">
          <button type="button" aria-current={page === 'home' ? 'page' : undefined} onClick={() => setPage('home')} className={`rounded-full px-4 py-2 text-sm font-semibold ${page === 'home' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>영상 둘러보기</button>
          <button type="button" aria-current={page === 'favorites' ? 'page' : undefined} onClick={() => setPage('favorites')} className={`rounded-full px-4 py-2 text-sm font-semibold ${page === 'favorites' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>관심 영상 ({favorites.videos.length})</button>
        </nav>
        {favorites.error && (
          <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>{favorites.error}</p>
            <button type="button" onClick={favorites.reload} className="mt-2 font-semibold underline">저장 상태 다시 확인</button>
          </div>
        )}
        <div hidden={page !== 'home'}>
          <Home favorites={favorites} categories={categories} nameById={nameById} onSelect={onSelect} />
        </div>
        {page === 'favorites' && <Favorites favorites={favorites} categoryNames={nameById} onSelect={onSelect} onBrowse={() => setPage('home')} />}
        {selectedVideoId && (
          <VideoDetail key={selectedVideoId} videoId={selectedVideoId} categoryNames={nameById} onClose={() => setSelectedVideoId(null)} favorites={favorites} />
        )}
      </main>
    </div>
  );
}
