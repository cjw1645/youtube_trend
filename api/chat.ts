import type { ChatResponse } from '../src/types/chat.js';
import { requireUser } from './_lib/auth.js';
import { readChatRequest } from './_lib/chat-input.js';
import { runChat } from './_lib/chat-service.js';
import { errorResponse, json } from './_lib/http.js';

export async function POST(request: Request): Promise<Response> {
  try {
    // 로그인한 사용자만. 사용자 id는 검증된 토큰에서만 정한다.
    const { userId } = await requireUser(request);
    const body: ChatResponse = await runChat(userId, await readChatRequest(request));
    return json(body); // 질문·답변·모든 오류는 CDN/브라우저 캐시 제외
  } catch (error) {
    return errorResponse(error);
  }
}
