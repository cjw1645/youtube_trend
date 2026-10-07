// 현재 화면에 조회된 영상의 태그·제목 단어를 집계한다. 추가 API 호출 없이 목록 데이터만 사용한다.

/** 정규화 후 비교하는 불용어. 형식·플랫폼 표기와 의미가 약한 영어 단어를 제외한다. */
export const KEYWORD_STOPWORDS: ReadonlySet<string> = new Set([
  '공식',
  '영상',
  '채널',
  '구독',
  '좋아요',
  '예고',
  '자막',
  '최초공개',
  '이유',
  '진짜',
  '오늘',
  '지금',
  '결국',
  '최고',
  '최대',
  '역대',
  '모든',
  'official',
  'mv',
  'm/v',
  'shorts',
  'short',
  'ep',
  'episode',
  'teaser',
  'trailer',
  'live',
  'full',
  'ver',
  'version',
  'feat',
  'ft',
  'video',
  'audio',
  'music',
  'lyrics',
  'clip',
  'hd',
  '4k',
  'eng',
  'kor',
  'sub',
  'the',
  'and',
  'of',
  'in',
  'on',
  'with',
  'for',
  'to',
  'by',
  'my',
  'vs',
  'you',
  'your',
  'it',
  'is',
  'are',
  'we',
  'me',
  'this',
  'that',
  'what',
  'how',
  'why',
  'all',
  'at',
  'from',
]);

/** 숫자만, 또는 회차·순번 표기(1화, 2회, ep3, 제4화, part2 등) */
const EPISODE_PATTERN =
  /^(?:제)?(?:ep|e|s|part|pt|vol|no)?\.?\d+(?:화|회|편|부|탄|기|차|위|등|번째)?$/;
/** ㅋㅋ·ㅎㅎ·ㅠㅠ 같은 감탄 자모 반복 */
const JAMO_PATTERN = /^[ㄱ-ㅎㅏ-ㅣ]+$/;
const EDGE_PATTERN = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const TITLE_SEPARATOR = /[\s|/\\·•,.!?"'“”‘’()[\]{}<>【】「」『』〈〉《》~…:;+=*&^%$@]+/u;

export interface KeywordCount {
  keyword: string;
  /** 키워드가 등장한 채널 수 (같은 채널의 반복 태그는 1회) */
  channels: number;
  /** 키워드가 등장한 영상 수 (한 영상 안의 중복은 1회) */
  videos: number;
}

/** 소문자, # 제거, 앞뒤 공백·특수문자 제거. 불용어·숫자/회차·자모 반복·1글자는 null. */
export function normalizeKeyword(raw: string): string | null {
  const keyword = raw.toLowerCase().replace(/#/g, '').replace(EDGE_PATTERN, '').trim();
  if ([...keyword].length < 2) return null;
  if (KEYWORD_STOPWORDS.has(keyword) || EPISODE_PATTERN.test(keyword) || JAMO_PATTERN.test(keyword))
    return null;
  return keyword;
}

/** 한 영상의 태그와 제목 단어를 중복 없이 모은다. */
export function videoKeywords(video: { title: string; tags?: readonly string[] }): Set<string> {
  const keywords = new Set<string>();
  for (const raw of [...(video.tags ?? []), ...video.title.split(TITLE_SEPARATOR)]) {
    const keyword = normalizeKeyword(raw);
    if (keyword) keywords.add(keyword);
  }
  return keywords;
}

/**
 * 2개 이상 채널에 등장한 키워드를 채널 수 → 영상 수 내림차순으로 상위 limit개 반환한다.
 * 한 채널이 여러 영상에 단 같은 태그가 목록 전체의 흐름처럼 보이지 않게 채널 수를 기준으로 한다.
 * 동률이면 목록에서 먼저 등장한 키워드가 앞선다.
 */
export function aggregateKeywords(
  videos: readonly { title: string; channelId: string; tags?: readonly string[] }[],
  limit = 10,
  minChannels = 2,
): KeywordCount[] {
  const counts = new Map<string, { channels: Set<string>; videos: number }>();
  for (const video of videos)
    for (const keyword of videoKeywords(video)) {
      const entry = counts.get(keyword) ?? { channels: new Set<string>(), videos: 0 };
      entry.channels.add(video.channelId);
      entry.videos += 1;
      counts.set(keyword, entry);
    }
  return [...counts]
    .map(([keyword, entry], order) => ({
      keyword,
      channels: entry.channels.size,
      videos: entry.videos,
      order,
    }))
    .filter(({ channels }) => channels >= minChannels)
    .sort((a, b) => b.channels - a.channels || b.videos - a.videos || a.order - b.order)
    .slice(0, limit)
    .map(({ keyword, channels, videos }) => ({ keyword, channels, videos }));
}
