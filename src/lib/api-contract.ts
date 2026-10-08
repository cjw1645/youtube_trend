import type { ApiErrorCode } from '../types/video';

type RecordValue = Record<string, unknown>;
const ERROR_CODES = new Set<ApiErrorCode>([
  'QUOTA_EXCEEDED',
  'UNAUTHORIZED',
  'CONFIG_ERROR',
  'BAD_REQUEST',
  'NOT_FOUND',
  'UPSTREAM_ERROR',
  'TIMEOUT',
  'EMPTY_RESPONSE',
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
  'INTERRUPTED',
]);

export function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && ERROR_CODES.has(value as ApiErrorCode);
}

const hasStringFields = (value: RecordValue, keys: string[]) =>
  keys.every((key) => typeof value[key] === 'string');
const isNullableCount = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const isDateString = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const areUniqueVideoIds = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id)) &&
  new Set(value).size === value.length;

function isVideo(value: unknown): value is RecordValue {
  return (
    isRecord(value) &&
    hasStringFields(value, [
      'id',
      'title',
      'channelId',
      'channelTitle',
      'thumbnailUrl',
      'categoryId',
    ]) &&
    areUniqueVideoIds([value.id]) &&
    isDateString(value.publishedAt) &&
    typeof value.durationSeconds === 'number' &&
    Number.isFinite(value.durationSeconds) &&
    value.durationSeconds >= 0 &&
    ['viewCount', 'likeCount', 'commentCount'].every((key) => isNullableCount(value[key])) &&
    (value.tags === undefined ||
      (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string')))
  );
}

function isAnalysisVideo(value: unknown): value is RecordValue {
  return (
    isRecord(value) &&
    hasStringFields(value, ['id', 'title', 'description', 'channelTitle']) &&
    areUniqueVideoIds([value.id]) &&
    isDateString(value.publishedAt) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    (value.category === null || typeof value.category === 'string') &&
    ['viewCount', 'likeCount', 'commentCount', 'subscriberCount'].every((key) =>
      isNullableCount(value[key]),
    )
  );
}

// TypeScript의 타입 단언은 외부 JSON을 검증하지 않으므로 화면에서 사용하기 전에 확인한다.
export function validApiResponse(path: string, body: unknown): boolean {
  if (!isRecord(body)) return false;
  const pathname = path.split('?')[0];
  if (pathname === '/api/videos') return Array.isArray(body.items) && body.items.every(isVideo);
  if (pathname === '/api/favorites')
    return (
      (Array.isArray(body.ids) && body.ids.every((id) => typeof id === 'string')) ||
      body.ok === true
    );
  if (pathname === '/api/account') return body.ok === true;
  // 저장된 집계·스냅샷: 서버가 만든 응답이며 형태(최상위 키)만 확인한다. 내부 값은 화면이 null을 허용해 읽는다.
  if (pathname === '/api/trend' || pathname === '/api/search-trend')
    return body.trend === null || isRecord(body.trend);
  if (pathname === '/api/search-compare') return body.compare === null || isRecord(body.compare);
  if (pathname === '/api/conversations')
    return Array.isArray(body.conversations) || Array.isArray(body.messages) || body.ok === true;
  if (pathname === '/api/snapshot') return body.snapshot === null || isRecord(body.snapshot);
  if (pathname === '/api/search-snapshot' || pathname === '/api/search-slots')
    return Array.isArray(body.slots) || typeof body.slot === 'number' || body.ok === true;
  if (pathname === '/api/categories')
    return (
      Array.isArray(body.items) &&
      body.items.every((item) => isRecord(item) && hasStringFields(item, ['id', 'title']))
    );
  const detail = pathname.match(/^\/api\/video\/([A-Za-z0-9_-]{11})$/);
  if (detail)
    return (
      isVideo(body) &&
      body.id === detail[1] &&
      hasStringFields(body, ['description', 'channelThumbnailUrl']) &&
      Array.isArray(body.tags) &&
      body.tags.every((tag) => typeof tag === 'string') &&
      isNullableCount(body.subscriberCount)
    );
  if (pathname !== '/api/chat') return false;
  if (
    !hasStringFields(body, ['answer', 'model', 'question']) ||
    !(body.answer as string).trim() ||
    !isRecord(body.context)
  )
    return false;
  const context = body.context;
  if (
    !areUniqueVideoIds(context.requestedIds) ||
    context.requestedIds.length < 1 ||
    context.requestedIds.length > 20 ||
    !areUniqueVideoIds(context.analyzedIds) ||
    !areUniqueVideoIds(context.excludedIds) ||
    !Array.isArray(context.videos) ||
    !context.videos.every(isAnalysisVideo)
  )
    return false;
  const combined = [...context.analyzedIds, ...context.excludedIds];
  return (
    context.analyzedIds.length > 0 &&
    areUniqueVideoIds(combined) &&
    combined.length === context.requestedIds.length &&
    combined.every((id) => (context.requestedIds as string[]).includes(id)) &&
    context.videos.length === context.analyzedIds.length &&
    context.videos.every((item, index) => item.id === (context.analyzedIds as string[])[index])
  );
}

export function matchesChatRequest(request: unknown, response: unknown): boolean {
  if (
    !isRecord(request) ||
    typeof request.question !== 'string' ||
    !Array.isArray(request.videoIds) ||
    !isRecord(response) ||
    !isRecord(response.context)
  )
    return false;
  const requested = [...new Set(request.videoIds)];
  return (
    response.question === request.question.trim() &&
    JSON.stringify(response.context.requestedIds) === JSON.stringify(requested)
  );
}
