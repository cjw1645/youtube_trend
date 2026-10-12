import type { ChatState, ChatTarget } from '../lib/chat-session';
import { formatCount, formatNumericRanges } from '../lib/format';
import { Fragment, useState, type ReactNode } from 'react';
import { copyChatText, formatChatExport } from '../lib/chat-export';
import {
  findMentionedVideos,
  rankedVideos,
  parseAnswerSections,
  splitVideoIds,
  withoutTagCitations,
  type AnswerPart,
  type AnswerVideoInfo,
} from '../lib/answer-sections';
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
              조회수 {formatCount(video.viewCount)} · {video.publishedAt.slice(0, 10)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const SHOWN_TAGS = 5;

/** 서버가 치환한 태그 목록은 앞쪽 일부만 #태그로 보여주고 전체는 툴팁으로 둔다. */
function CitedTags({ tags, title }: { tags: string[]; title: string }) {
  const rest = tags.length - SHOWN_TAGS;
  return (
    <span className="answer-tags" title={`${title} 태그: ${tags.join(', ')}`}>
      {tags
        .slice(0, SHOWN_TAGS)
        .map((tag) => `#${tag}`)
        .join(' ')}
      {rest > 0 && <span className="answer-tags-more"> 외 {rest}개</span>}
    </span>
  );
}

/** 화면에 보이는 글자 수. 영상 링크·태그는 한 덩어리로 세어 중간에 잘리지 않게 한다. */
const partLength = (part: AnswerPart) =>
  typeof part === 'string'
    ? part.length
    : part.kind === 'tags'
      ? part.tags.length
      : part.label.length;
const textLength = (text: string, videos: ReadonlyMap<string, AnswerVideoInfo>) =>
  splitVideoIds(text, videos).reduce((sum, part) => sum + partLength(part), 0);

/** 답변 속 대상 영상 ID를 짧은 제목 링크로 보여준다. 복사·내보내기 원문은 그대로다. limit이 있으면 앞에서 그만큼만 보인다. */
function AnswerText({
  text,
  videos,
  limit,
}: {
  text: string;
  videos: ReadonlyMap<string, AnswerVideoInfo>;
  limit?: number;
}) {
  let left = limit ?? Infinity;
  const shown: ReactNode[] = [];
  const parts = splitVideoIds(text, videos);
  const total = parts.reduce((sum, part) => sum + partLength(part), 0);
  for (const [index, part] of parts.entries()) {
    if (left <= 0) break;
    left -= partLength(part);
    shown.push(
      typeof part === 'string' ? (
        left >= 0 ? (
          part
        ) : (
          part.slice(0, part.length + left)
        )
      ) : part.kind === 'tags' ? (
        <CitedTags key={index} tags={part.tags} title={part.title} />
      ) : (
        <Fragment key={index}>
          {part.labeled && '영상 제목: '}
          <a
            className="answer-video-link"
            href={`https://www.youtube.com/watch?v=${encodeURIComponent(part.id)}`}
            target="_blank"
            rel="noreferrer"
            title={part.title}
          >
            {part.labeled ? part.label : `「${part.label}」`}
          </a>
        </Fragment>
      ),
    );
  }
  return (
    <p className="whitespace-pre-wrap break-words">
      {shown}
      {limit !== undefined && limit < total && <span className="typing-caret" aria-hidden="true" />}
    </p>
  );
}

/** 섹션 사이에 잠깐 멈추는 정도(글자 수로 환산) */
const SECTION_PAUSE = 10;

/**
 * 답변을 앞에서부터 보여 줄 때의 계획: 블록(머리말 앞 글, 각 섹션 본문)별 시작 위치와 전체 글자 수,
 * 핵심 요약이 끝나는 위치(그때까지는 천천히 보여 준다).
 */
export function answerRevealPlan(answer: string, info: ReadonlyMap<string, AnswerVideoInfo>) {
  const parsed = parseAnswerSections(answer);
  const blocks = parsed
    ? [
        ...(parsed.intro ? [{ title: '', text: parsed.intro }] : []),
        ...parsed.sections.map((section) => ({ title: section.title, text: section.body })),
      ]
    : [{ title: '', text: answer }];
  let cursor = 0;
  const starts: number[] = [];
  let slowUntil = parsed ? 0 : textLength(answer, info);
  for (const block of blocks) {
    starts.push(cursor);
    const length = textLength(block.text, info);
    cursor += length + SECTION_PAUSE;
    if (block.title === '핵심 요약') slowUntil = cursor - SECTION_PAUSE;
  }
  return { parsed, blocks, starts, total: Math.max(0, cursor - SECTION_PAUSE), slowUntil };
}

/** 머리말이 모두 있으면 섹션 카드로, 아니면 원문 그대로 텍스트로 표시한다. */
export function AnswerBody({
  answer,
  videos,
  info,
  ranking,
  reveal,
}: {
  answer: string;
  videos: AnalysisVideo[];
  info: ReadonlyMap<string, AnswerVideoInfo>;
  /** 서버 topRanking 순서. 없으면(이전 응답) 근거에 언급된 순서로 고른다. */
  ranking?: readonly string[];
  /** 방금 받은 답변을 채팅처럼 앞에서부터 보여 줄 때 지금까지 보일 글자 수. 없으면 전부 보인다. */
  reveal?: number;
}) {
  const plan = answerRevealPlan(answer, info);
  const { parsed } = plan;
  // 블록 i에 보일 글자 수: 아직 시작 전이면 0 이하, 끝났으면 전체
  const limitOf = (index: number) =>
    reveal === undefined ? undefined : reveal - plan.starts[index];
  if (!parsed)
    return (
      <div aria-label="AI 답변" className="answer-plain">
        <AnswerText text={answer} videos={info} limit={limitOf(0)} />
      </div>
    );
  const offset = parsed.intro ? 1 : 0;
  return (
    <div aria-label="AI 답변" className="answer-sections">
      {parsed.intro && <AnswerText text={parsed.intro} videos={info} limit={limitOf(0)} />}
      {parsed.sections.map((section, index) => {
        const limit = limitOf(index + offset);
        // 섹션은 앞 섹션을 다 보여 준 뒤 머리말부터 나타난다.
        if (limit !== undefined && limit < 0) return null;
        const mentioned =
          section.title !== '근거 데이터'
            ? []
            : ranking?.length
              ? rankedVideos(ranking, videos)
              : findMentionedVideos(withoutTagCitations(section.body, info), videos);
        const finished = limit === undefined || limit >= textLength(section.body, info);
        return (
          <section key={section.title} className="answer-section">
            <h3>{section.title}</h3>
            <AnswerText text={section.body} videos={info} limit={limit} />
            {mentioned.length > 0 && finished && <EvidenceVideos videos={mentioned} />}
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
            ranking={state.response.ranking?.ids}
            info={
              new Map<string, AnswerVideoInfo>([
                ...state.snapshot.videos.map(({ id, title }) => [id, { title }] as const),
                ...state.response.context.videos.map(
                  ({ id, title, tags }) => [id, { title, tags }] as const,
                ),
              ])
            }
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
