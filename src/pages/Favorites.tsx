import VideoCard from '../components/VideoCard';
import { EmptyFavoritesView } from '../components/StatusView';
import type { FavoritesController } from '../hooks/useFavorites';
import type { Video } from '../types/video';

interface Props {
  favorites: FavoritesController;
  categoryNames: ReadonlyMap<string, string>;
  onSelect: (video: Video) => void;
  onBrowse: () => void;
}

export default function Favorites({ favorites, categoryNames, onSelect, onBrowse }: Props) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold">관심 영상 <span className="text-zinc-500">{favorites.videos.length}개</span></h2>
        <p className="mt-1 text-sm text-zinc-500">이 브라우저에 저장한 영상입니다. 목록은 저장 당시 정보이며, 상세 보기에서 다시 조회합니다.</p>
      </div>
      {favorites.videos.length === 0 ? (
        <EmptyFavoritesView onBrowse={onBrowse} />
      ) : (
        <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {favorites.videos.map((video) => (
            <VideoCard key={video.id} video={video} categoryName={categoryNames.get(video.categoryId)} onSelect={onSelect} saved onFavoriteToggle={() => favorites.remove(video.id)} />
          ))}
        </div>
      )}
    </section>
  );
}
