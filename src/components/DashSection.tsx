import { type ReactNode, useId } from 'react';
import { useReveal } from '../hooks/useReveal';

/** 구역 공통 틀: 상자 없이 제목과 계산 기준을 한 줄에 둔다. 스크롤해서 보이면 떠오르며 나타난다. */
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
        <p>{basis}</p>
      </header>
      {children}
    </section>
  );
}
