-- Stage 15: 평소 대비의 「전날 수집」 범위를 18~30시간 전에서 12~36시간 전으로 넓힌다.
-- 검색어를 오후에 추가하면 첫 수집 다음 정기 수집(04:00)까지 12시간 남짓이라 둘째 날이 비교에서 빠졌다.
-- 하루 증가는 원래 두 수집 사이 경과 시간으로 24시간 환산하므로 간격이 달라도 같은 단위다. 나머지는 Stage 14와 같다.
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
           and c.scheduled_for between r.scheduled_for - interval '36 hours' and r.scheduled_for - interval '12 hours'
         order by abs(extract(epoch from c.scheduled_for - (r.scheduled_for - interval '24 hours'))), c.scheduled_for desc
         limit 1) prev on true
      where r.kind = 'search' and r.status = 'complete' and r.search_set_id = set_id
        and r.scheduled_for > latest - make_interval(days => greatest(1, least(p_days, 60))))
  );
end $$;
revoke all on function public.get_slot_history(uuid, smallint, integer) from public;
grant execute on function public.get_slot_history(uuid, smallint, integer) to service_role;
