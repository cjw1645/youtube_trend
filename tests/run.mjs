// 오프라인·합성 데이터 테스트 실행기. 실제 YouTube·Gemini·Supabase와 환경 파일에 접근하지 않는다.
// 서버 코드가 .env.local을 읽지 않도록 VERCEL=1·NODE_ENV=production으로 실행하고, 모든 외부 호출은 각 테스트의 모의 fetch다.
// 사용: npm test            (전체)
//       npm test -- chat    (파일 이름에 chat이 들어간 것만)
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('.', import.meta.url);
const filter = process.argv[2] ?? '';
const files = [
  ...readdirSync(root).filter((f) => /^test-.*\.ts$/.test(f)),
  ...readdirSync(new URL('db/', root))
    .filter((f) => /^verify.*\.mjs$/.test(f))
    .map((f) => `db/${f}`),
]
  .filter((f) => f.includes(filter))
  .sort();

const run = (file) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [fileURLToPath(new URL(file, root))], {
      env: { ...process.env, NODE_ENV: 'production', VERCEL: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 180_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ file, code, out, ms: Date.now() - started });
    });
  });

let failed = 0;
for (const file of files) {
  const result = await run(file);
  const ok = result.code === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file} (${(result.ms / 1000).toFixed(1)}s)`);
  // 실패 시에만 끝부분을 보여 준다(출력에 비밀값은 없다: 합성 값만 사용).
  if (!ok) console.log(result.out.split('\n').slice(-25).join('\n'));
}
console.log(`\n${files.length - failed}/${files.length} 통과`);
process.exit(failed ? 1 : 0);
