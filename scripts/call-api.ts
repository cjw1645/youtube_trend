// /api 핸들러를 vercel dev 없이 직접 호출하는 점검 도구.
// 실행: npm run api -- "/api/videos?q=먹방&order=date"
// .env.local을 프로세스 안에서만 로드하므로 USE_FIXTURES=1이면 YouTube 할당량을 쓰지 않는다.
import { createServer } from 'vite';

process.loadEnvFile('.env.local');

const target = process.argv[2] ?? '/api/videos';
const url = new URL(target, 'http://localhost');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const mod = await vite.ssrLoadModule(`${url.pathname}.ts`);
  const res: Response = await mod.GET(new Request(url));
  const body = await res.json();
  console.log(`${res.status} ${url.pathname}${url.search}  fixtures=${process.env.USE_FIXTURES === '1'}`);
  console.log(`Cache-Control: ${res.headers.get('Cache-Control')}`);
  console.log(JSON.stringify(body, null, 2).slice(0, 1500));
} finally {
  await vite.close();
}
