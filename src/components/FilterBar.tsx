import type { Category, SortOrder } from '../types/video';
interface Props {
  categories: Category[];
  categoryId: string;
  onCategoryChange: (id: string) => void;
  order: SortOrder | '';
  onOrderChange: (order: SortOrder | '') => void;
  searching: boolean;
  onApply: () => void;
  onReset: () => void;
}
export default function FilterBar({ categories, categoryId, onCategoryChange, order, onOrderChange, searching, onApply, onReset }: Props) {
  return <div className="filter-bar">
    <label>카테고리<select value={categoryId} onChange={event => onCategoryChange(event.target.value)}><option value="">전체 카테고리</option>{categories.map(category => <option key={category.id} value={category.id}>{category.title}</option>)}</select></label>
    <label>정렬<select value={order} onChange={event => onOrderChange(event.target.value as SortOrder | '')}><option value="">{searching ? '기본 · 관련도순' : categoryId ? '기본 · 조회수순' : 'API 제공 순서'}</option><option value="viewCount">조회수순</option><option value="date">최신순</option></select></label>
    <button type="button" className="primary-button" onClick={onApply}>적용</button>
    <button type="button" className="secondary-button" onClick={onReset}>초기화</button>
  </div>;
}
