import type { AnalysisVideo } from '../types/chat';

export const SECTION_TITLES = ['핵심 요약', '근거 데이터', '콘텐츠 제안'] as const;
export type SectionTitle = (typeof SECTION_TITLES)[number];

export interface AnswerSections {
  intro: string;
  sections: { title: SectionTitle; body: string }[];
}

/**
 * 트렌드 분석 답변의 머리말 3개가 순서대로 줄 머리에 있을 때만 섹션으로 나눈다.
 * 하나라도 없거나 순서가 다르면 null을 반환해 원문 그대로 표시하게 한다.
 */
export function parseAnswerSections(answer: string): AnswerSections | null {
  const positions = SECTION_TITLES.map((title) => {
    const match = new RegExp(`^[ \\t]*\\[${title}\\][ \\t]*$`, 'm').exec(answer);
    return match ? { index: match.index, end: match.index + match[0].length } : null;
  });
  if (positions.some((position) => !position)) return null;
  const found = positions as { index: number; end: number }[];
  if (found.some((position, i) => i > 0 && position.index <= found[i - 1].end)) return null;
  const sections = SECTION_TITLES.map((title, i) => ({
    title,
    body: answer.slice(found[i].end, found[i + 1]?.index ?? answer.length).trim(),
  }));
  if (sections.some((section) => !section.body)) return null;
  return { intro: answer.slice(0, found[0].index).trim(), sections };
}

/** 근거 텍스트에 영상 ID나 원래 제목이 나온 대상 영상만 등장 순서대로 고른다. */
export function findMentionedVideos(
  text: string,
  videos: readonly AnalysisVideo[],
  limit = 5,
): AnalysisVideo[] {
  return videos
    .map((video) => {
      const indexes = [video.id, video.title.trim().length >= 2 ? video.title.trim() : '']
        .filter(Boolean)
        .map((needle) => text.indexOf(needle))
        .filter((index) => index >= 0);
      return { video, index: indexes.length ? Math.min(...indexes) : -1 };
    })
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)
    .slice(0, limit)
    .map(({ video }) => video);
}

export type AnswerPart = string | { id: string; label: string; title: string };

/** 표시용 짧은 제목: 20자를 넘으면 자르고 말줄임표를 붙인다. */
export function shortTitle(title: string, max = 20): string {
  const chars = Array.from(title.trim());
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/**
 * 요청 대상 영상 ID와 정확히 일치하는 토큰만 짧은 제목 조각으로 나눈다.
 * ID 문자([A-Za-z0-9_-])에 이어진 더 긴 문자열 안의 부분 일치는 바꾸지 않는다. 원문은 변경하지 않는다.
 */
export function splitVideoIds(text: string, titles: ReadonlyMap<string, string>): AnswerPart[] {
  const ids = [...titles.keys()].filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id));
  if (!ids.length) return [text];
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(${ids.join('|')})(?![A-Za-z0-9_-])`, 'g');
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const title = titles.get(match[1])!;
    parts.push({ id: match[1], label: shortTitle(title), title });
    last = match.index + match[1].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
