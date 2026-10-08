import assert from 'node:assert/strict';
import {
  FAVORITES_KEY,
  FAVORITES_READ_ERROR,
  FAVORITES_WRITE_ERROR,
  readFavorites,
  writeFavorites,
  snapshotVideo,
} from '../src/lib/favorites.ts';
import type { Video } from '../src/types/video.ts';
let raw: string | null = null;
const storage = {
  getItem(key: string) {
    assert.equal(key, FAVORITES_KEY);
    return raw;
  },
  setItem(key: string, value: string) {
    assert.equal(key, FAVORITES_KEY);
    raw = value;
  },
};
const getStorage = () => storage;
const video: Video = {
  id: 'abcdefghijk',
  title: '테스트',
  channelId: 'channel',
  channelTitle: '채널',
  thumbnailUrl: '',
  publishedAt: '2026-10-06T00:00:00Z',
  categoryId: '10',
  durationSeconds: 60,
  viewCount: 0,
  likeCount: null,
  commentCount: 10,
};

assert.deepEqual(readFavorites(getStorage), { videos: [], error: null });
assert.equal(writeFavorites(getStorage, [video, video]), null);
assert.deepEqual(readFavorites(getStorage), { videos: [video], error: null });
assert.equal(JSON.parse(raw!).items.length, 1);

// 저장·재조회·해제. 누락 통계(null)와 조회수 0을 보존한다.
const saved = readFavorites(getStorage).videos;
assert.equal(saved[0].viewCount, 0);
assert.equal(saved[0].likeCount, null);
assert.equal(
  writeFavorites(
    getStorage,
    saved.filter((item) => item.id !== video.id),
  ),
  null,
);
assert.equal(readFavorites(getStorage).videos.length, 0);

for (const malformed of [
  '{broken',
  'null',
  '{}',
  '{"version":99,"items":[]}',
  '{"version":1,"items":"bad"}',
]) {
  raw = malformed;
  const result = readFavorites(getStorage);
  assert.deepEqual(result.videos, []);
  assert.ok(result.error);
  assert.equal(raw, malformed); // 조회만으로 손상 데이터를 덮어쓰지 않는다.
}

raw = JSON.stringify({
  version: 1,
  items: [
    video,
    { ...video, id: 'short' },
    { ...video, id: 'XXXXXXXXXXX', viewCount: '0' },
    { ...video, id: 'YYYYYYYYYYY', publishedAt: 'bad' },
    video,
  ],
});
assert.deepEqual(readFavorites(getStorage).videos, [video]);
assert.ok(readFavorites(getStorage).error);
assert.equal(writeFavorites(getStorage, [video]), null);
assert.equal(readFavorites(getStorage).error, null);

const inaccessible = () => {
  throw new Error('Storage blocked');
};
assert.equal(readFavorites(inaccessible).error, FAVORITES_READ_ERROR);
assert.equal(writeFavorites(inaccessible, [video]), FAVORITES_WRITE_ERROR);
const previous = raw;
const full = () => ({
  getItem: storage.getItem,
  setItem() {
    throw new Error('Quota exceeded');
  },
});
assert.equal(writeFavorites(full, []), FAVORITES_WRITE_ERROR);
assert.equal(raw, previous);

// 상세 응답의 추가 필드는 저장하지 않는다.
const extended = { ...video, description: '긴 설명', tags: ['tag'], subscriberCount: 10 };
assert.deepEqual(snapshotVideo(extended), video);
console.log(
  'PASS: 저장·해제·재조회, ID 중복 방지, null/0 보존, 손상 데이터, 저장소 접근 차단·용량 초과, 목록 필드만 저장',
);
