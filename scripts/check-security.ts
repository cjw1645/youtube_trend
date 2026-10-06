// 비밀 환경 파일에 접근하지 않는다. 탐지 결과는 위치·건수만 출력한다.
import { execFileSync } from 'node:child_process';
import { readFile, appendFile } from 'node:fs/promises';

const findings: { location: string; count: number }[] = [];
const keyPattern = /AIza[0-9A-Za-z_-]{35}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;
function scan(location: string, text: string) {
  const count = [...text.matchAll(keyPattern)].length;
  if (count) findings.push({ location, count });
}
const git = (args: string[], input?: string) => execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
const paths = git(['ls-files']).trim().split('\n');
for (const file of paths) {
  if (/^\.env(?!\.example$)|(^|\/)DECISION\.md$|^docs\/.*\.pdf$/.test(file)) {
    findings.push({ location: `tracked:${file}`, count: 1 });
    continue;
  }
  if (!/\.(?:ts|tsx|js|json|md|html|css)$/.test(file)) continue;
  const content = await readFile(file, 'utf8');
  scan(file, content);
  if (/\.(?:ts|tsx)$/.test(file) && !file.startsWith('api/') && !file.startsWith('scripts/test-')) {
    const count = [...content.matchAll(/process\.env\.(?:YOUTUBE|GEMINI)_API_KEY\b(?!\s*=)/g)].length;
    if (count) findings.push({ location: `server-boundary:${file}`, count });
  }
  if (file.startsWith('src/')) {
    const count = [...content.matchAll(/VITE_[A-Z_]+|(?:generativelanguage|www)\.googleapis\.com|process\.env\.(?:YOUTUBE|GEMINI)_API_KEY/g)].length;
    if (count) findings.push({ location: `client-boundary:${file}`, count });
  }
}
const history = git(['rev-list', '--objects', '--all']).trim().split('\n').map(line => {
  const space = line.indexOf(' ');
  return { id: space < 0 ? line : line.slice(0, space), file: space < 0 ? '' : line.slice(space + 1) };
});
for (const file of new Set(history.map(object => object.file).filter(file => /(?:^|\/)\.env(?!\.example$)/.test(file)))) {
  findings.push({ location: `history-protected-path:${file}`, count: 1 });
}
const objects = history.filter(({ file }) => file && !/(?:^|\/)\.env(?!\.example$)|(^|\/)DECISION\.md$|^docs\/.*\.pdf$/.test(file));
const packed = Buffer.from(execFileSync('git', ['cat-file', '--batch'], { input: objects.map(o => o.id).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 }));
let offset = 0;
let blobs = 0;
for (const object of objects) {
  const end = packed.indexOf(10, offset);
  const [, type, size] = packed.subarray(offset, end).toString('utf8').split(' ');
  offset = end + 1;
  const length = Number(size);
  if (type === 'blob') { blobs++; scan(`history:${object.file}@${object.id.slice(0, 8)}`, packed.subarray(offset, offset + length).toString('utf8')); }
  offset += length + 1;
}
const base = new URL('https://youtube-trend-orpin.vercel.app');
const html = await (await fetch(base, { signal: AbortSignal.timeout(15000) })).text();
scan('production:index.html', html);
const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(match => match[1]))];
for (const asset of assets) {
  const response = await fetch(new URL(asset, base), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`배포 자산 조회 실패: HTTP ${response.status}`);
  scan(`production:${asset}`, await response.text());
}
for (const path of ['/api/videos', '/api/categories', '/api/video/IfRNyaUgEC8']) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20000) });
  scan(`network:${path}`, JSON.stringify([...response.headers]) + await response.text());
  if (!response.ok) throw new Error(`API 조회 실패: ${path}, HTTP ${response.status}`);
}
const error = await fetch(new URL('/api/chat', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
scan('network:/api/chat:error', JSON.stringify([...error.headers]) + await error.text());
if (error.status !== 400 || error.headers.get('cache-control') !== 'no-store') throw new Error('오류 응답 계약 실패');
const report = { date: '2026-10-06', trackedFiles: paths.length, historicalBlobs: blobs, deployedAssets: assets.length, apiResponses: 4, findings };
await appendFile('docs/DECISION.md', `\n### 3-2 보안 검사\n${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (findings.length) process.exitCode = 1;
