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
      <h3 id="keyword-row-title">현재 목록 {videos.length}개 기준 키워드</h3>
      <ul>
        {keywords.map(({ keyword, count }) => (
          <li key={keyword}>
            <button
              type="button"
              className="keyword-chip"
              aria-label={`${keyword} 검색 (현재 목록 영상 ${count}개에 등장)`}
              onClick={() => onSearch(keyword)}
            >
              {keyword} <span aria-hidden="true">· {count}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
