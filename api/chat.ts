import type { ChatResponse } from '../src/types/chat.js';
import { readChatRequest } from './_lib/chat-input.js';
import { generateContent } from './_lib/gemini.js';
import { getAnalysisContext } from './_lib/youtube.js';
import { errorResponse, json } from './_lib/http.js';
import { buildChatInput, buildChatStats, renderChatReferences } from './_lib/chat-prompt.js';

export async function POST(request: Request): Promise<Response> {
  try {
    const { question, videoIds, source, popularRanks } = await readChatRequest(request);
    const context = await getAnalysisContext(videoIds);
    const now = Date.now();
    const result = await generateContent(
      buildChatInput(question, context, { source, popularRanks }, now),
    );
    // 화면의 근거 미니카드를 답변과 같은 서버 기준 순서로 보여준다.
    const { topRanking } = buildChatStats(context, { source, popularRanks }, now);
    const body: ChatResponse = {
      answer: renderChatReferences(result.text, context),
      model: result.model,
      question,
      context,
      ranking: { basisLabel: topRanking.basisLabel, ids: topRanking.items.map((item) => item.id) },
    };
    return json(body); // 질문·답변·모든 오류는 CDN/브라우저 캐시 제외
  } catch (error) {
    return errorResponse(error);
  }
}
