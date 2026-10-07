import {
  TARGET_SOURCES,
  validRanking,
  type ChatSnapshot,
  type ChatState,
  type TargetSource,
} from './chat-session';
import type { ChatResponse, AnalysisVideo } from '../types/chat';
import {
  object,
  textWithin,
  validTime,
  validTimestamp,
  validVideos,
  validQuery,
} from './analysis-target';

export const CHAT_KEY = 'youtube-trend:conversation:v1';
export const MAX_CHAT_BYTES = 512 * 1024;
export interface CompletedChat {
  snapshot: ChatSnapshot;
  response: ChatResponse;
  completedAt: number;
}
export interface Conversation {
  version: 1;
  updatedAt: number;
  draft: string;
  entries: CompletedChat[];
  pending: { snapshot: ChatSnapshot; startedAt: number } | null;
}
export const emptyConversation = (): Conversation => ({
  version: 1,
  updatedAt: Date.now(),
  draft: '',
  entries: [],
  pending: null,
});
function validSnapshot(v: unknown): v is ChatSnapshot {
  return (
    object(v) &&
    textWithin(v.question, 2000) &&
    !!v.question.trim() &&
    textWithin(v.label, 300) &&
    validVideos(v.videos) &&
    (v.source === undefined ||
      (typeof v.source === 'string' && TARGET_SOURCES.includes(v.source as TargetSource))) &&
    validRanking(v) &&
    (v.capturedAt === undefined ||
      (typeof v.capturedAt === 'number' &&
        Number.isFinite(v.capturedAt) &&
        v.capturedAt > 0 &&
        v.capturedAt <= Date.now() + 300000)) &&
    (v.query === undefined || validQuery(v.query))
  );
}
function ids(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id)) &&
    new Set(value).size === value.length
  );
}
function validVideo(v: unknown): v is AnalysisVideo {
  return (
    object(v) &&
    typeof v.id === 'string' &&
    /^[A-Za-z0-9_-]{11}$/.test(v.id) &&
    textWithin(v.title, 500) &&
    textWithin(v.description, 200) &&
    Array.isArray(v.tags) &&
    v.tags.length <= 20 &&
    v.tags.every((tag) => textWithin(tag, 100)) &&
    (v.category === null || textWithin(v.category, 200)) &&
    typeof v.publishedAt === 'string' &&
    v.publishedAt.length <= 40 &&
    Number.isFinite(Date.parse(v.publishedAt)) &&
    textWithin(v.channelTitle, 200) &&
    ['viewCount', 'likeCount', 'commentCount', 'subscriberCount'].every(
      (key) =>
        v[key] === null ||
        (typeof v[key] === 'number' && Number.isSafeInteger(v[key]) && (v[key] as number) >= 0),
    )
  );
}
function validCompleted(v: unknown): v is CompletedChat {
  if (
    !object(v) ||
    !validSnapshot(v.snapshot) ||
    !validTimestamp(v.completedAt) ||
    !object(v.response)
  )
    return false;
  const r = v.response;
  if (
    !textWithin(r.answer, 32000) ||
    !r.answer.trim() ||
    !textWithin(r.model, 100) ||
    r.question !== v.snapshot.question ||
    !object(r.context)
  )
    return false;
  const c = r.context;
  if (
    !ids(c.requestedIds) ||
    !ids(c.analyzedIds) ||
    !ids(c.excludedIds) ||
    !Array.isArray(c.videos) ||
    !c.videos.length ||
    c.videos.length > 20 ||
    !c.videos.every(validVideo)
  )
    return false;
  const requested = c.requestedIds,
    analyzed = c.analyzedIds,
    excluded = c.excludedIds;
  return (
    JSON.stringify(requested) === JSON.stringify(v.snapshot.videos.map((video) => video.id)) &&
    JSON.stringify(analyzed) === JSON.stringify(c.videos.map((video) => video.id)) &&
    analyzed.every((id) => requested.includes(id) && !excluded.includes(id)) &&
    excluded.every((id) => requested.includes(id)) &&
    requested.length === analyzed.length + excluded.length
  );
}
export function readConversation(storage: Pick<Storage, 'getItem' | 'removeItem'>): {
  data: Conversation;
  notice: string;
} {
  try {
    const raw = storage.getItem(CHAT_KEY);
    if (!raw) return { data: emptyConversation(), notice: '' };
    let v: unknown = null;
    try {
      if (raw.length <= MAX_CHAT_BYTES && new TextEncoder().encode(raw).length <= MAX_CHAT_BYTES)
        v = JSON.parse(raw);
    } catch {
      /* 손상 JSON은 아래 검증에서 앱 소유 키만 삭제한다. */
    }
    if (
      !object(v) ||
      v.version !== 1 ||
      !validTime(v.updatedAt) ||
      !textWithin(v.draft, 2000) ||
      !Array.isArray(v.entries) ||
      v.entries.length > 10 ||
      !v.entries.every(validCompleted) ||
      !(
        v.pending === null ||
        (object(v.pending) &&
          validSnapshot(v.pending.snapshot) &&
          validTimestamp(v.pending.startedAt))
      )
    ) {
      storage.removeItem(CHAT_KEY);
      return { data: emptyConversation(), notice: '만료되었거나 손상된 대화 기록을 버렸습니다.' };
    }
    return { data: v as unknown as Conversation, notice: '' };
  } catch {
    return {
      data: emptyConversation(),
      notice: '대화 기록을 복원하지 못했습니다. 새로고침 복원이 제한됩니다.',
    };
  }
}
/** 표시 중인 답변을 자르지 않고 저장할 사본만 제한한다. */
export function persistConversation(storage: Pick<Storage, 'setItem'>, data: Conversation): string {
  const copy = {
    ...data,
    entries: data.entries.filter(validCompleted).slice(-10),
    draft: textWithin(data.draft, 2000) ? data.draft : '',
  };
  let limited = copy.entries.length !== data.entries.length || copy.draft !== data.draft;
  let encoded = JSON.stringify(copy);
  while (new TextEncoder().encode(encoded).length > MAX_CHAT_BYTES && copy.entries.length) {
    copy.entries.shift();
    limited = true;
    encoded = JSON.stringify(copy);
  }
  try {
    storage.setItem(CHAT_KEY, encoded);
    return limited
      ? '일부 초안·답변이 저장 한도를 넘어 저장되지 않았습니다. 현재 화면에서는 계속 확인할 수 있습니다.'
      : '';
  } catch {
    return '대화를 메모리에서 사용하고 있습니다. 저장에 실패해 새로고침 복원이 제한됩니다.';
  }
}
export function completedState(entry: CompletedChat): ChatState {
  return { status: 'success', snapshot: entry.snapshot, response: entry.response };
}
