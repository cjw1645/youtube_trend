import VideoCard from '../components/VideoCard';
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
        <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center">
          <p className="text-lg font-semibold">아직 관심 영상이 없습니다</p>
          <p className="mt-2 text-sm text-zinc-500">영상 카드의 관심 영상 버튼을 눌러 저장해 보세요.</p>
          <button type="button" onClick={onBrowse} className="mt-4 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white">영상 둘러보기</button>
        </div>
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
