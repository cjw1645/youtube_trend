import VideoCard from '../components/VideoCard';
import { EmptyFavoritesView } from '../components/StatusView';
import type { FavoritesController } from '../hooks/useFavorites';
import type { Video } from '../types/video';
import type { ChatTarget } from '../lib/chat-session';
import { useAnalysisSelection } from '../hooks/useAnalysisSelection';
import AnalysisSelectionBar from '../components/AnalysisSelectionBar';
import HelpTip from '../components/HelpTip';

interface Props {
  favorites: FavoritesController;
  categoryNames: ReadonlyMap<string, string>;
  onSelect: (video: Video) => void;
  onBrowse: () => void;
  onAnalyze: (target: ChatTarget) => void;
}

export default function Favorites({
  favorites,
  categoryNames,
  onSelect,
  onBrowse,
  onAnalyze,
}: Props) {
  const selection = useAnalysisSelection(favorites.videos, 'favorites');
  const analysisVideos = selection.enabled ? selection.selected : favorites.videos;
  return (
    <section className="flex flex-col gap-5">
      <p className="favorites-note">
        {favorites.signedIn
          ? '로그인한 계정의 관심 영상입니다. 로그인 전에 이 브라우저에 저장했던 목록은 계정으로 옮기지 않으며, 로그아웃하면 다시 표시됩니다.'
          : '지금은 이 브라우저에만 저장됩니다. 로그인하면 계정의 관심 영상 목록으로 바뀌고, 지금 저장한 영상은 계정으로 옮겨지지 않지만 로그아웃하면 다시 보입니다.'}
      </p>
      {favorites.loading && (
        <p role="status" className="text-sm">
          관심 영상을 불러오는 중…
        </p>
      )}
      <header className="section-head">
        <div className="title-row">
          <h2>
            관심 영상 <span className="text-zinc-500">{favorites.videos.length}개</span>
          </h2>
          <HelpTip label="관심 영상 목록 설명 보기">
            {favorites.signedIn
              ? '로그인한 계정에 저장된 영상입니다.'
              : '이 브라우저에 저장한 영상입니다.'}{' '}
            목록은 저장 당시 정보이며, 상세 보기에서 다시 조회합니다.
          </HelpTip>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={!analysisVideos.length}
          onClick={() =>
            onAnalyze({
              label: `관심 영상 · ${selection.enabled ? '직접 선택' : '전달 시점 기준'}`,
              videos: analysisVideos,
              source: 'favorites',
              rankingSource: selection.enabled ? 'selection' : 'favorites',
            })
          }
        >
          {selection.enabled ? `선택 ${analysisVideos.length}개로 AI 질문` : '상위 20개로 AI 질문'}
        </button>
      </header>
      <AnalysisSelectionBar selection={selection} available={favorites.videos.length} />
      {favorites.videos.length === 0 ? (
        <EmptyFavoritesView onBrowse={onBrowse} />
      ) : (
        <div className="video-grid">
          {favorites.videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              categoryName={categoryNames.get(video.categoryId)}
              onSelect={onSelect}
              saved
              onFavoriteToggle={() => favorites.remove(video.id)}
              analysisSelection={
                selection.enabled
                  ? {
                      selected: selection.ids.includes(video.id),
                      toggle: () => selection.toggle(video.id),
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
