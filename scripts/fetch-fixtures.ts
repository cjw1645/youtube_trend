// YouTube 응답을 한 번만 받아 api/_fixtures/*.json으로 저장한다.
// USE_FIXTURES=1이면 서버(api/_lib)가 실제 API 대신 이 파일들을 반환 → UI 개발 중 할당량 소모 0.
// 실행: npm run fixtures [검색어]   (약 104 unit 소모: search.list 100 + 나머지 각 1)
// Key는 프로세스 안에서만 읽고 요청 헤더로만 보낸다 (출력·URL·파일에 남기지 않음).
import { mkdir, writeFile } from 'node:fs/promises';

process.loadEnvFile('.env.local');
const apiKey = process.env.YOUTUBE_API_KEY;
if (!apiKey) {
  console.error('YOUTUBE_API_KEY가 설정되어 있지 않습니다.');
  process.exit(1);
}

const BASE = 'https://www.googleapis.com/youtube/v3';
const OUT_DIR = 'api/_fixtures';
const searchQuery = process.argv[2] ?? '브이로그';
const VIDEO_PART = 'snippet,statistics,contentDetails';

type ListResponse = { items?: Array<{ id: unknown; snippet?: { channelId?: string } }> };

async function yt<T = ListResponse>(resource: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}/${resource}?${new URLSearchParams(params)}`, {
    headers: { 'X-Goog-Api-Key': apiKey! },
  });
  const body = await res.json();
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason ?? 'unknown';
    // ErrorInfo(예: API_KEY_SERVICE_BLOCKED)와 metadata(서비스·프로젝트 번호)는 Key를 포함하지 않아 원인 파악용으로 출력
    const info = (body?.error?.details ?? []).find((d: { reason?: string }) => d.reason);
    const detail = info ? ` [${info.reason} ${JSON.stringify(info.metadata ?? {})}]` : '';
    throw new Error(`${resource} ${res.status} ${reason}: ${body?.error?.message ?? ''}${detail}`);
  }
  return body as T;
}

async function save(name: string, data: unknown) {
  await writeFile(`${OUT_DIR}/${name}.json`, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

await mkdir(OUT_DIR, { recursive: true });

const popular = await yt('videos', {
  part: VIDEO_PART,
  chart: 'mostPopular',
  regionCode: 'KR',
  hl: 'ko',
  maxResults: '50',
});
const categories = await yt('videoCategories', { part: 'snippet', regionCode: 'KR', hl: 'ko' });

const search = await yt<{ items?: Array<{ id: { videoId?: string } }> }>('search', {
  part: 'snippet',
  q: searchQuery,
  type: 'video',
  regionCode: 'KR',
  relevanceLanguage: 'ko',
  order: 'viewCount',
  maxResults: '25',
});
const searchIds = (search.items ?? []).map((i) => i.id.videoId).filter((id): id is string => !!id);
const searchVideos = await yt('videos', { part: VIDEO_PART, id: searchIds.join(',') });

// 상세 화면의 구독자 수용: 목록에 나온 모든 채널 (channels.list는 호출당 최대 50개)
const channelIds = [
  ...new Set(
    [...(popular.items ?? []), ...(searchVideos.items ?? [])]
      .map((v) => v.snippet?.channelId)
      .filter((id): id is string => !!id),
  ),
];
const channelItems: unknown[] = [];
for (let i = 0; i < channelIds.length; i += 50) {
  const chunk = await yt('channels', { part: 'snippet,statistics', id: channelIds.slice(i, i + 50).join(',') });
  channelItems.push(...(chunk.items ?? []));
}

await save('videos-popular', popular);
await save('video-categories', categories);
await save('search', search);
await save('videos-search', searchVideos);
await save('channels', { kind: 'youtube#channelListResponse', items: channelItems });
await save('meta', { fetchedAt: new Date().toISOString(), regionCode: 'KR', searchQuery });

console.log(
  `저장 완료 → ${OUT_DIR}: 인기 ${popular.items?.length ?? 0}개, 카테고리 ${categories.items?.length ?? 0}개, ` +
    `검색("${searchQuery}") ${searchVideos.items?.length ?? 0}개, 채널 ${channelItems.length}개`,
);
