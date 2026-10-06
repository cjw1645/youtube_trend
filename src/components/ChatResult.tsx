import type { ChatState, ChatTarget } from '../lib/chat-session';

export function ChatVideoList({ videos }: { videos: ChatTarget['videos'] }) {
  return <ol className="mt-2 list-inside list-decimal space-y-1">{videos.map(video => (
    <li key={video.id}><a className="break-words underline decoration-zinc-300 underline-offset-2 hover:text-red-700" href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`} target="_blank" rel="noreferrer">{video.title}</a></li>
  ))}</ol>;
}

export default function ChatResult({ state }: { state: Exclude<ChatState, { status: 'idle' }> }) {
  return <div className="mt-5 border-t border-zinc-200 pt-4">
    <p className="text-xs font-semibold text-zinc-600">요청 대상: {state.snapshot.label} · {state.snapshot.videos.length}개 (전송 시점 기준)</p>
    <p className="mt-2 break-words text-sm font-medium">질문: {state.snapshot.question}</p>
    <details className="mt-2 text-xs text-zinc-600"><summary className="cursor-pointer">요청 당시 영상 확인</summary><ChatVideoList videos={state.snapshot.videos} /></details>
    {state.status === 'pending' && <p role="status" className="mt-4 text-sm text-zinc-600">영상 정보를 분석하고 있습니다…</p>}
    {state.status === 'error' && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">{state.error.code === 'QUOTA_EXCEEDED' ? 'API 무료 할당량을 초과했습니다' : state.error.code === 'TIMEOUT' ? '분석 시간이 초과되었습니다' : 'AI 분석을 완료하지 못했습니다'}</p>
      <p className="mt-1">{state.error.message}</p><p className="mt-2 text-xs">현재 분석 대상을 확인하고 전송 버튼으로 다시 요청해 주세요.</p>
    </div>}
    {state.status === 'success' && <>
      {state.response.context.excludedIds.length > 0 && <p className="mt-2 text-sm text-amber-800">조회할 수 없는 영상 {state.response.context.excludedIds.length}개를 제외하고 {state.response.context.videos.length}개를 분석했습니다.</p>}
      <div aria-label="AI 답변" className="mt-3 rounded-xl bg-white p-4 text-sm leading-7 text-zinc-800">
        {state.response.answer.split(/(\[(?:핵심 요약|근거 데이터|콘텐츠 제안)\])/g).map((part, index) => /^\[(?:핵심 요약|근거 데이터|콘텐츠 제안)\]$/.test(part)
          ? <h3 key={index} className="mb-2 mt-5 font-bold text-zinc-900 first:mt-0">{part.slice(1, -1)}</h3>
          : part.trim() && <p key={index} className="whitespace-pre-wrap break-words">{part.trim()}</p>)}
      </div>
    </>}
  </div>;
}
