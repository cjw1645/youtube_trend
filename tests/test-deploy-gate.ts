import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// 배포가 테스트를 통과해야만 진행되도록 설정이 유지되는지 확인한다. 외부 호출 0회.
// (Vercel 빌드가 테스트를 먼저 실행하므로 테스트가 실패하면 빌드가 실패해 배포가 중단되고 이전 배포가 유지된다.)

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { buildCommand?: string };
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  engines?: { node?: string };
  scripts?: Record<string, string>;
};
const ignore = readFileSync('.vercelignore', 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim());

// 빌드 명령이 테스트를 먼저 실행하고, 실패하면(&&) 빌드로 넘어가지 않는다
assert.ok(vercel.buildCommand, 'vercel.json에 buildCommand가 있어야 한다');
const parts = vercel.buildCommand.split('&&').map((part) => part.trim());
assert.deepEqual(parts, ['npm test', 'npm run build'], '테스트 → 빌드 순서로 &&로 연결한다');
assert.ok(pkg.scripts?.test, 'npm test 스크립트가 있어야 한다');
assert.ok(pkg.scripts?.build, 'npm run build 스크립트가 있어야 한다');

// 테스트는 Node 24의 TypeScript 직접 실행에 의존하므로 Vercel도 24로 고정한다
assert.equal(pkg.engines?.node, '24.x');

// 배포 빌드에 tests/가 포함되어야 테스트를 실행할 수 있다
assert.ok(
  !ignore.includes('tests/'),
  '.vercelignore가 tests/를 제외하면 배포 빌드에서 테스트를 실행할 수 없다',
);

console.log('test-deploy-gate: all passed');
