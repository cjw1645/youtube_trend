import { BookmarkFilledIcon, BookmarkIcon } from '@radix-ui/react-icons';
import { useAuth } from '../hooks/useAuth';
interface Props {
  saved: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}

/** 로그인 전 저장은 이 브라우저에만 남고 계정으로 옮겨지지 않는다. 저장하기 전에 알려 준다. */
export const GUEST_FAVORITE_HINT =
  '로그인 전에 저장한 영상은 이 브라우저에만 남고, 로그인하면 계정의 관심 영상 목록으로 바뀝니다.';

export default function FavoriteButton({ saved, title, onClick, disabled }: Props) {
  const { user } = useAuth();
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={`${title} ${saved ? '관심 영상 해제' : '관심 영상 저장'}`}
      title={!user && !saved ? GUEST_FAVORITE_HINT : undefined}
      onClick={onClick}
      disabled={disabled}
      className={`favorite-button ${saved ? 'is-saved' : ''}`}
    >
      {saved ? <BookmarkFilledIcon aria-hidden="true" /> : <BookmarkIcon aria-hidden="true" />}{' '}
      {saved ? '저장됨' : '관심 영상'}
    </button>
  );
}
