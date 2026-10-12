import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// 모든 경로에 보안 응답 헤더가 설정되어 있는지 vercel.json을 읽어 확인한다. 외부 호출 0회.
// 헤더를 지우거나 CSP를 느슨하게 바꾸면 CI에서 실패한다.

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

const rule = config.headers.find((entry) => entry.source === '/(.*)');
assert.ok(rule, '모든 경로(/(.*))에 적용되는 헤더 규칙이 있어야 한다');
const header = (name: string) =>
  rule.headers.find((entry) => entry.key.toLowerCase() === name.toLowerCase())?.value;

// CSP: 스크립트는 같은 출처만, 프레임·플러그인·base 변경 금지
const csp = header('Content-Security-Policy');
assert.ok(csp, 'Content-Security-Policy가 있어야 한다');
const directives = new Map(
  csp.split(';').map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values] as const;
  }),
);
assert.deepEqual(directives.get('default-src'), ["'self'"]);
assert.deepEqual(directives.get('script-src'), ["'self'"]);
assert.ok(!csp.includes("'unsafe-eval'"), 'unsafe-eval을 허용하지 않는다');
assert.ok(!directives.get('script-src')!.includes("'unsafe-inline'"), '인라인 스크립트 금지');
assert.deepEqual(directives.get('object-src'), ["'none'"]);
assert.deepEqual(directives.get('base-uri'), ["'self'"]);
assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
assert.deepEqual(directives.get('form-action'), ["'self'"]);
// 서버 통신은 같은 출처와 Supabase로만
assert.deepEqual(directives.get('connect-src'), ["'self'", 'https://*.supabase.co']);
for (const [name, values] of directives)
  assert.ok(!values.includes('*'), `${name}에 모든 출처(*)를 허용하지 않는다`);

assert.equal(header('X-Frame-Options'), 'DENY');
assert.equal(header('X-Content-Type-Options'), 'nosniff');
assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin');
const permissions = header('Permissions-Policy') ?? '';
for (const feature of ['camera', 'microphone', 'geolocation'])
  assert.ok(permissions.includes(`${feature}=()`), `${feature} 권한을 막는다`);
const hsts = header('Strict-Transport-Security') ?? '';
assert.match(hsts, /max-age=(\d+)/);
assert.ok(Number(/max-age=(\d+)/.exec(hsts)![1]) >= 31_536_000, 'HSTS는 1년 이상');

console.log('test-security-headers: all passed');
