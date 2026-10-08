import { useUsage, type Usage } from '../hooks/useUsage';

const left = (entry: Usage['ai']) => Math.max(entry.limit - entry.used, 0);

/** 화면 위쪽에 두는 오늘의 남은 횟수. 0이 되면 눈에 띄게 하고, 하루 단위(한국 시간 자정 초기화)임을 알린다. */
export default function UsageBadge() {
  const usage = useUsage();
  if (!usage) return null;
  const ai = left(usage.ai);
  const search = left(usage.search);
  return (
    <ul
      className="usage-badge"
      aria-label="오늘 남은 사용 횟수"
      title="하루 사용 한도입니다. 한국 시간 자정에 초기화됩니다."
    >
      <li className={ai === 0 ? 'is-empty' : ai <= 2 ? 'is-low' : undefined}>
        AI 질문 <strong>{ai}</strong>
        <small>/{usage.ai.limit}회 남음</small>
      </li>
      <li className={search === 0 ? 'is-empty' : search <= 8 ? 'is-low' : undefined}>
        검색 <strong>{search}</strong>
        <small>/{usage.search.limit}회 남음</small>
      </li>
    </ul>
  );
}
