import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 개발 전용: `npm run dev`에서도 /api/* 요청을 api/*.ts 핸들러(GET/POST 등 export)로 처리한다.
 * 배포 환경은 Vercel Functions가 같은 핸들러를 실행한다.
 * .env.local 값은 서버 프로세스(process.env)에만 넣고, 클라이언트 번들(import.meta.env)에는 넣지 않는다.
 */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();

        // 동적 상세 경로를 Vercel과 같은 핸들러로 연결한다. 내부 _lib 경로는 공개하지 않는다.
        const route = /^\/api\/video\/[^/]+\/?$/.test(url.pathname)
          ? 'api/video/[id].ts'
          : /^\/api\/[a-z][a-z0-9-]*$/.test(url.pathname)
            ? `${url.pathname.slice(1)}.ts`
            : null;
        const file = route ? path.join(process.cwd(), route) : '';
        if (!file || !existsSync(file)) {
          res.statusCode = 404;
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ code: 'NOT_FOUND', message: '없는 API 경로입니다.' }));
        }

        try {
          const mod = await server.ssrLoadModule(file);
          const method = req.method ?? 'GET';
          const handler = mod[method];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader(
              'Allow',
              Object.keys(mod)
                .filter((key) =>
                  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(key),
                )
                .join(', '),
            );
            return res.end(
              JSON.stringify({ code: 'BAD_REQUEST', message: '지원하지 않는 요청 방식입니다.' }),
            );
          }

          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.byteLength;
            if (bytes > 16 * 1024) {
              res.statusCode = 413;
              res.setHeader('Cache-Control', 'no-store');
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ code: 'BAD_REQUEST', message: '요청 본문이 너무 큽니다.' }));
              return;
            }
            chunks.push(buffer);
          }
          const request = new Request(url, {
            method,
            headers: req.headers as Record<string, string>,
            body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
          });

          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          // 개발 서버의 기본 오류 화면에도 외부 오류 원문이나 비밀값을 전달하지 않는다.
          res.statusCode = 500;
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
});
