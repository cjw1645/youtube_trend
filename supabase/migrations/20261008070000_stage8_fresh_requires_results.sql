-- Stage 8: 검색 집합 재사용 판단에서 결과가 0개인 완료 수집은 재사용하지 않는다.
-- YouTube가 일시적으로(또는 특정 검색어에 대해) 빈 결과를 돌려준 수집을 6시간 동안 「최근 수집」으로 취급하면
-- 사용자가 검색어를 다시 추가해도 새로 조회하지 못하기 때문이다. 빈 결과 수집 자체는 그대로 완료로 기록한다.
create or replace function public.search_set_freshness(p_query text, p_language text, p_order text, p_window text,
  p_now timestamptz default now(), p_fresh_hours integer default 6, p_region text default 'KR')
returns table (set_id bigint, fresh boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare sid bigint;
begin
  select id into sid from search_sets where query_norm = lower(btrim(p_query)) and region = p_region and language = p_language
    and order_by = p_order and published_window = p_window;
  if sid is null then return query select null::bigint, false; return; end if;
  return query select sid, exists (select 1 from collection_runs r where r.kind = 'search' and r.search_set_id = sid
    and r.status = 'complete' and r.item_count > 0 and r.scheduled_for > p_now - make_interval(hours => p_fresh_hours));
end $$;

-- 같은 작업 시각에 이미 완료된 수집은 건너뛰되, 결과가 0개인 수집은 다시 시도할 수 있다.
create or replace function public.start_search_run(p_set bigint, p_scheduled_for timestamptz, p_now timestamptz default now(),
  p_hold_bytes bigint default 419430400)
returns table (state text, run_id bigint, db_bytes bigint)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  size bigint := pg_database_size(current_database());
  existing collection_runs;
  new_id bigint;
begin
  if size >= p_hold_bytes then return query select 'storage_hold'::text, null::bigint, size; return; end if;
  if not exists (select 1 from user_search_slots where search_set_id = p_set) then
    return query select 'inactive'::text, null::bigint, size; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('search:' || p_set::text || ':' || p_scheduled_for::text, 0));
  select * into existing from collection_runs where kind = 'search' and search_set_id = p_set and scheduled_for = p_scheduled_for;
  if found then
    -- 결과가 0개인 완료 수집은 같은 시각에도 다시 시도할 수 있다(일시적 빈 응답이 그 시간 동안 고정되지 않게).
    if existing.status = 'complete' and existing.item_count > 0 then return query select 'done'::text, existing.id, size; return; end if;
    if existing.status = 'running' and existing.started_at > p_now - interval '10 minutes' then
      return query select 'busy'::text, existing.id, size; return;
    end if;
    delete from video_observations where run_id = existing.id;
    delete from channel_observations where run_id = existing.id;
    delete from category_counts where run_id = existing.id;
    update collection_runs set status = 'running', started_at = p_now, finished_at = null, ingested_at = p_now,
      pages_fetched = 0, pages_expected = 4, item_count = 0, quota_units = 0, error_code = null, aggregate_version = null
      where id = existing.id;
    return query select 'started'::text, existing.id, size; return;
  end if;
  insert into collection_runs (kind, region, search_set_id, scheduled_for, started_at, status, pages_expected, expires_at)
    values ('search', 'KR', p_set, p_scheduled_for, p_now, 'running', 4, p_scheduled_for + interval '14 days')
    returning id into new_id;
  return query select 'started'::text, new_id, size;
end $$;
