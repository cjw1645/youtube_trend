-- Stage 12: 인기 차트 비교에 「하루 조회수 증가」 원자료를 더한다.
-- 누적 조회수는 오래된 영상일수록 크므로, 같은 영상을 약 24시간 전 수집(18~30시간 전 중 24시간에 가장 가까운 완료 실행)과
-- 이번 수집에서 모두 찾아 늘어난 조회수를 24시간 기준으로 환산한다(dailyGain). 두 수집 중 하나에 없거나 조회수가 비공개면 null.
-- 검색은 같은 검색 집합의 이전 실행, 인기 차트는 이전 인기 실행과 비교한다. 비율·중앙값·문장은 서버(TypeScript)가 계산한다.
-- 같은 나이대끼리 누적 조회수를 비교할 수 있도록 영상마다 관측 시점의 업로드 후 경과 시간(ageHours, 정수 시간)도 돌려준다.
-- 시그니처는 Stage 10과 같으며 기존 필드는 그대로 두고 필드만 더한다.
create or replace function public.get_slot_popular_compare(
  p_user uuid, p_slot smallint, p_tolerance interval default interval '26 hours')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  slot_run collection_runs;
  pop_run collection_runs;
  slot_prev collection_runs;
  pop_prev collection_runs;
  qn text;
begin
  select r.* into slot_run
    from user_search_slots u
    join collection_runs r on r.kind = 'search' and r.search_set_id = u.search_set_id and r.status = 'complete'
   where u.user_id = p_user and u.slot = p_slot
   order by r.scheduled_for desc limit 1;
  if not found then return null; end if;

  select query_norm into qn from search_sets where id = slot_run.search_set_id;

  select * into pop_run from collection_runs
   where kind = 'popular' and status = 'complete'
     and abs(extract(epoch from scheduled_for - slot_run.scheduled_for)) <= extract(epoch from p_tolerance)
   order by abs(extract(epoch from scheduled_for - slot_run.scheduled_for)), scheduled_for desc
   limit 1;

  if not found then
    return jsonb_build_object('query', qn, 'slotRunId', slot_run.id, 'slotScheduledFor', slot_run.scheduled_for,
      'slotItemCount', slot_run.item_count, 'popularRunId', null);
  end if;

  -- 약 24시간 전 실행. 없으면 레코드가 null로 남고 아래 조인이 비어 dailyGain이 모두 null이 된다.
  select * into slot_prev from collection_runs
   where kind = 'search' and status = 'complete' and search_set_id = slot_run.search_set_id
     and scheduled_for between slot_run.scheduled_for - interval '30 hours'
                           and slot_run.scheduled_for - interval '18 hours'
   order by abs(extract(epoch from scheduled_for - (slot_run.scheduled_for - interval '24 hours'))), scheduled_for desc
   limit 1;

  select * into pop_prev from collection_runs
   where kind = 'popular' and status = 'complete'
     and scheduled_for between pop_run.scheduled_for - interval '30 hours'
                           and pop_run.scheduled_for - interval '18 hours'
   order by abs(extract(epoch from scheduled_for - (pop_run.scheduled_for - interval '24 hours'))), scheduled_for desc
   limit 1;

  return jsonb_build_object(
    'query', qn, 'slotRunId', slot_run.id, 'slotScheduledFor', slot_run.scheduled_for, 'slotItemCount', slot_run.item_count,
    'popularRunId', pop_run.id, 'popularScheduledFor', pop_run.scheduled_for, 'popularItemCount', pop_run.item_count,
    'slotPrevScheduledFor', slot_prev.scheduled_for,
    'popularPrevScheduledFor', pop_prev.scheduled_for,
    'slotKeywords', (select coalesce(jsonb_agg(jsonb_build_object('keyword', keyword, 'videoCount', video_count)
                       order by video_count desc, keyword), '[]'::jsonb)
                     from keyword_counts where run_id = slot_run.id),
    'popularKeywords', (select coalesce(jsonb_agg(jsonb_build_object('keyword', keyword, 'videoCount', video_count)
                          order by video_count desc, keyword), '[]'::jsonb)
                        from keyword_counts where run_id = pop_run.id),
    'slotCategories', (select coalesce(jsonb_agg(jsonb_build_object('categoryId', category_id, 'videoCount', video_count)), '[]'::jsonb)
                       from category_counts where run_id = slot_run.id),
    'popularCategories', (select coalesce(jsonb_agg(jsonb_build_object('categoryId', category_id, 'videoCount', video_count)), '[]'::jsonb)
                          from category_counts where run_id = pop_run.id),
    'slotVideos', (select coalesce(jsonb_agg(jsonb_build_object('viewCount', o.view_count, 'likeCount', o.like_count,
                     'ageHours', round(extract(epoch from o.observed_at - v.published_at) / 3600),
                     'dailyGain', case when o.view_count is not null and p.view_count is not null and o.observed_at > p.observed_at
                       then round((o.view_count - p.view_count) * 86400.0 / extract(epoch from o.observed_at - p.observed_at)) end)), '[]'::jsonb)
                   from video_observations o join video_versions v on v.id = o.version_id
                   left join video_observations p on p.run_id = slot_prev.id and p.video_id = o.video_id
                   where o.run_id = slot_run.id),
    'popularVideos', (select coalesce(jsonb_agg(jsonb_build_object('title', v.title, 'tags', to_jsonb(v.tags),
                        'viewCount', o.view_count, 'likeCount', o.like_count,
                        'ageHours', round(extract(epoch from o.observed_at - v.published_at) / 3600),
                        'dailyGain', case when o.view_count is not null and p.view_count is not null and o.observed_at > p.observed_at
                          then round((o.view_count - p.view_count) * 86400.0 / extract(epoch from o.observed_at - p.observed_at)) end)), '[]'::jsonb)
                      from video_observations o join video_versions v on v.id = o.version_id
                      left join video_observations p on p.run_id = pop_prev.id and p.video_id = o.video_id
                      where o.run_id = pop_run.id),
    'videoOverlap', (select coalesce(jsonb_agg(jsonb_build_object('videoId', s.video_id, 'slotPosition', s.position,
                       'popularPosition', p.position) order by p.position), '[]'::jsonb)
                     from video_observations s
                     join video_observations p on p.video_id = s.video_id and p.run_id = pop_run.id
                     where s.run_id = slot_run.id)
  );
end $$;
revoke all on function public.get_slot_popular_compare(uuid, smallint, interval) from public;
grant execute on function public.get_slot_popular_compare(uuid, smallint, interval) to service_role;
