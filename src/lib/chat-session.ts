import { ApiRequestError, postJson, toApiRequestError } from './api';
import type { ChatRequest, ChatResponse } from '../types/chat';

export interface ChatTarget {
  label: string;
  videos: readonly { id: string; title: string }[];
  source?: 'home' | 'favorites' | 'detail';
  capturedAt?: number;
  query?: { q: string; categoryId: string; order: '' | 'viewCount' | 'date' };
}
export interface ChatSnapshot extends ChatTarget {
  question: string;
}
export type ChatState =
  | { status: 'idle' }
  | { status: 'pending'; snapshot: ChatSnapshot }
  | { status: 'success'; snapshot: ChatSnapshot; response: ChatResponse }
  | { status: 'error'; snapshot: ChatSnapshot; error: ApiRequestError };

export function selectChatVideos(videos: ChatTarget['videos']) {
  const seen = new Set<string>();
  const selected: { id: string; title: string }[] = [];
  for (const { id, title } of videos) {
    if (seen.has(id)) continue;
    seen.add(id);
    selected.push({ id, title });
    if (selected.length === 20) break;
  }
  return selected;
}

type Send = (request: ChatRequest, signal: AbortSignal) => Promise<ChatResponse>;

/** 렌더링 전에도 중복 전송을 차단하고 화면 전환과 독립된 대상을 보관한다. */
export function createChatSession(
  onChange: (state: ChatState) => void,
  send: Send = (body, signal) => postJson<ChatResponse>('/api/chat', body, signal),
  timeoutMs = 45_000,
) {
  let active: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  function cancel() {
    if (!active) return;
    clearTimeout(active.timer);
    active.controller.abort();
    active = undefined;
  }
  return {
    cancel,
    async submit(question: string, target: ChatTarget): Promise<boolean> {
      const trimmed = question.trim();
      const videos = selectChatVideos(target.videos);
      if (active || !trimmed || [...trimmed].length > 2000 || !videos.length) return false;
      const snapshot: ChatSnapshot = {
        ...target,
        question: trimmed,
        videos,
        ...(target.query ? { query: { ...target.query } } : {}),
      };
      const controller = new AbortController();
      const request = {
        controller,
        timer: setTimeout(() => {
          if (active !== request) return;
          active = undefined;
          controller.abort();
          onChange({
            status: 'error',
            snapshot,
            error: new ApiRequestError(
              'TIMEOUT',
              '분석에 시간이 걸리고 있습니다. 잠시 기다린 뒤 다시 전송해 주세요.',
              0,
            ),
          });
        }, timeoutMs),
      };
      active = request;
      onChange({ status: 'pending', snapshot });
      try {
        const response = await send(
          { question: trimmed, videoIds: videos.map(({ id }) => id) },
          controller.signal,
        );
        if (active !== request) return true;
        if (!response.answer?.trim())
          throw new ApiRequestError(
            'EMPTY_RESPONSE',
            'AI 답변이 비어 있습니다. 전송 버튼으로 다시 요청해 주세요.',
            502,
          );
        if (
          !Array.isArray(response.context?.videos) ||
          !Array.isArray(response.context.excludedIds)
        ) {
          throw new ApiRequestError(
            'UPSTREAM_ERROR',
            '분석 대상 정보를 읽지 못했습니다. 다시 요청해 주세요.',
            502,
          );
        }
        onChange({ status: 'success', snapshot, response });
      } catch (error) {
        if (active === request)
          onChange({ status: 'error', snapshot, error: toApiRequestError(error) });
      } finally {
        clearTimeout(request.timer);
        if (active === request) active = undefined;
      }
      return true;
    },
  };
}
