// 외부 API 및 실제 Key 없이 상세 계약·누락 데이터·오류 경로를 검증한다.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.USE_FIXTURES = '1';
process.env.YOUTUBE_API_KEY = 'test-placeholder';

const vite = await createServer({ configFile: false, envDir: 'tmp/no-env', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const realFetch = globalThis.fetch;

try {
  const { GET } = await vite.ssrLoadModule('/api/video/[id].ts');
  const { formatDetailCount } = await vite.ssrLoadModule('/src/components/VideoDetail.tsx');
  const request = (id: string) => GET(new Request(`http://localhost/api/video/${id}`)) as Promise<Response>;

  const success = await request('IfRNyaUgEC8');
  assert.equal(success.status, 200);
  const video = await success.json();
  assert.equal(video.id, 'IfRNyaUgEC8');
  assert.equal(typeof video.description, 'string');
  assert.ok(Array.isArray(video.tags));
  assert.equal(typeof video.subscriberCount, 'number');
  assert.match(success.headers.get('Cache-Control')!, /s-maxage=600/);

  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected external request'); };
  for (const id of ['short', 'aaaaaaaaaa!', '%2Fetc', 'a'.repeat(12)]) {
    const result = await request(id);
    assert.equal(result.status, 400);
    assert.equal((await result.json()).code, 'BAD_REQUEST');
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
  }
  const missingFixture = await request('xxxxxxxxxxx');
  assert.equal(missingFixture.status, 404);
  assert.equal((await missingFixture.json()).code, 'NOT_FOUND');
  assert.equal(calls, 0);

  process.env.USE_FIXTURES = '0';
  const rawVideo = {
    id: 'abcdefghijk',
    snippet: { title: '테스트 영상', description: '', channelId: 'channel', channelTitle: '테스트 채널', publishedAt: '2026-10-06T00:00:00Z', categoryId: '10', thumbnails: {} },
    statistics: { viewCount: '0' },
  };
  const resources: string[] = [];
  globalThis.fetch = async (input) => {
    const resource = new URL(String(input)).pathname.split('/').at(-1)!;
    resources.push(resource);
    return Response.json({ items: resource === 'videos' ? [rawVideo] : [{ id: 'channel', statistics: { hiddenSubscriberCount: true, subscriberCount: '123' } }] });
  };
  const sparse = await (await request('abcdefghijk')).json();
  assert.deepEqual(resources, ['videos', 'channels']);
  assert.equal(sparse.viewCount, 0);
  assert.equal(sparse.likeCount, null);
  assert.equal(sparse.commentCount, null);
  assert.equal(sparse.subscriberCount, null);
  assert.deepEqual(sparse.tags, []);
  assert.equal(formatDetailCount(0), '0');
  assert.equal(formatDetailCount(null), '정보 없음');

  // 삭제·비공개 영상은 채널 조회 없이 404.
  resources.length = 0;
  globalThis.fetch = async (input) => {
    resources.push(new URL(String(input)).pathname.split('/').at(-1)!);
    return Response.json({ items: [] });
  };
  const missing = await request('abcdefghijk');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'NOT_FOUND');
  assert.deepEqual(resources, ['videos']);

  globalThis.fetch = async () => Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 });
  const quota = await request('abcdefghijk');
  assert.equal(quota.status, 429);
  assert.equal((await quota.json()).code, 'QUOTA_EXCEEDED');
  assert.equal(quota.headers.get('Cache-Control'), 'no-store');

  console.log('PASS: fixture 상세, ID 400, 영상 404, 채널 조회, null/0, 비공개 구독자, 할당량 429, 캐시');
} finally {
  globalThis.fetch = realFetch;
  await vite.close();
}
