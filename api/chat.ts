import type { ChatResponse } from '../src/types/chat.js';
import { readChatRequest } from './_lib/chat-input.js';
import { generateContent } from './_lib/gemini.js';
import { getAnalysisContext } from './_lib/youtube.js';
import { errorResponse, json } from './_lib/http.js';
import { buildChatInput } from './_lib/chat-prompt.js';

export async function POST(request: Request): Promise<Response> {
  try {
    const { question, videoIds } = await readChatRequest(request);
    const context = await getAnalysisContext(videoIds);
    const result = await generateContent(buildChatInput(question, context));
    const body: ChatResponse = { answer: result.text, model: result.model, question, context };
    return json(body); // 질문·답변·모든 오류는 CDN/브라우저 캐시 제외
  } catch (error) {
    return errorResponse(error);
  }
}
