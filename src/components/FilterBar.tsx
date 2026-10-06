import type { Category, SortOrder } from '../types/video';

interface Props {
  categories: Category[];
  categoryId: string;
  onCategoryChange: (id: string) => void;
  order: SortOrder | '';
  onOrderChange: (order: SortOrder | '') => void;
  /** 검색 중이면 기본 정렬 이름이 "관련도순", 아니면 "인기 순위" */
  searching: boolean;
}

export default function FilterBar({ categories, categoryId, onCategoryChange, order, onOrderChange, searching }: Props) {
  const tabs = [{ id: '', title: '전체' }, ...categories];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="카테고리" className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2 whitespace-nowrap">
          {tabs.map((tab) => {
            const active = tab.id === categoryId;
            return (
              <li key={tab.id || 'all'}>
                <button
                  type="button"
                  onClick={() => onCategoryChange(tab.id)}
                  aria-pressed={active}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                  }`}
                >
                  {tab.title}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <label className="flex shrink-0 items-center gap-2 text-sm text-zinc-600">
        정렬
        <select
          value={order}
          onChange={(e) => onOrderChange(e.target.value as SortOrder | '')}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800"
        >
          <option value="">{searching ? '관련도순' : '인기 순위'}</option>
          <option value="viewCount">조회수순</option>
          <option value="date">최신순</option>
        </select>
      </label>
    </div>
  );
}
