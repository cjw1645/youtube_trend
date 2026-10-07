import VideoCard from '../components/VideoCard';
import { EmptyFavoritesView } from '../components/StatusView';
import type { FavoritesController } from '../hooks/useFavorites';
import type { Video } from '../types/video';
import type {ChatTarget} from '../lib/chat-session';
import {useAnalysisSelection} from '../hooks/useAnalysisSelection';
import AnalysisSelectionBar from '../components/AnalysisSelectionBar';

interface Props {
  favorites: FavoritesController;
  categoryNames: ReadonlyMap<string, string>;
  onSelect: (video: Video) => void;
  onBrowse: () => void;
  onAnalyze:(target:ChatTarget)=>void;
}

export default function Favorites({ favorites, categoryNames, onSelect, onBrowse,onAnalyze }: Props) {
  const selection=useAnalysisSelection(favorites.videos,'favorites');
  const analysisVideos=selection.enabled?selection.selected:favorites.videos;
  return (
    <section className="flex flex-col gap-5">
      <div><button className="primary-button" type="button" disabled={!analysisVideos.length} onClick={()=>onAnalyze({label:`관심 영상 · ${selection.enabled?'직접 선택':'전달 시점 기준'}`,videos:analysisVideos,source:'favorites'})}>{selection.enabled?`선택 ${analysisVideos.length}개로 AI 질문`:'이 목록으로 AI 질문'}</button></div>
      <AnalysisSelectionBar selection={selection} available={favorites.videos.length}/>
      <div>
        <h2 className="text-lg font-bold">관심 영상 <span className="text-zinc-500">{favorites.videos.length}개</span></h2>
        <p className="mt-1 text-sm text-zinc-500">이 브라우저에 저장한 영상입니다. 목록은 저장 당시 정보이며, 상세 보기에서 다시 조회합니다.</p>
      </div>
      {favorites.videos.length === 0 ? (
        <EmptyFavoritesView onBrowse={onBrowse} />
      ) : (
        <div className="video-grid">
          {favorites.videos.map((video) => (
            <VideoCard key={video.id} video={video} categoryName={categoryNames.get(video.categoryId)} onSelect={onSelect} saved onFavoriteToggle={() => favorites.remove(video.id)} analysisSelection={selection.enabled?{selected:selection.ids.includes(video.id),toggle:()=>selection.toggle(video.id)}:undefined}/>
          ))}
        </div>
      )}
    </section>
  );
}
