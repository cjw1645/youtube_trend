import type { ReactNode } from 'react';
import { InfoCircledIcon } from '@radix-ui/react-icons';

/** 상시 노출하던 기준 설명을 접어 두되 키보드로 펼칠 수 있게 한다. */
export default function InfoDisclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="info-disclosure">
      <summary>
        <InfoCircledIcon aria-hidden="true" />
        {summary}
      </summary>
      <div className="info-disclosure-body">{children}</div>
    </details>
  );
}
