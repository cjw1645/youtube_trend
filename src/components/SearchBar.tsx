import { useEffect, useState, type FormEvent } from 'react';

interface Props {
  /** 현재 적용된 검색어 */
  value: string;
  onSearch: (q: string) => void;
}

/** 검색은 YouTube 할당량(100 unit/회)을 쓰므로 Enter 또는 버튼으로 제출할 때만 실행한다. */
export default function SearchBar({ value, onSearch }: Props) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (q !== value) onSearch(q);
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="flex w-full max-w-xl gap-2">
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="키워드로 영상 검색 (예: 브이로그, 먹방)"
        maxLength={100}
        aria-label="검색어"
        className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        검색
      </button>
    </form>
  );
}
