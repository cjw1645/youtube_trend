import type { Video } from '../types/video';

export const FAVORITES_KEY = 'youtube-trend:favorites:v1';
export const FAVORITES_READ_ERROR =
  '관심 영상 저장 데이터를 읽지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.';
export const FAVORITES_WRITE_ERROR =
  '관심 영상을 저장하지 못했습니다. 저장 공간 또는 브라우저 저장소 설정을 확인한 뒤 다시 시도해 주세요.';
const CORRUPT_DATA =
  '저장된 관심 영상 데이터 일부가 손상되어 표시하지 못했습니다. 영상을 다시 저장하면 정상 데이터로 갱신됩니다.';

export interface FavoritesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FavoritesState {
  videos: Video[];
  error: string | null;
}

// 상세 데이터가 들어와도 목록 표시용 메타데이터만 저장한다.
export function snapshotVideo(video: Video): Video {
  return {
    id: video.id,
    title: video.title,
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: video.publishedAt,
    categoryId: video.categoryId,
    durationSeconds: video.durationSeconds,
    viewCount: video.viewCount,
    likeCount: video.likeCount,
    commentCount: video.commentCount,
  };
}

function isVideo(value: unknown): value is Video {
  if (!value || typeof value !== 'object') return false;
  const video = value as Record<string, unknown>;
  if (typeof video.id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(video.id)) return false;
  if (
    !['title', 'channelId', 'channelTitle', 'thumbnailUrl', 'publishedAt', 'categoryId'].every(
      (key) => typeof video[key] === 'string',
    )
  )
    return false;
  if (!Number.isFinite(Date.parse(video.publishedAt as string))) return false;
  if (
    typeof video.durationSeconds !== 'number' ||
    !Number.isFinite(video.durationSeconds) ||
    video.durationSeconds < 0
  )
    return false;
  return ['viewCount', 'likeCount', 'commentCount'].every(
    (key) =>
      video[key] === null ||
      (typeof video[key] === 'number' && Number.isFinite(video[key]) && video[key] >= 0),
  );
}

export function readFavorites(getStorage: () => FavoritesStorage): FavoritesState {
  let raw: string | null;
  try {
    raw = getStorage().getItem(FAVORITES_KEY);
  } catch {
    return { videos: [], error: FAVORITES_READ_ERROR };
  }
  if (raw === null) return { videos: [], error: null };

  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') throw new Error('Invalid format');
    const envelope = data as { version?: unknown; items?: unknown };
    if (envelope.version !== 1 || !Array.isArray(envelope.items)) throw new Error('Invalid format');
    const videos = new Map<string, Video>();
    let corrupted = false;
    for (const item of envelope.items) {
      if (isVideo(item)) {
        if (!videos.has(item.id)) videos.set(item.id, snapshotVideo(item));
      } else corrupted = true;
    }
    return { videos: [...videos.values()], error: corrupted ? CORRUPT_DATA : null };
  } catch {
    return { videos: [], error: CORRUPT_DATA };
  }
}

export function writeFavorites(getStorage: () => FavoritesStorage, videos: Video[]): string | null {
  try {
    const unique = new Map(videos.map((video) => [video.id, snapshotVideo(video)]));
    getStorage().setItem(
      FAVORITES_KEY,
      JSON.stringify({ version: 1, items: [...unique.values()] }),
    );
    return null;
  } catch {
    return FAVORITES_WRITE_ERROR;
  }
}
