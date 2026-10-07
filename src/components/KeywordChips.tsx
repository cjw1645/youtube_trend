import { useMemo } from 'react';
import { aggregateKeywords } from '../lib/keywords';
import type { Video } from '../types/video';

/** 현재 조회된 목록 안의 키워드만 보여주며, 클릭하면 해당 키워드로 검색한다. */
export default function KeywordChips({
  videos,
  onSearch,
}: {
  videos: readonly Video[];
  onSearch: (keyword: string) => void;
}) {
  const keywords = useMemo(() => aggregateKeywords(videos), [videos]);
  if (!keywords.length) return null;
  return (
    <section className="keyword-row" aria-labelledby="keyword-row-title">
      <h3 id="keyword-row-title">
        현재 목록 {videos.length}개 기준 키워드 · 2개 이상 채널에 등장한 단어
      </h3>
      <ul>
        {keywords.map(({ keyword, channels }) => (
          <li key={keyword}>
            <button
              type="button"
              className="keyword-chip"
              aria-label={`${keyword} 검색 (현재 목록의 채널 ${channels}곳에 등장)`}
              onClick={() => onSearch(keyword)}
            >
              {keyword} <span aria-hidden="true">· 채널 {channels}곳</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
