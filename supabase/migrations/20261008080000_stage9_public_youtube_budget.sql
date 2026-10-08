-- Stage 9: 로그인 없이 쓰는 공개 조회(인기 차트·영상 상세·관심 영상 ID 조회·카테고리)의 서비스 전체 하루 YouTube 유닛 예산.
-- 이 호출이 같은 API 키의 일일 쿼터를 소진해 수집·로그인 사용자의 검색·분석을 막지 못하도록 별도 장부로 상한을 둔다.
-- 소비는 기존 try_consume_quota / ensure_quota_row로 한다(서버 전용).
alter table public.quota_counters drop constraint if exists quota_counters_kind_check;
alter table public.quota_counters
  add constraint quota_counters_kind_check
  check (kind in ('search', 'ai_requests', 'ai_tokens', 'youtube_units', 'general_search', 'public_youtube'));
