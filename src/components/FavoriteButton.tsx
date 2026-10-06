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
      className={`w-fit shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-red-600 disabled:opacity-40 ${saved ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'}`}
    >
      <span aria-hidden>{saved ? '♥' : '♡'}</span> {saved ? '저장됨' : '관심 영상'}
    </button>
  );
}
