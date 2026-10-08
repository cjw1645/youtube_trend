import type { ChatRequest } from '../../src/types/chat.js';
import { ApiFailure } from './http.js';
import {
  isMeaninglessQuestion,
  MEANINGLESS_QUESTION_MESSAGE,
} from '../../src/lib/chat-question.js';

export const MAX_CHAT_BYTES = 16 * 1024;
/** 질문 길이(Unicode 코드 포인트). 사용자 결정(2026-10-08): 1~100자. 답변 길이는 제한하지 않는다. */
export const MAX_QUESTION_CHARS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const badRequest = (message: string) => new ApiFailure('BAD_REQUEST', message, 400);
const tooLarge = () => new ApiFailure('BAD_REQUEST', '요청 본문은 16KB 이하로 보내 주세요.', 413);

/** Content-Length를 신뢰하지 않고 실제 스트림 바이트도 제한한다. */
export async function readChatRequest(request: Request): Promise<ChatRequest> {
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  ) {
    throw new ApiFailure('BAD_REQUEST', 'application/json 형식으로 보내 주세요.', 415);
  }
  const length = request.headers.get('Content-Length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw badRequest('요청 본문 크기 정보가 올바르지 않습니다.');
    if (Number(length) > MAX_CHAT_BYTES) throw tooLarge();
  }
  if (!request.body) throw badRequest('질문과 영상 ID 목록을 보내 주세요.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CHAT_BYTES) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw badRequest('요청 본문을 읽지 못했습니다.');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw badRequest('올바른 JSON 본문을 보내 주세요.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw badRequest('질문과 영상 ID 목록을 보내 주세요.');
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !ALLOWED_FIELDS.has(key))) {
    throw badRequest(
      'question, videoIds, source, requestId, conversationId, searchSlot만 보낼 수 있습니다.',
    );
  }
  if (typeof fields.question !== 'string') throw badRequest('질문을 입력해 주세요.');
  const question = fields.question.trim();
  if (!question || Array.from(question).length > MAX_QUESTION_CHARS)
    throw badRequest(`질문은 1–${MAX_QUESTION_CHARS}자로 입력해 주세요.`);
  if (isMeaninglessQuestion(question)) throw badRequest(MEANINGLESS_QUESTION_MESSAGE);
  if (
    !Array.isArray(fields.videoIds) ||
    fields.videoIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id))
  ) {
    throw badRequest('올바른 영상 ID 목록을 보내 주세요.');
  }
  const videoIds = [...new Set(fields.videoIds as string[])];
  if (!videoIds.length || videoIds.length > 20)
    throw badRequest('분석할 영상은 1–20개 선택해 주세요.');
  if (typeof fields.requestId !== 'string' || !UUID.test(fields.requestId))
    throw badRequest('요청 ID(requestId)가 올바르지 않습니다.');
  if (
    fields.conversationId !== undefined &&
    (typeof fields.conversationId !== 'string' || !UUID.test(fields.conversationId))
  )
    throw badRequest('대화 ID가 올바르지 않습니다.');
  if (fields.searchSlot !== undefined && fields.searchSlot !== 1 && fields.searchSlot !== 2)
    throw badRequest('searchSlot은 1 또는 2여야 합니다.');
  const source = readSource(fields.source);
  if ((source === 'search') !== (fields.searchSlot !== undefined))
    throw badRequest('searchSlot은 source=search일 때만, 그리고 함께 보내 주세요.');
  return {
    question,
    videoIds,
    requestId: fields.requestId.toLowerCase(),
    ...(source ? { source } : {}),
    ...(fields.conversationId ? { conversationId: fields.conversationId.toLowerCase() } : {}),
    ...(fields.searchSlot ? { searchSlot: fields.searchSlot as 1 | 2 } : {}),
  };
}

const ALLOWED_FIELDS = new Set([
  'question',
  'videoIds',
  'source',
  'requestId',
  'conversationId',
  'searchSlot',
]);
const SOURCES = new Set<string>(['popular', 'search', 'favorites', 'selection', 'detail']);

function readSource(source: unknown): ChatRequest['source'] {
  if (source === undefined) return undefined;
  if (typeof source !== 'string' || !SOURCES.has(source))
    throw badRequest('source 값이 올바르지 않습니다.');
  return source as ChatRequest['source'];
}
