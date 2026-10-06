// 할당량 절약용 목업: USE_FIXTURES=1이면 YouTube 래퍼가 실제 API 대신 api/_fixtures/*.json을 반환한다.
// fixture는 scripts/fetch-fixtures.ts(npm run fixtures)로 한 번만 생성한다.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type FixtureName = 'videos-popular' | 'video-categories' | 'search' | 'videos-search' | 'channels';

export function isFixtureMode(): boolean {
  return process.env.VERCEL_ENV !== 'production' && process.env.USE_FIXTURES === '1';
}

const cache = new Map<FixtureName, unknown>();

export async function loadFixture<T>(name: FixtureName): Promise<T> {
  if (!cache.has(name)) {
    const file = path.join(process.cwd(), 'api', '_fixtures', `${name}.json`);
    cache.set(name, JSON.parse(await readFile(file, 'utf8')));
  }
  return cache.get(name) as T;
}
