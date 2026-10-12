import { useEffect, useState } from 'react';
import { ArrowRightIcon } from '@radix-ui/react-icons';
import { useSearchSlots } from '../hooks/useSearchSlots';
import { historyVerdict } from '../lib/own-history';
import type { OwnHistory } from '../types/trend';

/**
 * 홈 맨 위의 「내 주제」: 로그인 사용자가 추가한 검색어마다 평소 대비 판정 한 문장.
 * 검색어가 없으면 추가를 안내한다. 로그아웃 상태에서는 그리지 않는다.
 */
export default function MyTopics({ onOpen }: { onOpen: () => void }) {
  const { slots, loaded, call } = useSearchSlots();
  const [histories, setHistories] = useState<Record<number, OwnHistory | null>>({});
  const slotKey = slots.map((s) => `${s.slot}:${s.snapshot?.run_id ?? ''}`).join(',');

  useEffect(() => {
    let active = true;
    setHistories({});
    for (const view of slots) {
      if (!view.snapshot) continue;
      call<{ history: OwnHistory | null }>(`/api/search-history?slot=${view.slot}`, 'GET')
        .then((r) => active && setHistories((now) => ({ ...now, [view.slot]: r.history })))
        .catch(() => active && setHistories((now) => ({ ...now, [view.slot]: null })));
    }
    return () => {
      active = false;
    };
    // slotKey가 슬롯 구성과 최신 수집을 대표한다(목록을 다시 받아도 같으면 다시 부르지 않는다).
  }, [slotKey, call]);

  if (!loaded) return null;
  return (
    <section className="my-topics" aria-labelledby="my-topics-title">
      <h2 id="my-topics-title">내 주제, 오늘은 평소보다?</h2>
      {slots.length === 0 ? (
        <div className="my-topics-empty">
          <p>
            내 채널 주제를 검색어로 추가하면 매일 수집해, 그 주제가 평소보다 오르는지 한 문장으로
            알려 드립니다. 이미 다른 사람이 추적 중인 검색어면 지난 기록으로 바로 비교합니다.
          </p>
          <button type="button" className="primary-button" onClick={onOpen}>
            검색어 추가하러 가기 <ArrowRightIcon aria-hidden="true" />
          </button>
        </div>
      ) : (
        <ul>
          {slots.map((view) => {
            const history = histories[view.slot];
            const verdict = history ? historyVerdict(history) : null;
            return (
              <li key={view.slot}>
                <button type="button" className="my-topic" onClick={onOpen}>
                  <span className={`my-topic-verdict is-${verdict?.tone ?? 'collecting'}`}>
                    {verdict
                      ? verdict.headline
                      : `‘${view.conditions.query}’ · ${
                          !view.snapshot
                            ? '첫 수집을 기다리는 중입니다'
                            : history === undefined
                              ? '불러오는 중…'
                              : '아직 비교할 기록이 없습니다'
                        }`}
                  </span>
                  {verdict && <span className="my-topic-detail">{verdict.detail}</span>}
                  <span className="my-topic-more">
                    대시보드에서 보기 <ArrowRightIcon aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
