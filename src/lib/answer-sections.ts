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

/**
 * 단어 경계에서 처음 나온 needle의 위치. 「DAOKO」 안의 「OK」 같은 부분 일치는 제외한다.
 * 앞은 글자·숫자가 아니어야 하고, 뒤는 한국어 조사(…로, …은)가 붙을 수 있어 영문·숫자만 막는다.
 */
function indexOfWord(text: string, needle: string): number {
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) {
    const before = text[index - 1] ?? '';
    const after = text[index + needle.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[A-Za-z0-9]/.test(after)) return index;
  }
  return -1;
}

/** 근거 텍스트에 영상 ID나 원래 제목이 단어로 나온 대상 영상만 등장 순서대로 고른다. */
export function findMentionedVideos(
  text: string,
  videos: readonly AnalysisVideo[],
  limit = 5,
): AnalysisVideo[] {
  return videos
    .map((video) => {
      const indexes = [video.id, video.title.trim().length >= 2 ? video.title.trim() : '']
        .filter(Boolean)
        .map((needle) => indexOfWord(text, needle))
        .filter((index) => index >= 0);
      return { video, index: indexes.length ? Math.min(...indexes) : -1 };
    })
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)
    .slice(0, limit)
    .map(({ video }) => video);
}

export interface AnswerVideoInfo {
  title: string;
  tags?: readonly string[];
}

export type AnswerPart =
  | string
  | {
      kind: 'video';
      id: string;
      label: string;
      title: string;
      /** 원문이 「영상 ID: …」 표기였으면 true. 화면에서는 「영상 제목: …」으로 바꿔 보여준다. */
      labeled: boolean;
    }
  | {
      /** 서버가 태그 참조를 「태그, 태그 (영상 ID: …)」로 치환한 구간 */
      kind: 'tags';
      id: string;
      title: string;
      tags: string[];
    };

/** 표시용 짧은 제목: 20자를 넘으면 자르고 말줄임표를 붙인다. */
export function shortTitle(title: string, max = 20): string {
  const chars = Array.from(title.trim());
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/** 「영상 ID: X」 바로 앞이 X의 태그 목록(전체 또는 태그 1개)과 「 (」로 끝나면 그 태그들을 반환한다. */
function tagsBefore(before: string, tags: readonly string[]): string[] | null {
  if (!before.endsWith(' (')) return null;
  const head = before.slice(0, -2);
  if (tags.length && head.endsWith(tags.join(', '))) return [...tags];
  const single = [...tags].sort((a, b) => b.length - a.length).find((tag) => head.endsWith(tag));
  return single ? [single] : null;
}

/**
 * 요청 대상 영상 ID와 정확히 일치하는 토큰만 짧은 제목 조각으로 나눈다.
 * 앞에 붙은 「영상 ID:」·「ID:」 표기는 조각에 포함해 화면에서 「영상 제목:」으로 바꿀 수 있게 한다.
 * 서버가 치환한 태그 목록 뒤의 「(영상 ID: X)」는 태그 조각으로 묶는다.
 * ID 문자([A-Za-z0-9_-])에 이어진 더 긴 문자열 안의 부분 일치는 바꾸지 않는다. 원문은 변경하지 않는다.
 */
export function splitVideoIds(
  text: string,
  videos: ReadonlyMap<string, AnswerVideoInfo>,
): AnswerPart[] {
  const ids = [...videos.keys()].filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id));
  if (!ids.length) return [text];
  const pattern = new RegExp(
    `((?:영상\\s*)?ID\\s*[:：]?\\s*)?(?<![A-Za-z0-9_-])(${ids.join('|')})(?![A-Za-z0-9_-])`,
    'g',
  );
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const id = match[2];
    const { title, tags = [] } = videos.get(id)!;
    let before = text.slice(last, match.index);
    let end = match.index + match[0].length;
    const cited = match[1] && text[end] === ')' ? tagsBefore(before, tags) : null;
    if (cited) {
      before = before.slice(0, before.length - 2 - cited.join(', ').length);
      end += 1;
    }
    if (before) parts.push(before);
    parts.push(
      cited
        ? { kind: 'tags', id, title, tags: cited }
        : { kind: 'video', id, label: shortTitle(title), title, labeled: !!match[1] },
    );
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** 근거 영상 탐지용: 태그 목록 구간을 빼고 영상 ID는 남긴 텍스트 */
export function withoutTagCitations(
  text: string,
  videos: ReadonlyMap<string, AnswerVideoInfo>,
): string {
  return splitVideoIds(text, videos)
    .map((part) => (typeof part === 'string' ? part : part.kind === 'video' ? part.id : ' '))
    .join('');
}
