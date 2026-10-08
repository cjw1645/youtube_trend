// AI 분석 요청 처리: 인증된 사용자 → 한도 예약 → 서버 검증된 대상·트렌드·최근 문답 → Gemini → 정산·저장.
// 클라이언트의 순위·통계·userId는 신뢰하지 않는다. 외부 호출(Gemini) 전에 개인·전체 한도를 원자적으로 확보한다.
import type { ChatRequest, ChatResponse } from '../../src/types/chat.js';
import type { PopularSnapshotResponse, SlotsResponse } from '../../src/types/trend.js';
import {
  buildChatInput,
  buildChatStats,
  renderChatReferences,
  type ChatExtras,
  type ChatRanking,
} from './chat-prompt.js';
import { generateContent, MAX_OUTPUT_TOKENS, type GeminiResult } from './gemini.js';
import { ApiFailure } from './http.js';
import { serviceRpc } from './supabase.js';
import { buildTrend, summarizeTrend, type TrendInputs } from './trend.js';
import { reserveAi, settleUsage } from './usage.js';
import { getAnalysisContext, listCategories } from './youtube.js';
import { kstDay } from './collect.js';

/** 이전 문답을 문맥으로 쓰는 최대 횟수(사용자 선택 정책, 최적값 근거 없음). */
export const HISTORY_TURNS = 3;
/** Gemini 입력(지시문+프롬프트)의 최대 문자 수. 임시값: 실제 토큰 측정(D07) 후 조정한다. */
export const MAX_INPUT_CHARS = 60_000;
const DEFAULT_AI_DAILY_CAP = 40;
const DEFAULT_AI_TOKEN_CAP = 1_000_000;

export interface ChatDeps {
  generate?: (input: { systemInstruction: string; prompt: string }) => Promise<GeminiResult>;
  now?: () => number;
}

function rows<T>(body: unknown): T[] {
  if (!Array.isArray(body))
    throw new ApiFailure('UPSTREAM_ERROR', '데이터 저장소 응답이 올바르지 않습니다.', 502);
  return body as T[];
}

/** 하루 전체 요청·토큰 예산 행 보장(이미 있으면 유지). */
async function ensureAiBudgets(day: string): Promise<void> {
  const requests = Number(process.env.AI_DAILY_CAP) || DEFAULT_AI_DAILY_CAP;
  const tokens = Number(process.env.AI_DAILY_TOKEN_CAP) || DEFAULT_AI_TOKEN_CAP;
  await serviceRpc('ensure_quota_row', { p_kind: 'ai_requests', p_day: day, p_cap: requests });
  await serviceRpc('ensure_quota_row', { p_kind: 'ai_tokens', p_day: day, p_cap: tokens });
}

/**
 * 순위와 소속을 서버가 저장된 목록으로 정한다.
 * - popular: 저장된 최신 인기 스냅샷의 위치. 목록에 없는 영상은 순위가 없다(전부 없으면 selection 기준으로 낮춘다).
 * - search: 본인 슬롯의 저장된 목록에 속한 영상만 허용한다.
 */
async function resolveRanking(
  userId: string,
  request: ChatRequest,
): Promise<{ ranking: ChatRanking; slotQuery?: string }> {
  if (request.source === 'popular') {
    const body = (await serviceRpc('get_latest_popular', {})) as PopularSnapshotResponse | null;
    const position = new Map(
      (body?.snapshot?.videos ?? []).map((video) => [video.video_id, video.position]),
    );
    const ranks = request.videoIds.map((id) => position.get(id));
    return ranks.some((rank) => rank !== undefined)
      ? { ranking: { source: 'popular', popularRanks: ranks } }
      : { ranking: { source: 'selection' } };
  }
  if (request.source === 'search') {
    const view = (await serviceRpc('get_search_slot_view', {
      p_user: userId,
      p_slot: request.searchSlot,
      p_include_videos: true,
    })) as SlotsResponse;
    const slot = view?.slots?.[0];
    const members = new Set((slot?.snapshot?.videos ?? []).map((video) => video.video_id));
    if (!slot || request.videoIds.some((id) => !members.has(id)))
      throw new ApiFailure(
        'BAD_REQUEST',
        '선택한 영상이 내 검색어의 저장된 목록에 없습니다. 목록을 다시 가져와 주세요.',
        400,
      );
    return { ranking: { source: 'search' }, slotQuery: slot.conditions.query };
  }
  return { ranking: { source: request.source } };
}

async function loadTrend(
  userId: string,
  request: ChatRequest,
  slotQuery: string | undefined,
): Promise<ChatExtras['trend']> {
  const categories = await listCategories().catch(() => []);
  const names = new Map(categories.map((category) => [category.id, category.title]));
  const nameOf = (id: string) => names.get(id) ?? '카테고리 정보 없음';
  const common = (await serviceRpc('get_popular_trend_inputs', {})) as TrendInputs | null;
  const sample =
    request.source === 'search'
      ? ((await serviceRpc('get_slot_trend_inputs', {
          p_user: userId,
          p_slot: request.searchSlot,
        })) as TrendInputs | null)
      : null;
  if (!common && !sample) return undefined;
  return {
    ...(common ? { common: summarizeTrend(buildTrend(common), nameOf) } : {}),
    ...(sample
      ? {
          searchSample: {
            query: slotQuery,
            note: '사용자가 지정한 검색어의 YouTube 검색 결과 표본(인기 순위 아님)',
            ...summarizeTrend(buildTrend(sample), nameOf),
          },
        }
      : {}),
  };
}

/** 입력이 상한을 넘으면 오래된 문답부터 버린다. 그래도 넘으면 입력 초과로 거부한다(필수 근거를 자르지 않는다). */
export function fitInput(
  build: (history: readonly { question: string; answer: string }[]) => {
    systemInstruction: string;
    prompt: string;
  },
  history: { question: string; answer: string }[],
) {
  let kept = history;
  for (;;) {
    const input = build(kept);
    if (input.systemInstruction.length + input.prompt.length <= MAX_INPUT_CHARS)
      return { input, history: kept };
    if (!kept.length)
      throw new ApiFailure(
        'BAD_REQUEST',
        '선택한 대상과 집계가 너무 커서 한 번에 분석할 수 없습니다. 영상 수를 줄여 다시 시도해 주세요.',
        413,
      );
    kept = kept.slice(1);
  }
}

export async function runChat(
  userId: string,
  request: ChatRequest,
  deps: ChatDeps = {},
): Promise<ChatResponse> {
  const now = deps.now?.() ?? Date.now();
  const generate = deps.generate ?? generateContent;

  // 1. 같은 요청 ID로 이미 저장된 답변이 있으면 Gemini를 다시 호출하지 않는다.
  const saved = rows<{ conversation_id: string; question: string; answer: string; model: string }>(
    await serviceRpc('get_saved_turn', { p_user: userId, p_request: request.requestId }),
  )[0];
  if (saved) {
    const context = await getAnalysisContext(request.videoIds);
    return {
      answer: saved.answer,
      model: saved.model,
      question: saved.question,
      context,
      conversationId: saved.conversation_id,
    };
  }

  // 2. 한도 예약(Gemini 호출 전). 저장소 장애면 예외로 외부 호출을 막는다.
  await ensureAiBudgets(kstDay(new Date(now)));
  const reservation = await reserveAi(userId, request.requestId);
  if (reservation.duplicate)
    throw new ApiFailure(
      'BAD_REQUEST',
      '같은 요청이 이미 처리되었거나 처리 중입니다. 새 질문으로 다시 전송해 주세요.',
      409,
    );

  // pre: 외부 호출 전, called: 호출 시작(결과 불명 가능), done: 정산 완료
  let phase: 'pre' | 'called' | 'done' = 'pre';
  let tokenReserved = 0;
  const day = kstDay(new Date(now));
  try {
    // 3. 서버 검증과 입력 구성(여기서 실패하면 Gemini는 호출되지 않는다).
    const { ranking, slotQuery } = await resolveRanking(userId, request);
    const history = request.conversationId
      ? rows<{ question: string; answer: string }>(
          await serviceRpc('get_chat_history', {
            p_user: userId,
            p_conversation: request.conversationId,
            p_turns: HISTORY_TURNS,
          }),
        )
      : [];
    if (request.conversationId && !history.length) {
      // 존재하지 않거나 남의 대화이거나 만료됨(첫 질문이 저장되기 전이면 이력이 비어 있을 수 있어 소유만 확인).
      const owned = rows<unknown>(
        await serviceRpc('get_conversation', {
          p_user: userId,
          p_conversation: request.conversationId,
        }),
      );
      if (!owned.length)
        throw new ApiFailure('NOT_FOUND', '대화를 찾을 수 없거나 보관 기간이 지났습니다.', 404);
    }
    const trend = await loadTrend(userId, request, slotQuery);
    const context = await getAnalysisContext(request.videoIds);
    const { input } = fitInput(
      (turns) =>
        buildChatInput(request.question, context, ranking, now, {
          history: turns,
          ...(trend ? { trend } : {}),
        }),
      history,
    );

    // 4. 전체 토큰 예산 확보: 문자 수 상한 추정(토큰 수가 아님) + 최대 출력. 실제 사용량으로 사후 보정한다.
    tokenReserved = input.systemInstruction.length + input.prompt.length + MAX_OUTPUT_TOKENS;
    const granted = await serviceRpc('try_consume_quota', {
      p_kind: 'ai_tokens',
      p_day: day,
      p_units: tokenReserved,
    });
    if (granted !== true) {
      tokenReserved = 0;
      throw new ApiFailure(
        'QUOTA_EXCEEDED',
        '서비스 전체 무료 사용량이 소진되었습니다. 나중에 다시 시도해 주세요.',
        429,
      );
    }

    // 5. 단일 호출(자동 재시도 없음). 이 시점부터는 호출 여부가 불명확할 수 있다.
    phase = 'called';
    const result = await generate(input);
    const answer = renderChatReferences(result.text, context, now);
    phase = 'done';
    await settleUsage(userId, reservation.id, 'settled').catch(() => undefined);

    const actual = result.usage
      ? (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0)
      : 0;
    if (actual > 0)
      await serviceRpc('adjust_quota', {
        p_kind: 'ai_tokens',
        p_day: day,
        p_delta: actual - tokenReserved,
      }).catch(() => undefined);

    // 6. 저장(실패해도 답변은 돌려주되 저장되지 않았음을 알린다).
    const { topRanking } = buildChatStats(context, ranking, now);
    let conversationId: string | null = null;
    let notice: string | undefined;
    try {
      const turn = rows<{ state: string; conversation_id: string | null }>(
        await serviceRpc('save_chat_turn', {
          p_user: userId,
          p_conversation: request.conversationId ?? null,
          p_request: request.requestId,
          p_question: request.question,
          p_answer: answer,
          p_model: result.model,
          p_input_tokens: result.usage?.inputTokens ?? null,
          p_output_tokens: result.usage?.outputTokens ?? null,
        }),
      )[0];
      if (turn?.state === 'saved' || turn?.state === 'duplicate')
        conversationId = turn.conversation_id;
      else
        notice =
          turn?.state === 'conversation_limit' || turn?.state === 'turn_limit'
            ? '대화 저장 한도에 도달해 이 답변은 저장되지 않았습니다. 오래된 대화를 삭제해 주세요.'
            : '대화를 저장하지 못했습니다. 이 화면에서만 볼 수 있습니다.';
    } catch {
      notice = '대화를 저장하지 못했습니다. 이 화면에서만 볼 수 있습니다.';
    }
    return {
      answer,
      model: result.model,
      question: request.question,
      context,
      ranking: { basisLabel: topRanking.basisLabel, ids: topRanking.items.map((item) => item.id) },
      conversationId,
      ...(notice ? { notice } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
    };
  } catch (error) {
    // 호출 전 실패는 개인 사용량과 토큰 예약을 돌려주고, 호출 후 실패는 보수적으로 유지한다.
    if (phase === 'called') {
      await settleUsage(userId, reservation.id, 'failed_unknown').catch(() => undefined);
    } else if (phase === 'pre') {
      await settleUsage(userId, reservation.id, 'released').catch(() => undefined);
      if (tokenReserved > 0)
        await serviceRpc('adjust_quota', {
          p_kind: 'ai_tokens',
          p_day: day,
          p_delta: -tokenReserved,
        }).catch(() => undefined);
    }
    throw error;
  }
}
