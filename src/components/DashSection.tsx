import { type ReactNode, useId } from 'react';

/** 구역 공통 틀: 상자 없이 제목과 계산 기준을 한 줄에 둔다. */
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
  return (
    <section className={`dash-section ${className}`} aria-labelledby={id}>
      <header>
        <h2 id={id}>{title}</h2>
        <p>{basis}</p>
      </header>
      {children}
    </section>
  );
}
