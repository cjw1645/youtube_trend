import { useCallback, useRef, useState } from 'react';
import {
  readTargets,
  persistTargets,
  TARGET_KEY,
  type AnalysisTarget,
  type TargetStore,
} from '../lib/analysis-target';
export function useTargets() {
  const [initial] = useState(() => {
    try {
      const loaded = readTargets(sessionStorage);
      return {
        ...loaded,
        data: { ...loaded.data, active: loaded.data.active ?? loaded.data.lastHome },
      };
    } catch {
      return {
        data: { active: null, lastHome: null } as TargetStore,
        notice: '대상 저장소에 접근할 수 없습니다. 새로고침 복원이 제한됩니다.',
      };
    }
  });
  const [data, setData] = useState(initial.data);
  const [notice, setNotice] = useState(initial.notice);
  const current = useRef(initial.data);
  const update = useCallback((patch: Partial<TargetStore>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setData(next);
    try {
      persistTargets(sessionStorage, next);
    } catch {
      setNotice('대상을 메모리에서 사용하고 있습니다. 새로고침 후에는 복원되지 않을 수 있습니다.');
    }
  }, []);
  const setActive = useCallback((active: AnalysisTarget | null) => update({ active }), [update]);
  const setLastHome = useCallback(
    (lastHome: AnalysisTarget | null) => update({ lastHome }),
    [update],
  );
  function clear() {
    setData({ active: null, lastHome: null });
    current.current = { active: null, lastHome: null };
    try {
      sessionStorage.removeItem(TARGET_KEY);
      setNotice('대상 기록을 지웠습니다. 완료 대화와 관심 영상은 유지됩니다.');
    } catch {
      setNotice(
        '메모리 대상은 지웠지만 저장소 삭제에 실패했습니다. 새로고침 시 기록이 다시 나타날 수 있습니다.',
      );
    }
  }
  return { ...data, notice, setActive, setLastHome, clear };
}
