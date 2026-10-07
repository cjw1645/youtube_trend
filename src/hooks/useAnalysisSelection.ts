import { useEffect, useRef, useState } from 'react';
import { toggleAnalysisId, selectedAnalysisVideos } from '../lib/analysis-selection';
import type { Video } from '../types/video';
export function useAnalysisSelection(videos: readonly Video[], scope: string) {
  const [enabled, setEnabled] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const current = useRef(ids);
  const [notice, setNotice] = useState('');
  const reset = () => {
    current.current = [];
    setIds([]);
    setEnabled(false);
    setNotice('');
  };
  useEffect(reset, [videos, scope]);
  const toggle = (id: string) => {
    if (!videos.some((video) => video.id === id)) return;
    const next = toggleAnalysisId(current.current, id);
    current.current = next.ids;
    setIds(next.ids);
    setNotice(
      next.limited ? '최대 20개까지 선택할 수 있습니다. 기존 선택을 해제한 뒤 추가해 주세요.' : '',
    );
  };
  const set = (next: string[]) => {
    current.current = next;
    setIds(next);
    setNotice('');
  };
  return {
    enabled,
    ids,
    notice,
    toggle,
    selected: selectedAnalysisVideos(videos, ids),
    start: () => {
      setEnabled(true);
      set([]);
    },
    stop: reset,
    clear: () => set([]),
    first: () => set(videos.slice(0, 20).map((video) => video.id)),
  };
}
export type AnalysisSelection = ReturnType<typeof useAnalysisSelection>;
