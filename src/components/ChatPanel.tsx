import { useId } from 'react';
import type { ChatController } from '../hooks/useChat';
import { selectChatVideos, type ChatTarget } from '../lib/chat-session';
import ChatResult, { ChatVideoList } from './ChatResult';

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
      <details open={state.status !== 'idle' ? true : undefined} className="group">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">AI에게 데이터 분석 묻기 <span aria-hidden className="inline-block transition-transform group-open:rotate-180">⌄</span></h2>
        <span className="max-w-full break-words rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-700">{target.label} · {videos.length}개 분석 대상</span>
      </summary>
      <div className="mt-3">
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">영상의 제목·설명·조회수 등 공개 정보를 분석합니다. 현재 목록에서 최대 20개, 상세 화면에서는 선택 영상 1개를 사용합니다.</p>
      {videos.length > 0 ? <details className="mt-2 text-xs text-zinc-600"><summary className="cursor-pointer">전송할 영상 확인 ({videos.length}개)</summary><ChatVideoList videos={videos} /></details>
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
      {state.status !== 'idle' && <ChatResult state={state} />}
      </div>
      </details>
    </section>
  );
}
