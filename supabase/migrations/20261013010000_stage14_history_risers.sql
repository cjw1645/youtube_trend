-- Stage 14: 평소 대비 원자료에 최근 이틀 수집의 영상 ID·제목을 더한다.
-- 판정이 「비슷함」이거나 비교할 수 없는 날에도 「이 주제에서 지금 빠르게 크는 영상」을 보여 주기 위함이다.
-- 오래된 수집은 판정용 숫자만 돌려 응답을 작게 유지한다. 나머지는 Stage 13과 같다.
create or replace function public.get_slot_history(
  p_user uuid, p_slot smallint, p_days integer default 28)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  set_id bigint;
  qn text;
  latest timestamptz;
begin
  select u.search_set_id, s.query_norm into set_id, qn
    from user_search_slots u join search_sets s on s.id = u.search_set_id
   where u.user_id = p_user and u.slot = p_slot;
  if not found then return null; end if;

  select max(scheduled_for) into latest from collection_runs
   where kind = 'search' and status = 'complete' and search_set_id = set_id;
  if latest is null then return null; end if;

  return jsonb_build_object(
    'query', qn,
    'runs', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'runId', r.id, 'scheduledFor', r.scheduled_for, 'itemCount', r.item_count,
          'prevScheduledFor', prev.scheduled_for,
          'videos', (select coalesce(jsonb_agg(
                        jsonb_build_object(
                          'ageHours', round(extract(epoch from o.observed_at - v.published_at) / 3600),
                          'dailyGain', case when o.view_count is not null and p.view_count is not null and o.observed_at > p.observed_at
                            then round((o.view_count - p.view_count) * 86400.0 / extract(epoch from o.observed_at - p.observed_at)) end)
                        || case when r.scheduled_for > latest - interval '48 hours'
                             then jsonb_build_object('videoId', o.video_id, 'title', v.title) else '{}'::jsonb end), '[]'::jsonb)
                     from video_observations o join video_versions v on v.id = o.version_id
                     left join video_observations p on p.run_id = prev.id and p.video_id = o.video_id
                     where o.run_id = r.id))
        order by r.scheduled_for), '[]'::jsonb)
      from collection_runs r
      left join lateral (
        select c.id, c.scheduled_for from collection_runs c
         where c.kind = 'search' and c.status = 'complete' and c.search_set_id = set_id
           and c.scheduled_for between r.scheduled_for - interval '30 hours' and r.scheduled_for - interval '18 hours'
         order by abs(extract(epoch from c.scheduled_for - (r.scheduled_for - interval '24 hours'))), c.scheduled_for desc
         limit 1) prev on true
      where r.kind = 'search' and r.status = 'complete' and r.search_set_id = set_id
        and r.scheduled_for > latest - make_interval(days => greatest(1, least(p_days, 60))))
  );
end $$;
revoke all on function public.get_slot_history(uuid, smallint, integer) from public;
grant execute on function public.get_slot_history(uuid, smallint, integer) to service_role;
