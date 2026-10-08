import type { CSSProperties, ElementType, ReactNode } from 'react';
import { useReveal } from '../hooks/useReveal';

/** 스크롤해서 화면에 들어오면 아래에서 떠오르며 나타나는 틀. delay로 나란한 블록을 순서대로 보여준다. */
export default function Reveal({
  as: Tag = 'div',
  className = '',
  delay = 0,
  children,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  delay?: number;
  children: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const [ref, seen] = useReveal<HTMLElement>();
  return (
    <Tag
      ref={ref}
      className={`reveal ${seen ? 'is-visible' : ''} ${className}`}
      style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}
