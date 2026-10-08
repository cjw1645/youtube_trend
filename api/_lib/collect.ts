// 공통 인기 목록 수집 오케스트레이션: 시작(멱등·잠금) → 예산 확보 → YouTube 수집 → 한 트랜잭션 적재 또는 실패 기록.
import { createHash } from 'node:crypto';
import { ApiFailure } from './http.js';
import { storedKeywordCounts } from '../../src/lib/stats/index.js';
import { serviceRpc } from './supabase.js';
import {
  collectPopularSnapshot,
  type PopularSnapshot,
  type SnapshotChannel,
  type SnapshotVideo,
} from './youtube.js';

/** 정상 실행의 예상 호출 수: 인기 4페이지 + 채널 4묶음. 실행 전에 예산에서 확보한다. */
export const RESERVED_UNITS = 8;
/** 하루 YouTube 호출 상한(운영자 내부 기준, 공식 한도 10,000 대비 여유). 환경변수로 낮출 수 있다. */
const DEFAULT_DAILY_UNIT_CAP = 1000;
export const STORAGE_WARN_BYTES = 350 * 1048576;

export type CollectState =
  | 'complete'
  | 'done'
  | 'busy'
  | 'storage_hold'
  | 'budget_exhausted'
  | 'incomplete'
  | 'store_failed';

export interface CollectSummary {
  state: CollectState;
  runId: number | null;
  scheduledFor: string;
  items?: number;
  pages?: number;
  units?: number;
  dbBytes?: number;
  storageWarning?: boolean;
  errorCode?: string;
  durationMs: number;
}

/** 작업 시각: 호출 시각을 UTC 정각으로 내린다. 클라이언트가 지정하지 못하므로 과거 시각 백필이 불가능하다. */
export function scheduledHour(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
}

/** 예산·일 경계는 Asia/Seoul 날짜 기준(임시값, D07). */
export function kstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function hash(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function videoPayload(video: SnapshotVideo, observedAt: string) {
  return {
    video_id: video.id,
    position: video.position,
    content_hash: hash([
      video.title,
      video.description,
      video.tags,
      video.categoryId,
      video.channelId,
      video.publishedAt,
      video.durationSeconds,
      video.thumbnailUrl,
    ]),
    title: video.title,
    description: video.description,
    tags: video.tags,
    category_id: video.categoryId,
    channel_id: video.channelId,
    published_at: video.publishedAt,
    duration_seconds: video.durationSeconds,
    thumbnail_url: video.thumbnailUrl,
    view_count: video.viewCount,
    like_count: video.likeCount,
    comment_count: video.commentCount,
    observed_at: observedAt,
  };
}

function channelPayload(channel: SnapshotChannel, observedAt: string) {
  return {
    channel_id: channel.id,
    content_hash: hash([channel.title, channel.thumbnailUrl]),
    title: channel.title,
    thumbnail_url: channel.thumbnailUrl,
    subscriber_count: channel.subscriberCount,
    subscribers_hidden: channel.hidden,
    observed_at: observedAt,
  };
}

export function buildPayload(snapshot: PopularSnapshot, observedAt: string, finishedAt: string) {
  return {
    pages_fetched: snapshot.pagesFetched,
    units: snapshot.units,
    finished_at: finishedAt,
    videos: snapshot.videos.map((video) => videoPayload(video, observedAt)),
    channels: snapshot.channels.map((channel) => channelPayload(channel, observedAt)),
    keywords: storedKeywordCounts(snapshot.videos).map((entry) => ({
      keyword: entry.keyword,
      video_count: entry.videoCount,
      channel_count: entry.channelCount,
    })),
  };
}

function row<T>(body: unknown): T {
  const value: unknown = Array.isArray(body) ? body[0] : null;
  if (!value || typeof value !== 'object')
    throw new ApiFailure('UPSTREAM_ERROR', '데이터 저장소 응답이 올바르지 않습니다.', 502);
  return value as T;
}

export async function runPopularCollection(
  now: Date = new Date(),
  collect: () => Promise<PopularSnapshot> = collectPopularSnapshot,
): Promise<CollectSummary> {
  const t0 = Date.now();
  const scheduled = scheduledHour(now);
  const scheduledFor = scheduled.toISOString();
  const done = (summary: Omit<CollectSummary, 'scheduledFor' | 'durationMs'>): CollectSummary => ({
    ...summary,
    scheduledFor,
    durationMs: Date.now() - t0,
  });

  // 1. 시작: 같은 작업 시각은 한 번만. 저장소 오류면 YouTube를 호출하지 않는다.
  const started = row<{ state: string; run_id: number | null; db_bytes: number | string }>(
    await serviceRpc('start_popular_run', {
      p_scheduled_for: scheduledFor,
      p_now: now.toISOString(),
    }),
  );
  const dbBytes = Number(started.db_bytes);
  if (started.state === 'storage_hold')
    return done({ state: 'storage_hold', runId: null, dbBytes, storageWarning: true });
  if (started.state === 'done' || started.state === 'busy')
    return done({ state: started.state, runId: started.run_id, dbBytes });
  const runId = started.run_id as number;
  const storageWarning = dbBytes >= STORAGE_WARN_BYTES;

  const fail = async (
    status: 'partial' | 'failed',
    errorCode: string,
    pages: number,
    units: number,
  ) => {
    // 기록이 실패해도 running이 10분 뒤 재시작 대상이 되므로 여기서는 삼킨다.
    await serviceRpc('fail_popular_run', {
      p_run: runId,
      p_status: status,
      p_error: errorCode,
      p_pages: pages,
      p_units: units,
      p_now: new Date().toISOString(),
    }).catch(() => undefined);
  };

  // 2. 예산: 호출 전에 확보한다. 소진되면 YouTube를 호출하지 않는다.
  const day = kstDay(now);
  try {
    const cap = Number(process.env.YOUTUBE_DAILY_UNIT_CAP) || DEFAULT_DAILY_UNIT_CAP;
    await serviceRpc('ensure_quota_row', { p_kind: 'youtube_units', p_day: day, p_cap: cap });
    const granted = await serviceRpc('try_consume_quota', {
      p_kind: 'youtube_units',
      p_day: day,
      p_units: RESERVED_UNITS,
    });
    if (granted !== true) {
      await fail('failed', 'BUDGET_EXHAUSTED', 0, 0);
      return done({ state: 'budget_exhausted', runId, dbBytes, storageWarning });
    }
  } catch {
    await fail('failed', 'BUDGET_ERROR', 0, 0);
    return done({
      state: 'store_failed',
      runId,
      dbBytes,
      storageWarning,
      errorCode: 'BUDGET_ERROR',
    });
  }

  // 3. 수집
  const snapshot = await collect();
  if (!snapshot.complete) {
    // 일부 페이지만 성공했으면 partial, 첫 호출부터 실패했으면 failed. 어느 쪽도 공개하지 않는다.
    await fail(
      snapshot.pagesFetched > 0 && snapshot.errorCode !== 'EMPTY_RESPONSE' ? 'partial' : 'failed',
      snapshot.errorCode ?? 'INTERNAL_ERROR',
      snapshot.pagesFetched,
      snapshot.units,
    );
    return done({
      state: 'incomplete',
      runId,
      pages: snapshot.pagesFetched,
      units: snapshot.units,
      dbBytes,
      storageWarning,
      errorCode: snapshot.errorCode,
    });
  }

  // 4. 한 트랜잭션 적재. 실패하면 전체가 롤백되므로 부분 적재가 남지 않는다.
  const finishedAt = new Date().toISOString();
  try {
    await serviceRpc('finish_popular_run', {
      p_run: runId,
      p_payload: buildPayload(snapshot, now.toISOString(), finishedAt),
      p_now: finishedAt,
    });
  } catch {
    await fail('failed', 'STORE_ERROR', snapshot.pagesFetched, snapshot.units);
    return done({
      state: 'store_failed',
      runId,
      pages: snapshot.pagesFetched,
      units: snapshot.units,
      dbBytes,
      storageWarning,
      errorCode: 'STORE_ERROR',
    });
  }
  return done({
    state: 'complete',
    runId,
    items: snapshot.videos.length,
    pages: snapshot.pagesFetched,
    units: snapshot.units,
    dbBytes,
    storageWarning,
  });
}
