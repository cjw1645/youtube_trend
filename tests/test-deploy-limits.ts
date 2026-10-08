import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
// 배포 제약 검사: Vercel Hobby는 배포당 함수 12개까지(초과하면 배포가 실패한다), rewrites 대상 파일 존재,
// 묶은 진입점이 쿼리·원래 경로 어느 쪽으로도 올바른 핸들러를 고르는지 확인한다. 외부 호출 0회.

const HOBBY_FUNCTION_LIMIT = 12;

/** api/ 아래에서 밑줄로 시작하지 않는 .ts 파일이 각각 하나의 함수가 된다. */
function functionFiles(dir = 'api'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('_')) return [];
    const path = join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) return functionFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const files = functionFiles();
assert.ok(
  files.length <= HOBBY_FUNCTION_LIMIT,
  `함수 ${files.length}개: Hobby 한도 ${HOBBY_FUNCTION_LIMIT}개 초과 (${files.join(', ')})`,
);

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  functions: Record<string, unknown>;
  rewrites: { source: string; destination: string }[];
};
for (const key of Object.keys(config.functions))
  assert.ok(existsSync(key), `vercel.json functions 대상이 없습니다: ${key}`);
for (const { destination } of config.rewrites) {
  const target = `${new URL(destination, 'http://x').pathname.slice(1)}.ts`;
  assert.ok(files.includes(target), `rewrite 대상 함수가 없습니다: ${target}`);
}

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const stored = await vite.ssrLoadModule('/api/stored.ts');
  const searchData = await vite.ssrLoadModule('/api/search-data.ts');
  const collect = await vite.ssrLoadModule('/api/collect.ts');
  const get = (entry: { GET: (r: Request) => Promise<Response> }, url: string) =>
    entry.GET(new Request(`http://localhost${url}`));

  // 알 수 없는 종류는 404(어느 핸들러도 호출하지 않는다)
  for (const url of ['/api/stored?kind=nope', '/api/stored', '/api/other']) {
    const res = await get(stored, url);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal((await get(searchData, '/api/search-data?kind=nope')).status, 404);
  // 로그인 없는 개인 데이터 요청은 어느 주소로 와도 401
  for (const url of [
    '/api/search-data?kind=snapshot&slot=1',
    '/api/search-data?kind=trend&slot=1',
    '/api/search-trend?slot=1',
    '/api/search-snapshot?slot=1',
  ])
    assert.equal((await get(searchData, url)).status, 401, url);
  // 수집은 예약 비밀 없이는 어느 종류도 401 (비밀 미설정이면 거부)
  for (const url of [
    '/api/collect',
    '/api/collect?job=search',
    '/api/collect-search',
    '/api/collect?job=popular',
  ]) {
    const res = await collect.POST(new Request(`http://localhost${url}`, { method: 'POST' }));
    assert.ok([401, 500].includes(res.status), `${url} → ${res.status}`);
  }
  assert.equal(
    (await collect.POST(new Request('http://localhost/api/collect?job=x', { method: 'POST' })))
      .status,
    400,
  );
  console.log(
    `PASS: 함수 ${files.length}/${HOBBY_FUNCTION_LIMIT}개, rewrites 대상 존재, 묶은 진입점의 종류 선택·인증 거부·404; 실제 호출 0회`,
  );
} finally {
  await vite.close();
}
