// YouTube Data API v3 래퍼 (서버 전용). YOUTUBE_API_KEY는 이 파일에서만 읽고, 요청 헤더로만 보낸다.
import './env.js';
import type { Category, SortOrder, Video, VideoDetail } from '../../src/types/video.js';
import { ApiFailure } from './http.js';
import type { AnalysisContext } from '../../src/types/chat.js';

const BASE = 'https://www.googleapis.com/youtube/v3';
const REGION = 'KR';
const VIDEO_PART = 'snippet,statistics,contentDetails';
const REQUEST_TIMEOUT_MS = 10_000;

interface Thumbnails {
  [size: string]: { url: string } | undefined;
}

interface RawVideo {
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    channelTitle: string;
    title: string;
    description: string;
    thumbnails: Thumbnails;
    tags?: string[];
    categoryId: string;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

interface RawChannel {
  id: string;
  snippet?: { title: string; thumbnails: Thumbnails };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
}

interface RawCategory {
  id: string;
  snippet: { title: string; assignable: boolean };
}

interface RawSearchItem {
  id: { videoId?: string };
}

interface ListResponse<T> {
  items?: T[];
  nextPageToken?: string;
}

export interface ChannelInfo {
  id: string;
  title: string;
  thumbnailUrl: string;
  subscriberCount: number | null;
}

const QUOTA_REASONS = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);
const CONFIG_REASONS = new Set([
  'keyInvalid',
  'keyExpired',
  'accessNotConfigured',
  'API_KEY_INVALID',
  'API_KEY_SERVICE_BLOCKED',
  'SERVICE_DISABLED',
]);

function toFailure(status: number, body: unknown): ApiFailure {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  // errors[].reason(예: badRequest)과 details[].reason(예: API_KEY_INVALID)이 함께 올 수 있어 모두 확인
  const reasons = [error.errors, error.details]
    .flatMap((entries) => (Array.isArray(entries) ? entries : []))
    .filter(isRecord)
    .map((entry) => entry.reason)
    .filter((reason): reason is string => typeof reason === 'string');
  const reason = reasons[0];

  const quotaReason = reasons.find((r) => QUOTA_REASONS.has(r));
  if (quotaReason || status === 429) {
    return new ApiFailure(
      'QUOTA_EXCEEDED',
      quotaReason === 'quotaExceeded' || quotaReason === 'dailyLimitExceeded'
        ? 'YouTube API 할당량을 초과했습니다. 할당량이 복구된 후 다시 시도해 주세요.'
        : 'YouTube API 호출이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.',
      429,
      quotaReason,
    );
  }
  const configReason = reasons.find((r) => CONFIG_REASONS.has(r));
  if (configReason) {
    return new ApiFailure(
      'CONFIG_ERROR',
      '서버의 YouTube API 설정에 문제가 있습니다. 관리자에게 문의해 주세요.',
      500,
      configReason,
    );
  }
  if (status === 404)
    return new ApiFailure('NOT_FOUND', '요청한 데이터를 찾을 수 없습니다.', 404, reason);
  if (status === 400) return new ApiFailure('BAD_REQUEST', '잘못된 요청입니다.', 400, reason);
  return new ApiFailure(
    'UPSTREAM_ERROR',
    'YouTube에서 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    502,
    reason,
  );
}

async function ytFetch<T>(resource: string, params: Record<string, string>): Promise<T> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new ApiFailure('CONFIG_ERROR', '서버에 YouTube API Key가 설정되어 있지 않습니다.', 500);
  }

  const controller = new AbortController();
  // 응답 헤더뿐 아니라 본문 수신에도 같은 제한을 적용한다. 자동 재시도는 하지 않는다.
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${resource}?${new URLSearchParams(params)}`, {
      headers: { 'X-Goog-Api-Key': apiKey },
      signal: controller.signal,
    });
    const body: unknown = await res.json().catch(() => null);
    controller.signal.throwIfAborted();
    if (!res.ok) throw toFailure(res.status, body);
    if (
      !isRecord(body) ||
      !Array.isArray(body.items) ||
      !body.items.every((item) => validItem(resource, item))
    ) {
      throw new ApiFailure('UPSTREAM_ERROR', 'YouTube 응답 형식이 올바르지 않습니다.', 502);
    }
    return body as T;
  } catch (error) {
    if (controller.signal.aborted)
      throw new ApiFailure(
        'TIMEOUT',
        'YouTube 응답 시간이 초과되었습니다. 다시 시도해 주세요.',
        504,
      );
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure('UPSTREAM_ERROR', 'YouTube 서버에 연결하지 못했습니다.', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validItem(resource: string, value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (resource === 'search')
    return (
      isRecord(value.id) && (value.id.videoId === undefined || typeof value.id.videoId === 'string')
    );
  if (typeof value.id !== 'string') return false;
  const statistics = value.statistics;
  if (
    statistics !== undefined &&
    (!isRecord(statistics) ||
      !['viewCount', 'likeCount', 'commentCount', 'subscriberCount'].every(
        (key) => statistics[key] === undefined || typeof statistics[key] === 'string',
      ))
  )
    return false;
  if (
    resource === 'channels' &&
    isRecord(statistics) &&
    statistics.hiddenSubscriberCount !== undefined &&
    typeof statistics.hiddenSubscriberCount !== 'boolean'
  )
    return false;
  if (resource === 'videoCategories')
    return (
      isRecord(value.snippet) &&
      typeof value.snippet.title === 'string' &&
      typeof value.snippet.assignable === 'boolean'
    );
  if (resource === 'channels' && value.snippet === undefined) return true;
  if (
    !isRecord(value.snippet) ||
    !isRecord(value.snippet.thumbnails) ||
    !Object.values(value.snippet.thumbnails).every(
      (thumbnail) => isRecord(thumbnail) && typeof thumbnail.url === 'string',
    )
  )
    return false;
  if (resource === 'channels') return typeof value.snippet.title === 'string';
  const snippet = value.snippet;
  return (
    ['title', 'description', 'publishedAt', 'channelId', 'channelTitle', 'categoryId'].every(
      (key) => typeof snippet[key] === 'string',
    ) &&
    (snippet.tags === undefined ||
      (Array.isArray(snippet.tags) && snippet.tags.every((tag) => typeof tag === 'string'))) &&
    (value.contentDetails === undefined ||
      (isRecord(value.contentDetails) &&
        (value.contentDetails.duration === undefined ||
          typeof value.contentDetails.duration === 'string')))
  );
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function pickThumbnail(thumbnails: Thumbnails): string {
  return (thumbnails.high ?? thumbnails.medium ?? thumbnails.default)?.url ?? '';
}

/** ISO 8601 기간(PT1H2M3S, P1DT2H 등) → 초 */
function parseDuration(iso: string | undefined): number {
  const m = iso?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, d = '0', h = '0', min = '0', s = '0'] = m;
  return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(s);
}

function toVideo(raw: RawVideo): Video {
  return {
    id: raw.id,
    title: raw.snippet.title,
    channelId: raw.snippet.channelId,
    channelTitle: raw.snippet.channelTitle,
    thumbnailUrl: pickThumbnail(raw.snippet.thumbnails),
    publishedAt: raw.snippet.publishedAt,
    categoryId: raw.snippet.categoryId,
    durationSeconds: parseDuration(raw.contentDetails?.duration),
    viewCount: toNumber(raw.statistics?.viewCount),
    likeCount: toNumber(raw.statistics?.likeCount),
    commentCount: toNumber(raw.statistics?.commentCount),
    tags: raw.snippet.tags ?? [],
  };
}

function toChannel(raw: RawChannel): ChannelInfo {
  const hidden = raw.statistics?.hiddenSubscriberCount;
  return {
    id: raw.id,
    title: raw.snippet?.title ?? '',
    thumbnailUrl: raw.snippet ? pickThumbnail(raw.snippet.thumbnails) : '',
    subscriberCount: hidden ? null : toNumber(raw.statistics?.subscriberCount),
  };
}

export function sortVideos(videos: Video[], order?: SortOrder): Video[] {
  if (order === 'viewCount')
    return [...videos].sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
  if (order === 'date')
    return [...videos].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return videos;
}

export async function listPopularVideos(): Promise<Video[]> {
  const { items = [] } = await ytFetch<ListResponse<RawVideo>>('videos', {
    part: VIDEO_PART,
    chart: 'mostPopular',
    regionCode: REGION,
    hl: 'ko',
    maxResults: '50',
  });
  // API 제공 순서 = YouTube 인기 순위. 화면에서 다시 정렬해도 AI 분석의 인기순 기준으로 쓴다.
  return items.map((raw, index) => ({ ...toVideo(raw), popularRank: index + 1 }));
}

/** 인기 차트 상한: 페이지당 50개 × 4페이지 */
/** 인기 차트 한 번에 읽는 최대 페이지 수(= 최대 호출 수) */
export const POPULAR_MAX_PAGES = 4;

/** 전체 인기 차트를 pageToken으로 끝까지 수집한다(페이지당 1 unit). 한 페이지라도 실패하면 전체를 실패로 처리한다. */
export async function listAllPopularVideos(): Promise<Video[]> {
  const videos: Video[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < POPULAR_MAX_PAGES; page += 1) {
    const { items = [], nextPageToken } = await ytFetch<ListResponse<RawVideo>>('videos', {
      part: VIDEO_PART,
      chart: 'mostPopular',
      regionCode: REGION,
      hl: 'ko',
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const raw of items) {
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      videos.push({ ...toVideo(raw), popularRank: videos.length + 1 });
    }
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }
  return videos;
}

export interface SnapshotVideo {
  id: string;
  /** 수집 목록 안의 API 반환 순서(1부터). 전체 YouTube 순위가 아니다. */
  position: number;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  channelId: string;
  publishedAt: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

export interface SnapshotChannel {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  hidden: boolean;
}

export interface PopularSnapshot {
  videos: SnapshotVideo[];
  channels: SnapshotChannel[];
  pagesFetched: number;
  /** 모든 페이지·채널 조회가 성공했고 영상이 1개 이상일 때만 true */
  complete: boolean;
  /** 시도한 YouTube 호출 수(실패 포함, 호출당 1 unit으로 보수적으로 계산) */
  units: number;
  errorCode?: string;
}

/**
 * 공통 수집용: KR 인기 목록 최대 4페이지와 채널 정보를 모은다. 자동 재시도는 하지 않는다.
 * 한 번이라도 실패하면 거기서 멈추고 complete=false로 돌려준다(부분 결과는 저장하지 않는다).
 */
export async function collectPopularSnapshot(): Promise<PopularSnapshot> {
  const raws: RawVideo[] = [];
  const seen = new Set<string>();
  let units = 0;
  let pagesFetched = 0;
  const fail = (error: unknown): PopularSnapshot => ({
    videos: [],
    channels: [],
    pagesFetched,
    complete: false,
    units,
    errorCode: error instanceof ApiFailure ? error.code : 'INTERNAL_ERROR',
  });

  let pageToken: string | undefined;
  for (let page = 0; page < POPULAR_MAX_PAGES; page += 1) {
    units += 1;
    try {
      const { items = [], nextPageToken } = await ytFetch<ListResponse<RawVideo>>('videos', {
        part: VIDEO_PART,
        chart: 'mostPopular',
        regionCode: REGION,
        hl: 'ko',
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      });
      pagesFetched += 1;
      for (const raw of items) {
        if (seen.has(raw.id)) continue;
        seen.add(raw.id);
        raws.push(raw);
      }
      if (!nextPageToken) break;
      pageToken = nextPageToken;
    } catch (error) {
      return fail(error);
    }
  }
  if (!raws.length) return { ...fail(null), errorCode: 'EMPTY_RESPONSE' };

  const channelRaws = new Map<string, RawChannel>();
  const channelIds = [...new Set(raws.map((raw) => raw.snippet.channelId))];
  for (let i = 0; i < channelIds.length; i += 50) {
    units += 1;
    try {
      const { items = [] } = await ytFetch<ListResponse<RawChannel>>('channels', {
        part: 'snippet,statistics',
        id: channelIds.slice(i, i + 50).join(','),
      });
      for (const item of items) channelRaws.set(item.id, item);
    } catch (error) {
      return fail(error);
    }
  }

  return {
    videos: raws.map((raw, index) => toSnapshotVideo(raw, index + 1)),
    channels: [...channelRaws.values()].map(toSnapshotChannel),
    pagesFetched,
    complete: true,
    units,
  };
}

function toSnapshotVideo(raw: RawVideo, position: number): SnapshotVideo {
  return {
    id: raw.id,
    position,
    title: raw.snippet.title,
    description: raw.snippet.description,
    tags: raw.snippet.tags ?? [],
    categoryId: raw.snippet.categoryId,
    channelId: raw.snippet.channelId,
    publishedAt: raw.snippet.publishedAt,
    durationSeconds:
      raw.contentDetails?.duration === undefined
        ? null
        : parseDuration(raw.contentDetails.duration),
    thumbnailUrl: pickThumbnail(raw.snippet.thumbnails) || null,
    viewCount: toNumber(raw.statistics?.viewCount),
    likeCount: toNumber(raw.statistics?.likeCount),
    commentCount: toNumber(raw.statistics?.commentCount),
  };
}

function toSnapshotChannel(raw: RawChannel): SnapshotChannel {
  const hidden = raw.statistics?.hiddenSubscriberCount === true;
  return {
    id: raw.id,
    title: raw.snippet?.title ?? '',
    thumbnailUrl: raw.snippet ? pickThumbnail(raw.snippet.thumbnails) || null : null,
    subscriberCount: hidden ? null : toNumber(raw.statistics?.subscriberCount),
    hidden,
  };
}

export interface SearchConditions {
  query: string;
  order: 'relevance' | 'date' | 'viewCount';
  /** '' 이면 기간 제한 없음 */
  window: '' | '1d' | '7d' | '30d';
}

const WINDOW_MS = { '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
/** 검색 결과 상한: 페이지당 50개 × 4페이지 */
const SEARCH_MAX_PAGES = 4;

/**
 * 개인 검색 수집용: 검색어별 최대 4페이지(200개) 검색 → 50개 단위 영상 보완 → 채널 보완.
 * 검색 순서는 인기 차트 순위가 아니다. 영상 보완에서 사라진(삭제·비공개) ID는 제외한다.
 * searchCalls는 search.list 호출 수(검색 전용 예산), units는 그 밖의 호출 수다. 자동 재시도는 없다.
 */
export async function collectSearchSnapshot(
  conditions: SearchConditions,
  now: Date,
): Promise<PopularSnapshot & { searchCalls: number }> {
  let units = 0;
  let searchCalls = 0;
  let pagesFetched = 0;
  const fail = (error: unknown) => ({
    videos: [],
    channels: [],
    pagesFetched,
    complete: false,
    units,
    searchCalls,
    errorCode: error instanceof ApiFailure ? error.code : 'INTERNAL_ERROR',
  });

  const ids: string[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < SEARCH_MAX_PAGES; page += 1) {
    searchCalls += 1;
    try {
      const { items = [], nextPageToken } = await ytFetch<ListResponse<RawSearchItem>>('search', {
        part: 'id',
        q: conditions.query,
        type: 'video',
        regionCode: REGION,
        relevanceLanguage: 'ko',
        maxResults: '50',
        ...(conditions.order !== 'relevance' ? { order: conditions.order } : {}),
        ...(conditions.window
          ? {
              publishedAfter: new Date(now.getTime() - WINDOW_MS[conditions.window]).toISOString(),
            }
          : {}),
        ...(pageToken ? { pageToken } : {}),
      });
      pagesFetched += 1;
      for (const item of items) {
        const id = item.id.videoId;
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
      if (!nextPageToken) break;
      pageToken = nextPageToken;
    } catch (error) {
      return fail(error);
    }
  }
  if (!ids.length)
    return { videos: [], channels: [], pagesFetched, complete: true, units, searchCalls };

  const byId = new Map<string, RawVideo>();
  for (let i = 0; i < ids.length; i += 50) {
    units += 1;
    try {
      for (const raw of await getRawVideos(ids.slice(i, i + 50))) byId.set(raw.id, raw);
    } catch (error) {
      return fail(error);
    }
  }
  const raws = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));

  const channelRaws = new Map<string, RawChannel>();
  const channelIds = [...new Set(raws.map((raw) => raw.snippet.channelId))];
  for (let i = 0; i < channelIds.length; i += 50) {
    units += 1;
    try {
      const { items = [] } = await ytFetch<ListResponse<RawChannel>>('channels', {
        part: 'snippet,statistics',
        id: channelIds.slice(i, i + 50).join(','),
      });
      for (const item of items) channelRaws.set(item.id, item);
    } catch (error) {
      return fail(error);
    }
  }

  return {
    videos: raws.map((raw, index) => toSnapshotVideo(raw, index + 1)),
    channels: [...channelRaws.values()].map(toSnapshotChannel),
    pagesFetched,
    complete: true,
    units,
    searchCalls,
  };
}

/** 검색의 별도 할당량과 통계 보완 호출을 사용한다. 비용은 공식 문서/프로젝트 설정으로 확인한다. */
export async function searchVideos(q: string): Promise<Video[]> {
  const search = await ytFetch<ListResponse<RawSearchItem>>('search', {
    part: 'id',
    ...(q ? { q } : {}),
    type: 'video',
    regionCode: REGION,
    relevanceLanguage: 'ko',
    maxResults: '50',
  });
  const ids = (search.items ?? []).map((i) => i.id.videoId).filter((id): id is string => !!id);
  if (ids.length === 0) return [];

  const videos = await getRawVideos(ids);
  const rank = new Map(ids.map((id, i) => [id, i]));
  return videos.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)).map(toVideo);
}

async function getRawVideos(ids: string[]): Promise<RawVideo[]> {
  const { items = [] } = await ytFetch<ListResponse<RawVideo>>('videos', {
    part: VIDEO_PART,
    id: ids.slice(0, 50).join(','),
    hl: 'ko',
  });
  return items;
}

/** 관심 영상처럼 ID를 아는 영상을 일괄 조회한다(요청 순서 유지, 없는 영상은 제외). */
export async function getVideosByIds(ids: string[]): Promise<Video[]> {
  const raws = await getRawVideos(ids);
  const byId = new Map(raws.map((raw) => [raw.id, raw]));
  return ids.flatMap((id) => {
    const raw = byId.get(id);
    return raw ? [toVideo(raw)] : [];
  });
}

export async function listCategories(): Promise<Category[]> {
  const { items = [] } = await ytFetch<ListResponse<RawCategory>>('videoCategories', {
    part: 'snippet',
    regionCode: REGION,
    hl: 'ko',
  });
  return items
    .filter((c) => c.snippet.assignable)
    .map((c) => ({ id: c.id, title: c.snippet.title }));
}

/** 지역 목록에 없는 카테고리 ID를 id 조회로 보완한다. assignable 여부와 관계없이 이름만 사용한다. */
export async function listCategoriesById(ids: string[]): Promise<Category[]> {
  const { items = [] } = await ytFetch<ListResponse<RawCategory>>('videoCategories', {
    part: 'snippet',
    id: ids.join(','),
    hl: 'ko',
  });
  return items.map((c) => ({ id: c.id, title: c.snippet.title }));
}

export async function getChannels(ids: string[]): Promise<Map<string, ChannelInfo>> {
  const unique = [...new Set(ids)];
  const raws: RawChannel[] = [];
  for (let i = 0; i < unique.length; i += 50) {
    const { items = [] } = await ytFetch<ListResponse<RawChannel>>('channels', {
      part: 'snippet,statistics',
      id: unique.slice(i, i + 50).join(','),
    });
    raws.push(...items);
  }
  return new Map(raws.map((c) => [c.id, toChannel(c)]));
}

/** 상세: videos.list + channels.list — 2 unit */
export async function getVideoDetail(id: string): Promise<VideoDetail> {
  const [raw] = await getRawVideos([id]);
  if (!raw)
    throw new ApiFailure(
      'NOT_FOUND',
      '영상을 찾을 수 없습니다. 삭제되었거나 비공개일 수 있습니다.',
      404,
    );

  const channel = (await getChannels([raw.snippet.channelId])).get(raw.snippet.channelId);
  return {
    ...toVideo(raw),
    description: raw.snippet.description,
    tags: raw.snippet.tags ?? [],
    channelThumbnailUrl: channel?.thumbnailUrl ?? '',
    subscriberCount: channel?.subscriberCount ?? null,
  };
}

/** 분석 대상만 일괄 조회한다. 목록·상세 API를 영상마다 호출하지 않는다. */
export async function getAnalysisContext(ids: string[]): Promise<AnalysisContext> {
  const requestedIds = [...new Set(ids)];
  if (
    !requestedIds.length ||
    requestedIds.length > 20 ||
    requestedIds.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id))
  ) {
    throw new ApiFailure('BAD_REQUEST', '분석 대상은 올바른 영상 ID 1–20개여야 합니다.', 400);
  }
  const raws = await getRawVideos(requestedIds);
  const byId = new Map(raws.map((raw) => [raw.id, raw]));
  const ordered = requestedIds.flatMap((id) => {
    const raw = byId.get(id);
    return raw ? [raw] : [];
  });
  if (!ordered.length) {
    throw new ApiFailure(
      'NOT_FOUND',
      '분석할 영상이 없습니다. 삭제되었거나 비공개로 전환되었을 수 있습니다.',
      404,
    );
  }
  const [channels, categories] = await Promise.all([
    getChannels(ordered.map((raw) => raw.snippet.channelId)),
    listCategories(),
  ]);
  const categoryNames = new Map(categories.map((category) => [category.id, category.title]));
  const videos = ordered.map((raw) => ({
    id: raw.id,
    title: raw.snippet.title,
    description: Array.from(raw.snippet.description ?? '')
      .slice(0, 200)
      .join(''),
    tags: (raw.snippet.tags ?? [])
      .slice(0, 20)
      .map((tag) => Array.from(tag).slice(0, 100).join('')),
    category: categoryNames.get(raw.snippet.categoryId) ?? null,
    publishedAt: raw.snippet.publishedAt,
    viewCount: toNumber(raw.statistics?.viewCount),
    likeCount: toNumber(raw.statistics?.likeCount),
    commentCount: toNumber(raw.statistics?.commentCount),
    channelTitle: raw.snippet.channelTitle,
    channelId: raw.snippet.channelId,
    subscriberCount: channels.get(raw.snippet.channelId)?.subscriberCount ?? null,
  }));
  return {
    requestedIds,
    analyzedIds: videos.map((video) => video.id),
    excludedIds: requestedIds.filter((id) => !byId.has(id)),
    videos,
  };
}
