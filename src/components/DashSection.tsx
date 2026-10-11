import { type ReactNode, useId } from 'react';
import { useReveal } from '../hooks/useReveal';
import HelpTip from './HelpTip';

/** 구역 공통 틀: 상자 없이 제목을 두고 계산 기준은 ? 설명에 넣는다. 스크롤해서 보이면 떠오르며 나타난다. */
export default function DashSection({
  title,
  basis,
  children,
  className = '',
}: {
  title: string;
  basis: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const [ref, seen] = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      className={`dash-section reveal ${seen ? 'is-visible' : ''} ${className}`}
      aria-labelledby={id}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <HelpTip label={`${title} 기준 보기`}>{basis}</HelpTip>
      </header>
      {children}
    </section>
  );
}
