import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
interface Props {
  value: string;
  onChange: (q: string) => void;
  onSearch: () => void;
}
/** 타이핑은 대기 조건만 바꾸고 명시적 제출 시 조회한다. */
export default function SearchBar({ value, onChange, onSearch }: Props) {
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
      className="search-form"
    >
      <div className="search-input">
        <MagnifyingGlassIcon aria-hidden="true" />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat)
            )
              event.preventDefault();
          }}
          placeholder="키워드로 영상 검색"
          maxLength={100}
          aria-label="검색어"
        />
      </div>
      <button type="submit" className="primary-button">
        검색
      </button>
    </form>
  );
}
