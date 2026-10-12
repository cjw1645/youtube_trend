// 모델 답변의 본문 숫자가 입력(근거) 데이터에 있는지 확인한다. 입력에 없는 큰 숫자는 모델이 지어냈거나
// 잘못 계산한 값일 수 있다. 판단 기준을 단순하게 두어 정상 답변을 틀렸다고 하지 않는 쪽을 택한다.
import type { GeminiInput, GeminiResult } from './gemini.js';

/** 이 값 미만의 숫자(순위·개수·퍼센트 등 작은 수)는 검사하지 않는다. */
const MIN_CHECKED = 100;
/** 첫 호출이 이 시간(ms)보다 오래 걸렸으면 함수 제한 시간을 지키기 위해 다시 묻지 않는다. */
export const RETRY_WITHIN_MS = 20_000;
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** 숫자와 그 바로 뒤 글자. 「1,000만」처럼 단위가 붙은 숫자는 환산된 표현이라 검사하지 않는다. */
function numbersIn(text: string): { value: number; unitAfter: boolean }[] {
  return [...text.matchAll(NUMBER)].map((match) => ({
    value: Number(match[0].replaceAll(',', '')),
    unitAfter: /^[만억천]/.test(
      text.slice(match.index + match[0].length, match.index + match[0].length + 1),
    ),
  }));
}

/**
 * 답변의 100 이상 숫자 중 입력(프롬프트 전체)에 없는 값. 영상 표시 토큰({{title:ID}})과 날짜·연도 표기는 제외한다.
 * 입력에는 영상 통계·집계·추이·이전 대화·질문이 모두 들어 있으므로 그중 어디에도 없는 숫자만 걸러낸다.
 */
export function ungroundedNumbers(answer: string, promptText: string): number[] {
  const allowed = new Set(numbersIn(promptText).map((entry) => entry.value));
  const text = answer
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\d{4}년/g, ' ');
  const found = numbersIn(text)
    .filter((entry) => !entry.unitAfter && entry.value >= MIN_CHECKED && !allowed.has(entry.value))
    .map((entry) => entry.value);
  return [...new Set(found)];
}

const fmt = (values: readonly number[]) => values.map((v) => v.toLocaleString('ko-KR')).join(', ');

export interface VerifiedResult {
  result: GeminiResult;
  /** 끝까지 입력에서 확인되지 않은 숫자(없으면 빈 배열) */
  unverified: number[];
  retried: boolean;
}

/**
 * 한 번 생성하고, 입력에 없는 숫자가 있으면 그 숫자를 알려 주며 한 번만 다시 쓰게 한다(시간이 남을 때만).
 * 다시 쓴 답이 더 나쁘거나 실패하면 처음 답을 쓴다. 두 번 호출한 경우 토큰 사용량은 합산한다.
 */
export async function generateVerified(
  generate: (input: GeminiInput) => Promise<GeminiResult>,
  input: GeminiInput,
  options: { clock?: () => number; retryWithinMs?: number } = {},
): Promise<VerifiedResult> {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const first = await generate(input);
  const firstBad = ungroundedNumbers(first.text, input.prompt);
  if (!firstBad.length) return { result: first, unverified: [], retried: false };
  if (clock() - started >= (options.retryWithinMs ?? RETRY_WITHIN_MS))
    return { result: first, unverified: firstBad, retried: false };
  try {
    const second = await generate({
      ...input,
      systemInstruction: `${input.systemInstruction}\n\n■ 수정 요청\n직전 답변에 입력 데이터에 없는 숫자(${fmt(firstBad)})가 있었습니다. 같은 형식과 구성으로 다시 쓰되 입력에 있는 숫자만 쓰고, 직접 계산해 만든 숫자는 쓰지 마세요. 확인할 수 없는 내용은 숫자 없이 말하세요.`,
    });
    const usage =
      first.usage || second.usage
        ? {
            inputTokens: (first.usage?.inputTokens ?? 0) + (second.usage?.inputTokens ?? 0),
            outputTokens: (first.usage?.outputTokens ?? 0) + (second.usage?.outputTokens ?? 0),
          }
        : undefined;
    const secondBad = ungroundedNumbers(second.text, input.prompt);
    const better = secondBad.length <= firstBad.length ? second : first;
    return {
      result: { ...better, ...(usage ? { usage } : {}) },
      unverified: better === second ? secondBad : firstBad,
      retried: true,
    };
  } catch {
    return { result: first, unverified: firstBad, retried: false };
  }
}

/** 화면 안내 문구. 끝까지 확인되지 않은 숫자가 있을 때만 쓴다. */
export const unverifiedNotice = (values: readonly number[]) =>
  `답변의 숫자 일부(${fmt(values.slice(0, 5))})는 분석 데이터에서 확인되지 않았습니다. 중요한 수치는 원본 화면에서 다시 확인해 주세요.`;
