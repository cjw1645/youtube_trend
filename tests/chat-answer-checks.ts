// 로컬 테스트 전용 답변 검사. 서비스 코드에서 쓰지 않는다.

const SECTION_PATTERN = /\[핵심 요약\]|\[근거 데이터\]|\[콘텐츠 제안\]/;
const NUMBER_PATTERN = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

export const hasSections = (answer: string) => SECTION_PATTERN.test(answer);

/** 문장 속 숫자(쉼표 제거). */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(NUMBER_PATTERN)].map((match) => Number(match[0].replaceAll(',', '')));
}

export function firstSentence(answer: string): string {
  return answer.trim().split(/(?<=[.!?])\s+|\n+/)[0] ?? '';
}

/** 첫 문장에 기대 값이 모두 숫자로 들어 있는지. */
export function firstSentenceHas(answer: string, expected: readonly number[]): boolean {
  const found = numbersIn(firstSentence(answer));
  return expected.every((value) => found.some((n) => Math.abs(n - value) < 1e-9));
}

/** buildChatInput이 만든 입력에서 답변이 인용할 수 있는 통계 숫자를 모은다. */
export function allowedNumbers(payload: any): number[] {
  const values: (number | null | undefined)[] = [];
  for (const video of payload.videos)
    values.push(video.viewCount, video.likeCount, video.commentCount, video.subscriberCount);
  const stats = payload.serverStats;
  for (const entry of stats.viewsPerDay) values.push(entry.viewsPerDay);
  for (const item of stats.topRanking.items) values.push(item.viewsPerDay);
  for (const metric of Object.values(stats.aggregates) as any[])
    values.push(
      metric.total,
      metric.nullExcluded,
      metric.sum,
      metric.average,
      metric.median,
      metric.max?.value,
      metric.min?.value,
    );
  for (const entry of stats.categoryDistribution)
    values.push(entry.videoCount, entry.videoSharePercent, entry.viewSharePercent);
  for (const entry of stats.keywords) values.push(entry.videoCount);
  return values.filter((value): value is number => typeof value === 'number');
}

/**
 * 답변의 100 이상 숫자 중 입력 데이터에 없는 값. 제목·태그·채널명·영상 ID·날짜 안의 숫자는
 * 통계 인용이 아니므로 먼저 지운다. 지표 이름이 맞는지는 검사하지 않는다.
 */
export function ungroundedNumbers(answer: string, payload: any): number[] {
  const allowed = allowedNumbers(payload);
  const verbatim = payload.videos
    .flatMap((video: any) => [video.title, video.channelTitle, video.id, ...video.tags])
    .filter((text: string) => text && /\d/.test(text))
    .sort((a: string, b: string) => b.length - a.length);
  let text = answer;
  for (const item of verbatim) text = text.replaceAll(item, ' ');
  text = text.replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\d{4}년/g, ' ');
  return numbersIn(text).filter(
    (value) => value >= 100 && !allowed.some((n) => Math.abs(n - value) < 1e-9),
  );
}
