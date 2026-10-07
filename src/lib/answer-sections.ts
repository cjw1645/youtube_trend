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
