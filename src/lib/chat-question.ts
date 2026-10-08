/** 질문이 의미 있는 글자를 담고 있는지 본다. 자모만("ㅁㄴㅇ")이거나 기호·숫자뿐이면 AI를 부르지 않는다. */
export function isMeaninglessQuestion(question: string): boolean {
  const syllables = (question.match(/[가-힣]/g) ?? []).length;
  const latinWords = (question.match(/[A-Za-z]{2,}/g) ?? []).length;
  return syllables < 2 && latinWords < 1;
}

export const MEANINGLESS_QUESTION_MESSAGE =
  '질문의 뜻을 알 수 없어요. 영상에 대해 궁금한 점을 문장으로 적어 주세요. 예) 이 영상들의 공통점이 뭐야?';
