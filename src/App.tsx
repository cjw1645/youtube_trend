import Home from './pages/Home';

export default function App() {
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
        <Home />
      </main>
    </div>
  );
}
