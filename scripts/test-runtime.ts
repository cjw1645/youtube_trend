import assert from 'node:assert/strict';
import { createServer } from 'vite';
process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'preview';
process.env.USE_FIXTURES = '1';
const vite = await createServer({ configFile: false, envDir: 'tmp/no-env', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { injectTestFailure } = await vite.ssrLoadModule('/api/_lib/runtime.ts');
  const { isFixtureMode } = await vite.ssrLoadModule('/api/_lib/fixtures.ts');
  const { GET } = await vite.ssrLoadModule('/api/videos.ts');
  const { POST } = await vite.ssrLoadModule('/api/chat.ts');
  for (const [mode, status, code] of [['quota', 429, 'QUOTA_EXCEEDED'], ['timeout', 504, 'TIMEOUT'], ['upstream', 502, 'UPSTREAM_ERROR']] as const) {
    process.env.API_TEST_YOUTUBE_ERROR = mode;
    const yt = await GET(new Request('http://localhost/api/videos'));
    assert.equal(yt.status, status);
    assert.equal((await yt.json()).code, code);
    assert.equal(yt.headers.get('cache-control'), 'no-store');
    delete process.env.API_TEST_YOUTUBE_ERROR;
    process.env.API_TEST_GEMINI_ERROR = mode;
    const ai = await POST(new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: '분석', videoIds: ['IfRNyaUgEC8'] }) }));
    assert.equal(ai.status, status);
    assert.equal((await ai.json()).code, code);
    assert.equal(ai.headers.get('cache-control'), 'no-store');
  }
  process.env.VERCEL_ENV = 'production';
  process.env.API_TEST_YOUTUBE_ERROR = 'quota';
  process.env.API_TEST_GEMINI_ERROR = 'quota';
  assert.doesNotThrow(() => injectTestFailure('youtube'));
  assert.doesNotThrow(() => injectTestFailure('gemini'));
  assert.equal(isFixtureMode(), false);
  console.log('PASS: 로컬/Preview 오류 주입 429/504/502·no-store, Production 오류/fixture 무시');
} finally { await vite.close(); }
