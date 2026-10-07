import type { AnalysisSelection } from '../hooks/useAnalysisSelection';
import { CheckIcon } from '@radix-ui/react-icons';
export default function AnalysisSelectionBar({
  selection,
  available,
}: {
  selection: AnalysisSelection;
  available: number;
}) {
  return (
    <section aria-label="분석 영상 직접 선택" className="selection-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        {!selection.enabled ? (
          <button
            className="secondary-button"
            type="button"
            disabled={!available}
            onClick={selection.start}
          >
            <CheckIcon aria-hidden="true" />
            분석 영상 직접 선택
          </button>
        ) : (
          <>
            <span role="status" className="mr-2 text-sm font-semibold">
              선택 {selection.selected.length} / 20개
            </span>
            <button className="secondary-button" type="button" onClick={selection.first}>
              앞쪽 최대 20개 선택
            </button>
            <button className="secondary-button" type="button" onClick={selection.clear}>
              선택 해제
            </button>
            <button className="secondary-button" type="button" onClick={selection.stop}>
              선택 종료
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        {selection.enabled
          ? '화면 순서로 전달합니다. 메뉴 이동은 선택을 유지하며, 새 조회·정렬·관심 목록 변경·새로고침은 초기화합니다.'
          : '원하는 영상 1~20개를 골라 AI 질문에 사용할 수 있습니다.'}
      </p>
      {selection.notice && (
        <p role="alert" className="text-sm text-amber-900">
          {selection.notice}
        </p>
      )}
    </section>
  );
}
