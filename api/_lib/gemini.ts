// 서버 전용 Gemini REST 래퍼. 모델/가격 확인일: 2026-10-06.
// https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
// https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite
import './env.js';
import { ApiFailure } from './http.js';
import { injectTestFailure } from './runtime.js';

export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_TIMEOUT_MS = 25_000;
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface GeminiInput {
  /** 서버가 작성한 지시문만 사용한다. 클라이언트가 제공하는 지시문은 받지 않는다. */
  systemInstruction: string;
  /** 서버가 검증·보완한 질문 및 영상 메타데이터를 텍스트로 전달한다. */
  prompt: string;
}

export interface GeminiResult {
  text: string;
  model: typeof GEMINI_MODEL;
}

function upstreamFailure(): ApiFailure {
  return new ApiFailure('UPSTREAM_ERROR', 'Gemini에서 답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.', 502);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readAnswer(body: unknown): string {
  if (!isObject(body)) throw upstreamFailure();
  if (isObject(body.promptFeedback) && body.promptFeedback.blockReason) {
    throw new ApiFailure('UPSTREAM_ERROR', 'Gemini가 이 요청에 답변할 수 없습니다. 질문을 바꿔 다시 시도해 주세요.', 502);
  }
  const candidate: unknown = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
  if (!isObject(candidate)) {
    throw new ApiFailure('EMPTY_RESPONSE', 'Gemini가 빈 답변을 반환했습니다. 다시 시도해 주세요.', 502);
  }
  // 잘린 답변·안전 차단을 완전한 분석 답변으로 표시하지 않는다.
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new ApiFailure('UPSTREAM_ERROR', 'Gemini 답변이 길이 제한으로 중단되었습니다. 질문을 줄여 다시 시도해 주세요.', 502);
  }
  if (candidate.finishReason !== 'STOP') {
    throw new ApiFailure('UPSTREAM_ERROR', 'Gemini가 답변을 완료하지 못했습니다. 질문을 바꿔 다시 시도해 주세요.', 502);
  }
  const content = candidate.content;
  const parts: unknown[] = isObject(content) && Array.isArray(content.parts) ? content.parts : [];
  const text = parts.filter(isObject)
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('').trim();
  if (!text) throw new ApiFailure('EMPTY_RESPONSE', 'Gemini가 빈 답변을 반환했습니다. 다시 시도해 주세요.', 502);
  return text;
}

/** 단일 호출만 수행한다. 자동 재시도·다른 모델 fallback·fixture 답변은 없다. */
export async function generateContent(input: GeminiInput): Promise<GeminiResult> {
  injectTestFailure('gemini');
  if (!input.prompt.trim() || !input.systemInstruction.trim()) {
    throw new ApiFailure('BAD_REQUEST', 'Gemini 요청의 질문 또는 서버 지시문이 비어 있습니다.', 400);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ApiFailure('CONFIG_ERROR', '서버에 Gemini API Key가 설정되어 있지 않습니다.', 500);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: { candidateCount: 1, maxOutputTokens: 4096 },
      }),
    });
    if (response.status === 429) {
      throw new ApiFailure('QUOTA_EXCEEDED', 'Gemini 무료 사용 한도 또는 요청 빈도를 초과했습니다. 잠시 후 다시 시도해 주세요.', 429);
    }
    if ([400, 401, 403, 404].includes(response.status)) {
      throw new ApiFailure('CONFIG_ERROR', '서버의 Gemini 모델 또는 API 설정에 문제가 있습니다. 관리자에게 문의해 주세요.', 500);
    }
    if (!response.ok) throw upstreamFailure();
    const body: unknown = await response.json();
    if (controller.signal.aborted) throw new Error('Request deadline');
    return { text: readAnswer(body), model: GEMINI_MODEL };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiFailure('TIMEOUT', 'Gemini 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.', 504);
    }
    if (error instanceof ApiFailure) throw error;
    // fetch/JSON 오류 원문에는 URL·인증 정보가 포함될 수 있어 전달하거나 로그하지 않는다.
    throw upstreamFailure();
  } finally {
    clearTimeout(timer);
  }
}
