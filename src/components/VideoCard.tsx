import { formatCount, formatDate, formatDuration, formatRelativeDate } from '../lib/format';
import type { Video } from '../types/video';
import FavoriteButton from './FavoriteButton';

interface Props {
  video: Video;
  categoryName?: string;
  /** 목록에서의 순위 (인기 순위 표시용, 없으면 숨김) */
  rank?: number;
  onSelect: (video: Video) => void;
  saved: boolean;
  onFavoriteToggle: () => void;
}

export default function VideoCard({ video, categoryName, rank, onSelect, saved, onFavoriteToggle }: Props) {
  return (
    <article className="group flex flex-col">
      <button
        type="button"
        onClick={() => onSelect(video)}
        aria-label={`${video.title} 상세 보기`}
        className="relative block aspect-video overflow-hidden rounded-xl bg-zinc-200 focus-visible:outline-2 focus-visible:outline-red-600"
      >
        <img
          src={video.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {rank !== undefined && (
          <span className="absolute left-2 top-2 rounded-md bg-black/75 px-2 py-0.5 text-xs font-bold text-white">
            {rank}
          </span>
        )}
        {video.durationSeconds > 0 && (
          <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(video.durationSeconds)}
          </span>
        )}
      </button>

      <div className="mt-3 flex flex-1 flex-col gap-1">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-zinc-900">
          <button type="button" onClick={() => onSelect(video)} className="text-left hover:underline focus-visible:outline-2 focus-visible:outline-red-600" title={video.title}>
            {video.title}
          </button>
        </h3>
        <p className="truncate text-sm text-zinc-600">{video.channelTitle}</p>
        <p className="text-sm text-zinc-500">
          조회수 <span className="font-medium text-zinc-700">{formatCount(video.viewCount)}</span>
          <span className="mx-1.5">·</span>
          <time dateTime={video.publishedAt} title={formatDate(video.publishedAt)}>
            {formatRelativeDate(video.publishedAt)}
          </time>
        </p>
        {categoryName && (
          <span className="mt-1 w-fit rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{categoryName}</span>
        )}
        <div className="mt-2"><FavoriteButton saved={saved} title={video.title} onClick={onFavoriteToggle} /></div>
      </div>
    </article>
  );
}
