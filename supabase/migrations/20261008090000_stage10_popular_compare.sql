-- Stage 10: 내 검색어(슬롯)의 최신 완료 검색 수집과, 그 시각에 가장 가까운 완료 인기 차트 수집을 비교하는 원자료.
-- 비율·순위·중앙값·문장은 서버(TypeScript)가 계산한다. 이 함수는 양쪽 실행의 키워드·카테고리 집계, 영상 겹침, 영상별 조회수·좋아요(인기 쪽은 제목·태그 포함)만 돌려준다.
-- 사용자 id는 서버가 토큰에서 정하며, 본인 슬롯의 집합만 조인한다. 서버 전용(service_role).
create or replace function public.get_slot_popular_compare(
  p_user uuid, p_slot smallint, p_tolerance interval default interval '26 hours')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  slot_run collection_runs;
  pop_run collection_runs;
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

  return jsonb_build_object(
    'query', qn, 'slotRunId', slot_run.id, 'slotScheduledFor', slot_run.scheduled_for, 'slotItemCount', slot_run.item_count,
    'popularRunId', pop_run.id, 'popularScheduledFor', pop_run.scheduled_for, 'popularItemCount', pop_run.item_count,
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
    'slotVideos', (select coalesce(jsonb_agg(jsonb_build_object('viewCount', view_count, 'likeCount', like_count)), '[]'::jsonb)
                   from video_observations where run_id = slot_run.id),
    'popularVideos', (select coalesce(jsonb_agg(jsonb_build_object('title', v.title, 'tags', to_jsonb(v.tags),
                        'viewCount', o.view_count, 'likeCount', o.like_count)), '[]'::jsonb)
                      from video_observations o join video_versions v on v.id = o.version_id
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
