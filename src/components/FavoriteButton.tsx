import { BookmarkFilledIcon, BookmarkIcon } from '@radix-ui/react-icons';
interface Props {
  saved: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}

export default function FavoriteButton({ saved, title, onClick, disabled }: Props) {
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={`${title} ${saved ? '관심 영상 해제' : '관심 영상 저장'}`}
      onClick={onClick}
      disabled={disabled}
      className={`favorite-button ${saved ? 'is-saved' : ''}`}
    >
      {saved ? <BookmarkFilledIcon aria-hidden="true" /> : <BookmarkIcon aria-hidden="true" />}{' '}
      {saved ? '저장됨' : '관심 영상'}
    </button>
  );
}
