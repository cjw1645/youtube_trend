// 실제 Key·외부 API 없이 취소 경쟁과 사용자 상태 화면을 검증한다.
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, envDir: 'tmp/no-env', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const originalFetch = globalThis.fetch;
try {
  const { startRequest } = await vite.ssrLoadModule('/src/lib/request.ts');
  const { getJson, ApiRequestError } = await vite.ssrLoadModule('/src/lib/api.ts');
  const views = await vite.ssrLoadModule('/src/components/StatusView.tsx');
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  function deferred() {
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }
  // 취소를 무시하는 통신: 최신 결과 뒤에 이전 성공·실패가 도착한다.
  for (const outcome of ['success', 'error']) {
    const old = deferred();
    const latest = deferred();
    const updates: string[] = [];
    let oldSignal!: AbortSignal;
    const cancelOld = startRequest((signal: AbortSignal) => { oldSignal = signal; return old.promise; }, (value: string) => updates.push(value), () => updates.push('old-error'));
    await flush();
    cancelOld();
    assert.equal(oldSignal.aborted, true);
    const cancelLatest = startRequest(() => latest.promise, (value: string) => updates.push(value), () => updates.push('new-error'));
    await flush();
    latest.resolve('latest');
    await flush();
    if (outcome === 'success') old.resolve('stale'); else old.reject(new Error('late failure'));
    await flush();
    assert.deepEqual(updates, ['latest']);
    cancelLatest();
  }
  let loads = 0;
  const cancelBeforeLoad = startRequest(async () => { loads++; return 'unused'; }, () => assert.fail('unmounted update'), () => assert.fail('unmounted error'));
  cancelBeforeLoad();
  await flush();
  assert.equal(loads, 0);

  let attempts = 0;
  let errorCount = 0;
  const load = async () => { attempts++; if (attempts === 1) throw new Error('offline'); return 'recovered'; };
  const values: string[] = [];
  startRequest(load, (value: string) => values.push(value), () => { errorCount++; });
  await flush();
  assert.equal(errorCount, 1);
  assert.equal(attempts, 1); // 자동 재시도 없음
  startRequest(load, (value: string) => values.push(value), () => assert.fail('retry failed'));
  await flush();
  assert.deepEqual(values, ['recovered']);

  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(getJson('/api/videos'), (error: { code: string }) => error.code === 'NETWORK_ERROR');
  globalThis.fetch = async () => Response.json({ code: 'QUOTA_EXCEEDED', message: '조회 한도 초과' }, { status: 429 });
  await assert.rejects(getJson('/api/videos'), (error: { code: string; status: number }) => error.code === 'QUOTA_EXCEEDED' && error.status === 429);
  globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 });
  await assert.rejects(getJson('/api/videos'), (error: { message: string }) => error.message.includes('HTTP 502'));
  globalThis.fetch = async () => new Response('not JSON');
  await assert.rejects(getJson('/api/videos'), (error: { code: string }) => error.code === 'INTERNAL_ERROR');

  const render = (component: Parameters<typeof createElement>[0], props = {}) => renderToStaticMarkup(createElement(component, props));
  assert.match(render(views.LoadingGrid), /role="status".*영상을 불러오는 중/);
  assert.match(render(views.EmptyView, { query: '없는 검색어', onReset() {} }), /검색 결과가 없습니다/);
  assert.match(render(views.EmptyFavoritesView, { onBrowse() {} }), /아직 관심 영상이 없습니다/);
  for (const [code, title, action] of [
    ['NETWORK_ERROR', '영상을 불러오지 못했습니다', '다시 시도'],
    ['UPSTREAM_ERROR', '영상을 불러오지 못했습니다', '다시 시도'],
    ['QUOTA_EXCEEDED', 'YouTube 조회 할당량을 초과했습니다', '다시 확인'],
    ['NOT_FOUND', '이 영상을 찾을 수 없습니다', '다시 시도'],
  ]) {
    const html = render(views.ErrorView, { error: new ApiRequestError(code, '안내', 429), onRetry() {} });
    assert.match(html, /role="alert"/);
    assert.ok(html.includes(title));
    assert.ok(html.includes(action));
    assert.match(html, /<button type="button"/);
  }
  assert.ok(render(views.ErrorView, { error: new ApiRequestError('UPSTREAM_ERROR', '안내', 502), title: '카테고리를 불러오지 못했습니다', compact: true, onRetry() {} }).includes('카테고리를 불러오지 못했습니다'));
  console.log('PASS: 지연 성공·실패 차단, unmount 취소, 수동 재시도, 네트워크/429/502/잘못된 JSON, 상태 화면');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
