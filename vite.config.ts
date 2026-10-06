import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 개발 전용: `npm run dev`에서도 /api/* 요청을 api/*.ts 핸들러(GET/POST 등 export)로 처리한다.
 * 배포 환경은 Vercel Functions가 같은 파일을 실행하므로 동작이 같다.
 * .env.local 값은 서버 프로세스(process.env)에만 넣고, 클라이언트 번들(import.meta.env)에는 넣지 않는다.
 */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value;

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();

        const file = path.join(process.cwd(), `${url.pathname}.ts`);
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ code: 'NOT_FOUND', message: '없는 API 경로입니다.' }));
        }

        try {
          const mod = await server.ssrLoadModule(file);
          const method = req.method ?? 'GET';
          const handler = mod[method];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            return res.end();
          }

          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const request = new Request(url, {
            method,
            headers: req.headers as Record<string, string>,
            body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
          });

          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
});
