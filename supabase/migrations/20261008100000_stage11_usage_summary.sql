-- Stage 11: 로그인 사용자의 오늘(Asia/Seoul) 사용량 요약. 화면의 「오늘 남은 질문·검색 횟수」 표시용.
-- reserve_ai_request / reserve_search와 같은 기준으로 센다: released(호출 전 실패로 반환)는 제외하고,
-- AI는 요청 수, 검색은 search.list 호출 유닛 합이다. 사용자 id는 서버가 토큰에서 정한다. 서버 전용(service_role).
create or replace function public.get_usage_summary(p_user uuid, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'aiUsed', coalesce(sum(units) filter (where kind = 'ai'), 0),
    'searchUsed', coalesce(sum(units) filter (where kind = 'search'), 0))
  from usage_reservations
  where user_id = p_user and status <> 'released' and kst_day(created_at) = kst_day(p_now)
$$;
revoke all on function public.get_usage_summary(uuid, timestamptz) from public;
grant execute on function public.get_usage_summary(uuid, timestamptz) to service_role;
