// 키워드·태그 빈도 집계. 목록 데이터만 사용하며 외부 API를 호출하지 않는다.

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
  '이번',
  '돌아온',
  '드디어',
  '처음',
  '다시',
  '그냥',
  '너무',
  '정말',
  '완전',
  '새로운',
  '공개',
  '신곡',
  '모음',
  '리뷰',
  '최신',
  '최근',
  '요즘',
  '함께',
  '같이',
  '우리',
  '모두',
  '바로',
  '결과',
  '이렇게',
  '제대로',
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
  /** 키워드가 등장한 영상 수 (한 영상 안의 중복은 1회, 같은 채널의 영상도 각각 센다) */
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
 * 2개 이상 영상에 등장한 키워드를 영상 수 내림차순으로 상위 limit개 반환한다.
 * 동률이면 목록에서 먼저 등장한 키워드가 앞선다. 현재 검색어와 같은 키워드는 다시 검색해도
 * 같은 결과이므로 제외한다.
 */
export function aggregateKeywords(
  videos: readonly { title: string; tags?: readonly string[] }[],
  {
    limit = 10,
    minVideos = 2,
    query = '',
  }: { limit?: number; minVideos?: number; query?: string } = {},
): KeywordCount[] {
  const excluded = normalizeKeyword(query);
  const counts = new Map<string, number>();
  for (const video of videos)
    for (const keyword of videoKeywords(video)) counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
  return [...counts]
    .map(([keyword, count], order) => ({ keyword, videos: count, order }))
    .filter(({ keyword, videos }) => videos >= minVideos && keyword !== excluded)
    .sort((a, b) => b.videos - a.videos || a.order - b.order)
    .slice(0, limit)
    .map(({ keyword, videos }) => ({ keyword, videos }));
}

export interface StoredKeyword {
  keyword: string;
  videoCount: number;
  channelCount: number;
}

/** 한 번의 수집 목록에서 저장할 키워드 집계의 최대 개수. 28일 보존 용량을 위해 상위만 둔다. */
export const STORED_KEYWORD_LIMIT = 100;
/** 저장·표시 대상이 되는 최소 영상 수. 이 값 미만은 우연한 반복과 구분되지 않는다. */
export const STORED_KEYWORD_MIN_VIDEOS = 2;

/**
 * 수집 목록의 키워드를 영상 수(영상당 1회)·고유 채널 수와 함께 집계한다.
 * 영상 수가 STORED_KEYWORD_MIN_VIDEOS 미만이면 저장하지 않으므로, 저장된 집계에 없는 키워드는
 * 0개가 아니라 「기준 미만 또는 상위 밖」이다. 동률은 키워드 사전순으로 고정한다.
 */
export function storedKeywordCounts(
  videos: readonly { title: string; tags?: readonly string[]; channelId: string }[],
): StoredKeyword[] {
  const counts = new Map<string, { videos: number; channels: Set<string> }>();
  for (const video of videos)
    for (const keyword of videoKeywords(video)) {
      const entry = counts.get(keyword) ?? { videos: 0, channels: new Set<string>() };
      entry.videos += 1;
      entry.channels.add(video.channelId);
      counts.set(keyword, entry);
    }
  return [...counts]
    .filter(([, entry]) => entry.videos >= STORED_KEYWORD_MIN_VIDEOS)
    .map(([keyword, entry]) => ({
      keyword,
      videoCount: entry.videos,
      channelCount: entry.channels.size,
    }))
    .sort((a, b) => b.videoCount - a.videoCount || (a.keyword < b.keyword ? -1 : 1))
    .slice(0, STORED_KEYWORD_LIMIT);
}
