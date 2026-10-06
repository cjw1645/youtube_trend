import { useId } from 'react';
import type { ChatController } from '../hooks/useChat';
import { selectChatVideos, type ChatTarget } from '../lib/chat-session';

const EXAMPLES = ['현재 유튜브 트렌드를 분석해줘', '이 영상이 인기 있는 이유를 분석해줘', '다음 콘텐츠 아이디어 3개를 제안해줘'];

export default function ChatPanel({ chat, target }: { chat: ChatController; target: ChatTarget }) {
  const inputId = useId();
  const videos = selectChatVideos(target.videos);
  const { state, question } = chat;
  const pending = state.status === 'pending';
  const length = [...question.trim()].length;
  const disabled = pending || !videos.length || !length || length > 2000;
  return (
    <section aria-label="AI 데이터 분석" className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">AI에게 데이터 분석 묻기</h2>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-700">{target.label} · {videos.length}개 분석 대상</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">현재 화면의 영상 메타데이터를 바탕으로 분석합니다. 목록은 화면 순서대로 최대 20개, 상세는 선택 영상 1개입니다.</p>
      {videos.length > 0 ? <details className="mt-2 text-xs text-zinc-600"><summary className="cursor-pointer">전송할 영상 확인 ({videos.length}개)</summary><ol className="mt-2 list-inside list-decimal space-y-1">{videos.map(video => <li key={video.id}>{video.title}</li>)}</ol></details>
        : <p className="mt-2 text-sm text-amber-800">분석할 영상이 없습니다. 영상을 조회한 뒤 질문해 주세요.</p>}
      <div className="mt-4 flex flex-wrap gap-2" aria-label="예시 질문">
        {EXAMPLES.map(example => <button key={example} type="button" disabled={pending} onClick={() => chat.setQuestion(example)} className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:border-red-300 disabled:opacity-50">{example}</button>)}
      </div>
      <form className="mt-4" onSubmit={event => { event.preventDefault(); if (!disabled) void chat.submit(question, target); }}>
        <label htmlFor={inputId} className="text-sm font-medium">분석 질문</label>
        <textarea id={inputId} value={question} disabled={pending} onChange={event => chat.setQuestion(event.target.value)} rows={3} placeholder="현재 영상에서 어떤 콘텐츠 흐름이 보이나요?" className="mt-2 block w-full resize-y rounded-xl border border-zinc-300 bg-white p-3 text-sm outline-none focus:border-red-500 disabled:bg-zinc-100" />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className={`text-xs ${length > 2000 ? 'text-red-700' : 'text-zinc-500'}`}>{length.toLocaleString('ko-KR')} / 2,000자</span>
          <button type="submit" disabled={disabled} className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300">{pending ? '분석 중…' : '전송'}</button>
        </div>
      </form>
      {state.status !== 'idle' && <div className="mt-5 border-t border-zinc-200 pt-4">
        <p className="text-xs font-semibold text-zinc-600">요청 대상: {state.snapshot.label} · {state.snapshot.videos.length}개 (전송 시점 기준)</p>
        <p className="mt-2 break-words text-sm font-medium">질문: {state.snapshot.question}</p>
        <details className="mt-2 text-xs text-zinc-600"><summary className="cursor-pointer">요청 당시 영상 확인</summary><ul className="mt-2 space-y-1">{state.snapshot.videos.map(video => <li key={video.id}>{video.title} · {video.id}</li>)}</ul></details>
        {pending && <p role="status" className="mt-4 text-sm text-zinc-600">AI가 영상 데이터를 분석하고 있습니다. 화면을 옮겨도 요청 대상은 유지됩니다.</p>}
        {state.status === 'error' && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">{state.error.code === 'QUOTA_EXCEEDED' ? 'API 무료 할당량을 초과했습니다' : state.error.code === 'TIMEOUT' ? '분석 시간이 초과되었습니다' : 'AI 분석을 완료하지 못했습니다'}</p>
          <p className="mt-1">{state.error.message}</p><p className="mt-2 text-xs">현재 분석 대상을 확인하고 전송 버튼으로 다시 요청해 주세요. 자동 재시도는 하지 않습니다.</p>
        </div>}
        {state.status === 'success' && <>
          <p className="mt-3 text-xs text-zinc-500">실제 분석 {state.response.context.videos.length}개 · {state.response.model}</p>
          {state.response.context.excludedIds.length > 0 && <p className="mt-2 text-sm text-amber-800">조회할 수 없어 제외한 영상: {state.response.context.excludedIds.join(', ')}</p>}
          <div aria-label="AI 답변" className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-white p-4 text-sm leading-7 text-zinc-800">{state.response.answer}</div>
        </>}
      </div>}
    </section>
  );
}
