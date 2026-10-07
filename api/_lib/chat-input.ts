import type { ChatRequest } from '../../src/types/chat.js';
import { ApiFailure } from './http.js';

export const MAX_CHAT_BYTES = 16 * 1024;
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
  if (Object.keys(fields).some((key) => key !== 'question' && key !== 'videoIds')) {
    throw badRequest('question과 videoIds만 보낼 수 있습니다.');
  }
  if (typeof fields.question !== 'string') throw badRequest('질문을 입력해 주세요.');
  const question = fields.question.trim();
  if (!question || Array.from(question).length > 2000)
    throw badRequest('질문은 1–2,000자로 입력해 주세요.');
  if (
    !Array.isArray(fields.videoIds) ||
    fields.videoIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id))
  ) {
    throw badRequest('올바른 영상 ID 목록을 보내 주세요.');
  }
  const videoIds = [...new Set(fields.videoIds as string[])];
  if (!videoIds.length || videoIds.length > 20)
    throw badRequest('분석할 영상은 1–20개 선택해 주세요.');
  return { question, videoIds };
}
