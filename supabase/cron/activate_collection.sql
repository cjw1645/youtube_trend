-- 공통 수집 Cron 활성화 템플릿. 자동 실행되지 않는다(migrations 폴더 밖). 사용자 승인 후 Supabase SQL Editor에서 직접 실행한다.
-- 활성화 전 체크: docs/stage3-collection-runbook.md. 값(<...>)은 문서·채팅에 적지 않고 편집기에서 직접 채운다.

-- 1) pg_cron·pg_net·vault 확장 활성화(Dashboard → Database → Extensions).
-- 2) 수집 인증 비밀을 Vault에 저장(Vercel의 COLLECT_SECRET과 같은 값, 32자 이상).
-- select vault.create_secret('<COLLECT_SECRET>', 'collect_secret');

-- 3) 매시간 정각 수집. Vercel 함수 maxDuration(60초)에 맞춰 timeout을 둔다.
select cron.schedule('collect-popular', '0 * * * *', $job$
  select net.http_post(
    url := 'https://<배포-도메인>/api/collect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'collect_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

-- 3-2) 개인 검색 일괄 갱신: 매일 04:00 KST(19:00 UTC), 실패 대비 19:20 한 번 더(완료된 집합은 호출 없이 건너뜀).
select cron.schedule('collect-search', '0,20 19 * * *', $job$
  select net.http_post(
    url := 'https://<배포-도메인>/api/collect-search',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'collect_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

-- 4) 만료 데이터 정리(매일 03:10 KST = 18:10 UTC).
select cron.schedule('purge-expired', '10 18 * * *', $job$ select public.purge_expired() $job$);

-- 비활성화: select cron.unschedule('collect-popular'); select cron.unschedule('collect-search'); select cron.unschedule('purge-expired');
