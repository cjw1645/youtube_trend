import { ApiRequestError, postJson, toApiRequestError } from './api';
import {
  RANKING_SOURCES,
  type ChatRequest,
  type ChatResponse,
  type RankingSource,
} from '../types/chat';

export type TargetSource = 'home' | 'favorites' | 'detail' | 'dashboard';
export const TARGET_SOURCES: readonly TargetSource[] = ['home', 'favorites', 'detail', 'dashboard'];

export interface ChatTarget {
  label: string;
  videos: readonly { id: string; title: string }[];
  source?: TargetSource;
  capturedAt?: number;
  query?: { q: string; categoryId: string; order: '' | 'viewCount' | 'date' };
  /** 서버가 「인기순」 상위 3개를 고를 기준. popular면 popularRank를 함께 보낸다. */
  rankingSource?: RankingSource;
  /** 영상 ID → YouTube 인기 순위(1부터, API 제공 순서) */
  popularRank?: Readonly<Record<string, number>>;
}

/** 저장·복원한 순위 정보가 올바른지 확인한다. popular일 때만 popularRank를 허용한다. */
export function validRanking(value: {
  rankingSource?: unknown;
  popularRank?: unknown;
  videos?: unknown;
}): boolean {
  const { rankingSource, popularRank } = value;
  if (rankingSource === undefined) return popularRank === undefined;
  if (
    typeof rankingSource !== 'string' ||
    !RANKING_SOURCES.includes(rankingSource as RankingSource)
  )
    return false;
  if (popularRank === undefined) return true;
  if (rankingSource !== 'popular' || !popularRank || typeof popularRank !== 'object') return false;
  const entries = Object.entries(popularRank);
  return (
    entries.length <= 20 &&
    entries.every(
      ([id, rank]) =>
        /^[A-Za-z0-9_-]{11}$/.test(id) && Number.isInteger(rank) && rank >= 1 && rank <= 200,
    )
  );
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

/**
 * 영상 검색 목록의 「인기순」 기준. 인기 목록은 YouTube 인기 순위(API 제공 순서),
 * 검색·카테고리 결과는 서버가 업로드 후 일평균 조회수로 고른다.
 * apiOrder: 목록이 아직 API 제공 순서 그대로면 popularRank가 없을 때 화면 순서를 순위로 쓴다.
 */
export function listRanking(
  videos: readonly { id: string; popularRank?: number }[],
  popular: boolean,
  apiOrder: boolean,
): Pick<ChatTarget, 'rankingSource' | 'popularRank'> {
  if (!popular) return { rankingSource: 'search' };
  const ids = new Set(
    selectChatVideos(videos.map(({ id }) => ({ id, title: '' }))).map((v) => v.id),
  );
  const ranks = new Map<string, number | undefined>();
  videos.forEach((video, index) => {
    if (ids.has(video.id) && !ranks.has(video.id))
      ranks.set(video.id, video.popularRank ?? (apiOrder ? index + 1 : undefined));
  });
  return [...ranks.values()].every((rank) => Number.isInteger(rank))
    ? { rankingSource: 'popular', popularRank: Object.fromEntries(ranks) as Record<string, number> }
    : { rankingSource: 'popular' };
}

/** 인기 차트 목록의 앞 20개를 YouTube 인기 순위(popularRank)와 함께 AI 대상으로 만든다. */
export function popularChartTarget(
  videos: readonly { id: string; title: string; popularRank?: number }[],
  label: string,
  capturedAt: number,
): ChatTarget {
  const top = videos.slice(0, 20);
  return {
    label,
    videos: top,
    source: 'dashboard',
    capturedAt,
    rankingSource: 'popular',
    popularRank: Object.fromEntries(
      top.map((video, index) => [video.id, video.popularRank ?? index + 1]),
    ),
  };
}

/** 요청 본문의 순위 필드. popularRanks는 videoIds와 같은 순서·길이다. */
function rankingFields(
  target: ChatTarget,
  videos: readonly { id: string }[],
): Pick<ChatRequest, 'source' | 'popularRanks'> {
  if (!target.rankingSource) return {};
  const ranks = target.popularRank;
  if (target.rankingSource !== 'popular' || !ranks) return { source: target.rankingSource };
  const popularRanks = videos.map(({ id }) => ranks[id]);
  return popularRanks.every((rank) => Number.isInteger(rank))
    ? { source: 'popular', popularRanks }
    : { source: 'popular' };
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
          {
            question: trimmed,
            videoIds: videos.map(({ id }) => id),
            ...rankingFields(snapshot, videos),
          },
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
