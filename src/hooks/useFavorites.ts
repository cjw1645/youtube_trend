import { useCallback, useEffect, useRef, useState } from 'react';
import { FAVORITES_KEY, readFavorites, snapshotVideo, writeFavorites } from '../lib/favorites';
import { authedJson, getJson, toApiRequestError } from '../lib/api';
import { useAuth } from './useAuth';
import type { Video, VideosResponse } from '../types/video';

const getStorage = () => window.localStorage;

// 이 브라우저 저장소. 로그인 중에는 읽기만 하고 쓰지 않는다(계정 목록과 섞지 않음).
function useLocalFavorites() {
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
    persist(
      saved
        ? current.current.videos.filter((item) => item.id !== video.id)
        : [snapshotVideo(video), ...current.current.videos],
    );
  };

  return { videos: state.videos, error: state.error, loading: false, reload, remove, toggle };
}

// 계정 저장소. 서버에는 영상 ID만 저장하고 표시용 정보는 열 때 공개 API로 조회한다.
function useCloudFavorites(userId: string | null) {
  const { getToken } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const current = useRef<Video[]>([]);
  const owner = useRef<string | null>(userId);
  owner.current = userId;
  // 같은 영상의 연속 클릭은 앞선 요청이 끝난 뒤에만 처리한다.
  const pending = useRef(new Set<string>());

  const set = useCallback((next: Video[]) => {
    current.current = next;
    setVideos(next);
  }, []);

  useEffect(() => {
    // 계정이 바뀌면 이전 계정의 목록을 즉시 비운다.
    set([]);
    setError(null);
    pending.current.clear();
    if (!userId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      const token = await getToken();
      if (!token) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      const { ids } = await authedJson<{ ids: string[] }>('/api/favorites', token, 'GET');
      const loaded = new Map<string, Video>();
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const { items } = await getJson<VideosResponse>(`/api/videos?ids=${chunk.join(',')}`);
        for (const item of items) loaded.set(item.id, snapshotVideo(item));
      }
      // 삭제·비공개 영상은 표시하지 못하므로 제외한다(저장 ID는 유지).
      if (active) set(ids.flatMap((id) => (loaded.has(id) ? [loaded.get(id)!] : [])));
    })()
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error && !('code' in failure)
              ? failure.message
              : toApiRequestError(failure).message,
          );
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [userId, version, getToken, set]);

  const mutate = async (id: string, save: boolean, video?: Video) => {
    if (!userId || pending.current.has(id)) return;
    pending.current.add(id);
    const requestOwner = userId;
    try {
      const token = await getToken();
      if (!token) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      await authedJson('/api/favorites', token, save ? 'PUT' : 'DELETE', { videoId: id });
      // 응답이 돌아왔을 때 다른 계정으로 바뀌었다면 반영하지 않는다.
      if (owner.current !== requestOwner) return;
      set(
        save && video
          ? [snapshotVideo(video), ...current.current.filter((item) => item.id !== id)]
          : current.current.filter((item) => item.id !== id),
      );
      setError(null);
    } catch (failure) {
      if (owner.current === requestOwner)
        setError(
          failure instanceof Error && !('code' in failure)
            ? failure.message
            : toApiRequestError(failure).message,
        );
    } finally {
      pending.current.delete(id);
    }
  };

  return {
    videos,
    error,
    loading,
    reload: () => setVersion((value) => value + 1),
    remove: (id: string) => void mutate(id, false),
    toggle: (video: Video) =>
      void mutate(video.id, !current.current.some((item) => item.id === video.id), video),
  };
}

export function useFavorites() {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const local = useLocalFavorites();
  const cloud = useCloudFavorites(userId);
  // 세션 확인 중에는 로컬 목록을 보이지 않는다(잠깐 보였다가 바뀌는 혼동 방지).
  const source = userId ? cloud : auth.loading ? { ...local, videos: [] } : local;
  return {
    videos: source.videos,
    error: source.error,
    loading: source.loading,
    signedIn: Boolean(userId),
    reload: source.reload,
    remove: source.remove,
    toggle: source.toggle,
    has: (id: string) => source.videos.some((video) => video.id === id),
  };
}

export type FavoritesController = ReturnType<typeof useFavorites>;
