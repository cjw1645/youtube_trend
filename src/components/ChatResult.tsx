import type { ChatState, ChatTarget } from '../lib/chat-session';
import { formatCount, formatDate, formatNumericRanges } from '../lib/format';
import { useState } from 'react';
import { copyChatText, formatChatExport } from '../lib/chat-export';
import { findMentionedVideos, parseAnswerSections } from '../lib/answer-sections';
import type { AnalysisVideo } from '../types/chat';

function EvidenceVideos({ videos }: { videos: AnalysisVideo[] }) {
  return (
    <ul className="evidence-videos" aria-label="근거에 언급된 영상">
      {videos.map((video) => (
        <li key={video.id}>
          <a
            href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={`https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`}
              alt=""
              loading="lazy"
            />
            <span className="evidence-title">{video.title}</span>
            <span className="evidence-meta">
              조회수 {formatCount(video.viewCount)} · {formatDate(video.publishedAt)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** 머리말이 모두 있으면 섹션 카드로, 아니면 원문 그대로 텍스트로 표시한다. */
function AnswerBody({ answer, videos }: { answer: string; videos: AnalysisVideo[] }) {
  const parsed = parseAnswerSections(answer);
  if (!parsed)
    return (
      <div aria-label="AI 답변" className="answer-plain">
        <p className="whitespace-pre-wrap break-words">{answer}</p>
      </div>
    );
  return (
    <div aria-label="AI 답변" className="answer-sections">
      {parsed.intro && <p className="whitespace-pre-wrap break-words">{parsed.intro}</p>}
      {parsed.sections.map((section) => {
        const mentioned =
          section.title === '근거 데이터' ? findMentionedVideos(section.body, videos) : [];
        return (
          <section key={section.title} className="answer-section">
            <h3>{section.title}</h3>
            <p className="whitespace-pre-wrap break-words">{section.body}</p>
            {mentioned.length > 0 && <EvidenceVideos videos={mentioned} />}
          </section>
        );
      })}
    </div>
  );
}

export function ChatVideoList({ videos }: { videos: ChatTarget['videos'] }) {
  return (
    <ol className="mt-2 list-inside list-decimal space-y-1">
      {videos.map((video) => (
        <li key={video.id}>
          <a
            className="break-words underline decoration-zinc-300 underline-offset-2 hover:text-red-700"
            href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            {video.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

export default function ChatResult({
  state,
  completedAt,
}: {
  state: Exclude<ChatState, { status: 'idle' }>;
  completedAt?: number;
}) {
  const [exportNotice, setExportNotice] = useState('');
  const [copying, setCopying] = useState(false);
  const exportText = () =>
    state.status === 'success' && completedAt
      ? formatChatExport({ snapshot: state.snapshot, response: state.response, completedAt })
      : '';
  const copy = async () => {
    setCopying(true);
    try {
      await copyChatText(exportText());
      setExportNotice('질문·답변·근거를 복사했습니다.');
    } catch {
      setExportNotice('복사 결과를 확인하지 못했습니다. 텍스트 내보내기를 사용해 주세요.');
    } finally {
      setCopying(false);
    }
  };
  const download = () => {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob(['\uFEFF', exportText()], { type: 'text/plain;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `youtube-trend-ai-${new Date(completedAt!).toISOString().replace(/[:.]/g, '-')}.txt`;
      document.body.append(link);
      link.click();
      link.remove();
      setExportNotice('텍스트 파일 다운로드를 요청했습니다.');
    } catch {
      setExportNotice('텍스트 파일을 내보내지 못했습니다. 답변 복사를 사용해 주세요.');
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000);
    }
  };
  return (
    <div className="mt-5 border-t border-zinc-200 pt-4">
      <p className="text-xs font-semibold text-zinc-600">
        요청 대상: {state.snapshot.label} · {state.snapshot.videos.length}개 (전송 시점 기준)
      </p>
      <p className="mt-2 break-words text-sm font-medium">질문: {state.snapshot.question}</p>
      <details className="mt-2 text-xs text-zinc-600">
        <summary className="cursor-pointer">요청 당시 영상 확인</summary>
        <ChatVideoList videos={state.snapshot.videos} />
      </details>
      {state.status === 'pending' && (
        <p role="status" className="mt-4 text-sm text-zinc-600">
          영상 정보를 분석하고 있습니다…
        </p>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">
            {state.error.code === 'INTERRUPTED'
              ? '이전 요청의 결과 수신이 중단되었습니다'
              : state.error.code === 'QUOTA_EXCEEDED'
                ? 'API 호출이 제한되었습니다'
                : state.error.code === 'TIMEOUT'
                  ? '분석 시간이 초과되었습니다'
                  : 'AI 분석을 완료하지 못했습니다'}
          </p>
          <p className="mt-1">{state.error.message}</p>
          <p className="mt-2 text-xs">
            현재 분석 대상을 확인하고 전송 버튼으로 다시 요청해 주세요.
          </p>
        </div>
      )}
      {state.status === 'success' && (
        <>
          {state.response.context.excludedIds.length > 0 && (
            <p className="mt-2 text-sm text-amber-800">
              조회할 수 없는 영상 {state.response.context.excludedIds.length}개를 제외하고{' '}
              {state.response.context.videos.length}개를 분석했습니다.
            </p>
          )}
          <AnswerBody
            answer={formatNumericRanges(state.response.answer)}
            videos={state.response.context.videos}
          />
          {completedAt && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-zinc-500">
                완료 시각: {new Date(completedAt).toLocaleString('ko-KR')} · 복사/내보내기에 질문과
                당시 서버 근거가 포함됩니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={copying}
                  onClick={() => void copy()}
                >
                  {copying ? '복사 중…' : '답변 복사'}
                </button>
                <button className="secondary-button" type="button" onClick={download}>
                  텍스트 내보내기
                </button>
              </div>
              {exportNotice && (
                <p role="status" className="mt-2 text-sm text-zinc-600">
                  {exportNotice}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
