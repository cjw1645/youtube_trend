-- Stage 7: 일반 영상 검색(/api/videos?q=, 로그인 없음)의 서비스 전체 하루 예산 종류 추가.
-- 개인 검색어 대시보드의 'search' 예산과 분리해 서로를 소진시키지 않게 한다.
-- 소비는 기존 try_consume_quota / ensure_quota_row로 한다(서버 전용).
alter table public.quota_counters drop constraint quota_counters_kind_check;
alter table public.quota_counters
  add constraint quota_counters_kind_check
  check (kind in ('search', 'ai_requests', 'ai_tokens', 'youtube_units', 'general_search'));
