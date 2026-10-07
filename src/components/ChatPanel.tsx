import { useId, type KeyboardEvent } from 'react';
import { ChevronDownIcon, PaperPlaneIcon } from '@radix-ui/react-icons';
import type { ChatController } from '../hooks/useChat';
import { selectChatVideos, type ChatTarget } from '../lib/chat-session';
import ChatResult, { ChatVideoList } from './ChatResult';

const EXAMPLES = ['현재 유튜브 트렌드를 분석해줘', '이 영상이 인기 있는 이유를 분석해줘', '다음 콘텐츠 아이디어 3개를 제안해줘'];

export function submitChatOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
    || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  event.preventDefault();
  if (!event.repeat) event.currentTarget.form?.requestSubmit();
}

export default function ChatPanel({ chat, target }: { chat: ChatController; target: ChatTarget }) {
  const inputId = useId();
  const videos = selectChatVideos(target.videos);
  const { state, question } = chat;
  const pending = state.status === 'pending';
  const length = [...question.trim()].length;
  const disabled = pending || !videos.length || !length || length > 2000;
  return (
    <section aria-label="AI 데이터 분석" className="chat-surface">
      <details open className="group">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">AI에게 데이터 분석 묻기 <ChevronDownIcon aria-hidden="true" className="transition-transform group-open:rotate-180"/></h2>
        <span className="max-w-full break-words rounded-full bg-panel px-3 py-1 text-xs font-semibold text-zinc-700">{target.label} · {videos.length}개 분석 대상</span>
      </summary>
      <div className="mt-3">
      <p className="mt-2 text-sm leading-relaxed text-zinc-500">기본은 목록 앞쪽 최대 20개, 직접 선택은 화면 안의 1~20개, 상세는 선택한 1개입니다. 영상·음성 자체는 분석하지 않습니다.</p>
      {chat.notice && <p role="status" className="mt-3 text-sm text-amber-900">{chat.notice}</p>}
      {videos.length > 0 ? <details className="mt-2 text-xs text-zinc-600"><summary className="cursor-pointer">전송할 영상 확인 ({videos.length}개)</summary><ChatVideoList videos={videos} /></details>
        : <p className="mt-2 text-sm text-amber-800">분석할 영상이 없습니다. 영상을 조회한 뒤 질문해 주세요.</p>}
      <div className="mt-4 flex flex-wrap gap-2" aria-label="예시 질문">
        {EXAMPLES.map(example => <button key={example} type="button" disabled={pending} onClick={() => chat.setQuestion(example)} className="rounded-full border border-zinc-200 bg-panel px-3 py-2 text-xs text-zinc-700 hover:border-red-300 disabled:opacity-50">{example}</button>)}
      </div>
      <form className="mt-4" onSubmit={event => { event.preventDefault(); if (!disabled) void chat.submit(question, target); }}>
        <label htmlFor={inputId} className="text-sm font-medium">분석 질문</label>
        <textarea id={inputId} aria-describedby={`${inputId}-help`} value={question} disabled={pending} onChange={event => chat.setQuestion(event.target.value)} onKeyDown={submitChatOnEnter} rows={3} placeholder="현재 영상에서 어떤 콘텐츠 흐름이 보이나요?" className="mt-2 block w-full resize-y rounded-xl border border-zinc-300 bg-panel p-3 text-sm outline-none focus:border-red-500 disabled:bg-zinc-100" />
        <p id={`${inputId}-help`} className="mt-1 text-xs text-zinc-500">Enter로 전송 · Shift+Enter로 줄바꿈</p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className={`text-xs ${length > 2000 ? 'text-red-700' : 'text-zinc-500'}`}>{length.toLocaleString('ko-KR')} / 2,000자</span>
          <button type="submit" disabled={disabled} className="primary-button"><PaperPlaneIcon aria-hidden="true"/>{pending ? '분석 중…' : '전송'}</button>
        </div>
      </form>
      {state.status !== 'idle' && <ChatResult key={state.status==='success'?chat.entries?.at(-1)?.completedAt:'active'} state={state} completedAt={state.status==='success'?chat.entries?.at(-1)?.completedAt:undefined}/>}
      {chat.entries?.length > (state.status === 'success' ? 1 : 0) && <details className="mt-6"><summary className="text-sm font-semibold">이전 완료 대화 ({chat.entries.length - (state.status === 'success' ? 1 : 0)}개)</summary>{chat.entries.slice(0, state.status === 'success' ? -1 : undefined).map((entry, index) => <ChatResult key={`${entry.completedAt}-${index}`} state={{ status: 'success', snapshot: entry.snapshot, response: entry.response }} completedAt={entry.completedAt}/>)}</details>}
      {chat.clear && <div className="mt-6 border-t border-zinc-200 pt-4"><button type="button" disabled={pending} className="secondary-button" onClick={chat.clear}>대화 기록 지우기</button><p className="mt-2 text-xs text-zinc-500">이 탭에 초안과 완료 대화를 최대 24시간 보관합니다. 최근 10건까지 복원하며 대화 이력은 AI에 보내지 않습니다. 탭을 닫아도 브라우저 세션 복원 설정에 따라 남을 수 있습니다.</p></div>}
      </div>
      </details>
    </section>
  );
}
