import { Cross2Icon } from '@radix-ui/react-icons';
import type { SlotView } from '../types/trend';
import { ORDER_LABEL, WINDOW_LABEL } from './AddSearchPopover';

interface Props {
  slots: readonly SlotView[];
  selected: 1 | 2 | null;
  busy: boolean;
  message: string | null;
  /** 로그인 여부를 몰라도 되도록 상위가 넘기는 빈 상태 문구 */
  emptyText: string;
  onSelect: (slot: 1 | 2) => void;
  onRemove: (slot: 1 | 2) => void;
}

/** 등록한 「내 검색어」 탭 줄. 선택하면 바로 아래에 그 검색어의 대시보드가 나온다. */
export default function SearchTabs({
  slots,
  selected,
  busy,
  message,
  emptyText,
  onSelect,
  onRemove,
}: Props) {
  return (
    <div className="search-tabs">
      {slots.length ? (
        <nav className="dash-tabs search-tab-row" aria-label="내 검색어">
          {slots.map((item) => (
            <span key={item.slot} className="search-tab">
              <button
                type="button"
                aria-pressed={selected === item.slot}
                onClick={() => onSelect(item.slot)}
                title={`${ORDER_LABEL[item.conditions.order]} · ${WINDOW_LABEL[item.conditions.window]}`}
              >
                {item.conditions.query}
              </button>
              <button
                type="button"
                className="tab-remove"
                disabled={busy}
                aria-label={`${item.conditions.query} 검색어 해제`}
                onClick={() => onRemove(item.slot)}
              >
                <Cross2Icon aria-hidden="true" />
              </button>
            </span>
          ))}
        </nav>
      ) : (
        <p className="search-tabs-empty">{emptyText}</p>
      )}
      {message && (
        <p role="status" className="trend-note">
          {message}
        </p>
      )}
    </div>
  );
}
