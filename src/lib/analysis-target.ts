import {
  selectChatVideos,
  TARGET_SOURCES,
  validRanking,
  type ChatTarget,
  type TargetSource,
} from './chat-session';
import type { VideoQuery } from '../hooks/useVideos';

export const TARGET_KEY = 'youtube-trend:targets:v1';
export const MAX_TARGET_BYTES = 128 * 1024;
export const SESSION_TTL = 24 * 60 * 60 * 1000;
export interface AnalysisTarget extends ChatTarget {
  source: TargetSource;
  capturedAt: number;
  query?: VideoQuery;
}
export function validTimestamp(value: unknown, now = Date.now()): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now + 300_000;
}
export function validTime(value: unknown, now = Date.now()): value is number {
  return validTimestamp(value, now) && now - value <= SESSION_TTL;
}
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function textWithin(value: unknown, max: number): value is string {
  return typeof value === 'string' && [...value].length <= max;
}
export function validVideos(value: unknown): value is { id: string; title: string }[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 20 &&
    value.every(
      (v) =>
        object(v) &&
        typeof v.id === 'string' &&
        /^[A-Za-z0-9_-]{11}$/.test(v.id) &&
        textWithin(v.title, 500),
    ) &&
    new Set(value.map((v) => v.id)).size === value.length
  );
}
export function validQuery(value: unknown): value is VideoQuery {
  return (
    object(value) &&
    textWithin(value.q, 100) &&
    typeof value.categoryId === 'string' &&
    /^(?:\d{1,5})?$/.test(value.categoryId) &&
    typeof value.order === 'string' &&
    ['', 'date', 'viewCount'].includes(value.order)
  );
}
export function validTarget(value: unknown, now = Date.now()): value is AnalysisTarget {
  return (
    object(value) &&
    typeof value.source === 'string' &&
    TARGET_SOURCES.includes(value.source as TargetSource) &&
    validRanking(value) &&
    textWithin(value.label, 300) &&
    validTime(value.capturedAt, now) &&
    validVideos(value.videos) &&
    (value.query === undefined || validQuery(value.query)) &&
    (value.source !== 'detail' || value.videos.length === 1)
  );
}
export function makeTarget(
  value: ChatTarget,
  source: AnalysisTarget['source'],
  query?: VideoQuery,
): AnalysisTarget | null {
  const videos = selectChatVideos(value.videos);
  return videos.length
    ? {
        label: value.label,
        source,
        videos,
        capturedAt: value.capturedAt ?? Date.now(),
        ...(query ? { query: { ...query } } : {}),
        ...(value.rankingSource ? { rankingSource: value.rankingSource } : {}),
        ...(value.popularRank ? { popularRank: { ...value.popularRank } } : {}),
      }
    : null;
}
export interface TargetStore {
  active: AnalysisTarget | null;
  lastHome: AnalysisTarget | null;
}
export function persistTargets(storage: Pick<Storage, 'setItem'>, data: TargetStore): void {
  const encoded = JSON.stringify({ version: 1, ...data });
  // 저장 실패 시 메모리 대상은 유지하며 오래된 기록의 복원 가능성은 화면에서 안내한다.
  if (new TextEncoder().encode(encoded).length > MAX_TARGET_BYTES)
    throw new Error('Target record exceeds storage limit');
  storage.setItem(TARGET_KEY, encoded);
}
export function readTargets(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  now = Date.now(),
): { data: TargetStore; notice: string } {
  const empty = { active: null, lastHome: null };
  try {
    const raw = storage.getItem(TARGET_KEY);
    if (!raw) return { data: empty, notice: '' };
    let data: unknown = null;
    try {
      if (
        raw.length <= MAX_TARGET_BYTES &&
        new TextEncoder().encode(raw).length <= MAX_TARGET_BYTES
      )
        data = JSON.parse(raw);
    } catch {
      /* 손상 JSON도 앱 소유 레코드를 폐기한다. */
    }
    if (
      !object(data) ||
      data.version !== 1 ||
      (data.active !== null && !validTarget(data.active, now)) ||
      (data.lastHome !== null && !validTarget(data.lastHome, now))
    ) {
      storage.removeItem(TARGET_KEY);
      return { data: empty, notice: '만료되었거나 손상된 대상 기록을 버렸습니다.' };
    }
    return {
      data: {
        active: data.active as AnalysisTarget | null,
        lastHome: data.lastHome as AnalysisTarget | null,
      },
      notice: '',
    };
  } catch {
    return {
      data: empty,
      notice: '대상 기록을 복원하지 못했습니다. 이 탭의 메모리에서 계속 사용할 수 있습니다.',
    };
  }
}
