import type { Category, SortOrder } from '../types/video';
import { ResetIcon } from '@radix-ui/react-icons';
interface Props {
  categories: Category[];
  categoryId: string;
  onCategoryChange: (id: string) => void;
  order: SortOrder | '';
  onOrderChange: (order: SortOrder | '') => void;
  onApply: () => void;
  onReset: () => void;
}
export default function FilterBar({
  categories,
  categoryId,
  onCategoryChange,
  order,
  onOrderChange,
  onApply,
  onReset,
}: Props) {
  return (
    <div className="filter-bar">
      <label>
        카테고리
        <select value={categoryId} onChange={(event) => onCategoryChange(event.target.value)}>
          <option value="">전체 카테고리</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        정렬
        <select
          value={order}
          onChange={(event) => onOrderChange(event.target.value as SortOrder | '')}
        >
          <option value="">인기순</option>
          <option value="viewCount">조회수순</option>
          <option value="date">최신순</option>
        </select>
      </label>
      <button type="button" className="secondary-button" onClick={onApply}>
        적용
      </button>
      <button type="button" className="secondary-button" onClick={onReset}>
        <ResetIcon aria-hidden="true" />
        초기화
      </button>
    </div>
  );
}
