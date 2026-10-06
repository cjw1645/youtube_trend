import { useEffect, useRef, useState } from 'react';
import { FAVORITES_KEY, readFavorites, snapshotVideo, writeFavorites } from '../lib/favorites';
import type { Video } from '../types/video';

const getStorage = () => window.localStorage;

export function useFavorites() {
  const [state, setState] = useState(() => readFavorites(getStorage));
  const current = useRef(state);

  const reload = () => {
    const next = readFavorites(getStorage);
    current.current = next;
    setState(next);
  };

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === FAVORITES_KEY || event.key === null) {
        const next = readFavorites(getStorage);
        current.current = next;
        setState(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 저장 성공 시에만 상태를 바꾼다. 연속 클릭도 ref의 최신 상태에서 처리한다.
  const persist = (videos: Video[]) => {
    const error = writeFavorites(getStorage, videos);
    const next = { videos: error ? current.current.videos : videos, error };
    current.current = next;
    setState(next);
  };

  const remove = (id: string) => persist(current.current.videos.filter((video) => video.id !== id));
  const toggle = (video: Video) => {
    const saved = current.current.videos.some((item) => item.id === video.id);
    persist(saved ? current.current.videos.filter((item) => item.id !== video.id) : [snapshotVideo(video), ...current.current.videos]);
  };

  return { videos: state.videos, error: state.error, reload, remove, toggle, has: (id: string) => state.videos.some((video) => video.id === id) };
}

export type FavoritesController = ReturnType<typeof useFavorites>;
