import { type ReactNode, useId } from 'react';
import { QuestionMarkCircledIcon } from '@radix-ui/react-icons';

/**
 * 제목 옆 ? 아이콘. 마우스를 올리거나 키보드로 초점을 주면 설명이 나타나고 Esc로 닫는다.
 * 제목 아래에 늘 깔던 기준·안내 문구를 여기로 옮겨 본문을 가볍게 한다.
 */
export default function HelpTip({
  children,
  label = '설명 보기',
  align = 'start',
}: {
  children: ReactNode;
  label?: string;
  /** 오른쪽 끝에 놓인 ?는 end로 두어 설명이 화면 밖으로 나가지 않게 한다. */
  align?: 'start' | 'end';
}) {
  const id = useId();
  return (
    <span className={`help-tip is-${align}`}>
      <button
        type="button"
        className="help-tip-trigger"
        aria-label={label}
        aria-describedby={id}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
      >
        <QuestionMarkCircledIcon aria-hidden="true" />
      </button>
      <span role="tooltip" id={id} className="help-tip-bubble">
        {children}
      </span>
    </span>
  );
}
