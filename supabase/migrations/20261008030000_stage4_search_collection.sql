-- Stage 4: 로그인 사용자 검색어 대시보드 수집용 함수. 모두 service_role 전용.
-- 검색 집합(search_sets)은 조건이 모두 같을 때만 공유되며, 집합별 collection_runs(kind='search')로 시계열을 분리한다.

-- ───────── 완료 적재 일반화: 인기(영상 1개 이상)와 검색(0개 허용)이 같은 본문을 쓴다 ─────────
create function public.finish_collection_run(p_run bigint, p_kind text, p_min integer, p_payload jsonb, p_now timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare r collection_runs; n integer; pages smallint := (p_payload->>'pages_fetched')::smallint;
begin
  select * into r from collection_runs where id = p_run and kind = p_kind for update;
  if not found or r.status <> 'running' then return 'not_running'; end if;
  n := jsonb_array_length(p_payload->'videos');
  if n < p_min or n > 200 then raise exception 'video count out of range: %', n; end if;

  insert into video_versions (video_id, content_hash, title, description, tags, category_id, channel_id, published_at, duration_seconds, thumbnail_url, first_seen_at)
  select distinct on (v.video_id, v.content_hash) v.video_id, v.content_hash, v.title, coalesce(v.description, ''),
         coalesce(v.tags, '{}'), v.category_id, v.channel_id, v.published_at, v.duration_seconds, v.thumbnail_url, p_now
  from jsonb_to_recordset(p_payload->'videos') as v(video_id text, content_hash text, title text, description text, tags text[],
       category_id text, channel_id text, published_at timestamptz, duration_seconds integer, thumbnail_url text)
  on conflict (video_id, content_hash) do nothing;

  insert into video_observations (run_id, video_id, version_id, position, view_count, like_count, comment_count, observed_at)
  select p_run, v.video_id, vv.id, v.position, v.view_count, v.like_count, v.comment_count, v.observed_at
  from jsonb_to_recordset(p_payload->'videos') as v(video_id text, content_hash text, position smallint,
       view_count bigint, like_count bigint, comment_count bigint, observed_at timestamptz)
  join video_versions vv on vv.video_id = v.video_id and vv.content_hash = v.content_hash;

  insert into channel_versions (channel_id, content_hash, title, thumbnail_url, first_seen_at)
  select distinct on (c.channel_id, c.content_hash) c.channel_id, c.content_hash, c.title, c.thumbnail_url, p_now
  from jsonb_to_recordset(p_payload->'channels') as c(channel_id text, content_hash text, title text, thumbnail_url text)
  on conflict (channel_id, content_hash) do nothing;

  insert into channel_observations (run_id, channel_id, version_id, subscriber_count, subscribers_hidden, observed_at)
  select p_run, c.channel_id, cv.id, c.subscriber_count, coalesce(c.subscribers_hidden, false), c.observed_at
  from jsonb_to_recordset(p_payload->'channels') as c(channel_id text, content_hash text, subscriber_count bigint,
       subscribers_hidden boolean, observed_at timestamptz)
  join channel_versions cv on cv.channel_id = c.channel_id and cv.content_hash = c.content_hash;

  insert into category_counts (run_id, category_id, video_count)
  select p_run, vv.category_id, count(*) from video_observations o join video_versions vv on vv.id = o.version_id
  where o.run_id = p_run and vv.category_id is not null group by vv.category_id;

  update collection_runs set status = 'complete', pages_fetched = pages, pages_expected = pages, item_count = n,
    quota_units = coalesce((p_payload->>'units')::integer, 0), finished_at = coalesce((p_payload->>'finished_at')::timestamptz, p_now),
    ingested_at = p_now, aggregate_version = 1, error_code = null
  where id = p_run;
  return 'complete';
end $$;

create or replace function public.finish_popular_run(p_run bigint, p_payload jsonb, p_now timestamptz default now())
returns text language sql security definer set search_path = public as $$
  select public.finish_collection_run(p_run, 'popular', 1, p_payload, p_now)
$$;

create function public.finish_search_run(p_run bigint, p_payload jsonb, p_now timestamptz default now())
returns text language sql security definer set search_path = public as $$
  select public.finish_collection_run(p_run, 'search', 0, p_payload, p_now)
$$;

-- ───────── 검색 실행 시작/실패 ─────────
-- state: started | done | busy | storage_hold | inactive(구독자 없음)
create function public.start_search_run(p_set bigint, p_scheduled_for timestamptz, p_now timestamptz default now(),
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
    if existing.status = 'complete' then return query select 'done'::text, existing.id, size; return; end if;
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

create function public.fail_search_run(p_run bigint, p_status text, p_error text, p_pages smallint, p_units integer, p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_status not in ('partial', 'failed') then raise exception 'invalid status'; end if;
  update collection_runs set status = p_status, error_code = left(p_error, 40), pages_fetched = least(p_pages, pages_expected),
    quota_units = p_units, finished_at = p_now, ingested_at = p_now
  where id = p_run and kind = 'search' and status = 'running';
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ───────── 조회·대상 선정 ─────────
-- 등록 시 재사용 판단: 조건이 모두 같은 집합에 최근(p_fresh_hours) 완료 수집이 있으면 fresh. 쓰기 없음.
create function public.search_set_freshness(p_query text, p_language text, p_order text, p_window text,
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
    and r.status = 'complete' and r.scheduled_for > p_now - make_interval(hours => p_fresh_hours));
end $$;

-- 일괄 갱신 대상: 구독자가 있고 해당 작업 시각에 아직 완료 수집이 없는 집합과 구독 사용자.
create function public.list_active_search_sets(p_scheduled_for timestamptz)
returns table (set_id bigint, query_norm text, region text, language text, order_by text, published_window text, users uuid[])
language sql stable security definer set search_path = public as $$
  select s.id, s.query_norm, s.region, s.language, s.order_by, s.published_window,
         array_agg(u.user_id order by u.created_at, u.user_id)
  from search_sets s join user_search_slots u on u.search_set_id = s.id
  where not exists (select 1 from collection_runs r where r.kind = 'search' and r.search_set_id = s.id
                    and r.scheduled_for = p_scheduled_for and r.status = 'complete')
  group by s.id order by s.id
$$;

-- 사용자 본인의 슬롯 요약과 (선택) 영상 목록. 슬롯 소유자만 자기 집합 데이터를 본다(user_id는 서버가 토큰에서 정한다).
create function public.get_search_slot_view(p_user uuid, p_slot smallint default null, p_include_videos boolean default false,
  p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare slot_row record; r collection_runs; last collection_runs; first_at timestamptz; videos jsonb; out jsonb := '[]'::jsonb; item jsonb;
begin
  for slot_row in
    select u.slot, s.id as set_id, s.query_norm, s.region, s.language, s.order_by, s.published_window
    from user_search_slots u join search_sets s on s.id = u.search_set_id
    where u.user_id = p_user and (p_slot is null or u.slot = p_slot) order by u.slot
  loop
    select * into last from collection_runs where kind = 'search' and search_set_id = slot_row.set_id order by scheduled_for desc limit 1;
    select * into r from collection_runs where kind = 'search' and search_set_id = slot_row.set_id and status = 'complete' order by scheduled_for desc limit 1;
    select min(scheduled_for) into first_at from collection_runs where kind = 'search' and search_set_id = slot_row.set_id and status = 'complete';
    item := jsonb_build_object('slot', slot_row.slot,
      'conditions', jsonb_build_object('query', slot_row.query_norm, 'order', slot_row.order_by, 'window', slot_row.published_window,
                                       'region', slot_row.region, 'language', slot_row.language),
      'observation_started_at', first_at,
      'last_attempt', case when last.id is null then null else jsonb_build_object('status', last.status, 'scheduled_for', last.scheduled_for, 'error_code', last.error_code) end,
      'snapshot', null, 'lag_minutes', null);
    if r.id is not null then
      item := item || jsonb_build_object('lag_minutes', floor(extract(epoch from (p_now - r.scheduled_for)) / 60),
        'snapshot', jsonb_build_object('run_id', r.id, 'scheduled_for', r.scheduled_for, 'item_count', r.item_count, 'pages_fetched', r.pages_fetched));
      if p_include_videos then
        select coalesce(jsonb_agg(jsonb_build_object(
            'position', o.position, 'video_id', o.video_id, 'title', v.title, 'channel_id', v.channel_id,
            'channel_title', cv.title, 'thumbnail_url', v.thumbnail_url, 'published_at', v.published_at,
            'category_id', v.category_id, 'duration_seconds', v.duration_seconds, 'view_count', o.view_count,
            'like_count', o.like_count, 'comment_count', o.comment_count, 'subscriber_count', co.subscriber_count) order by o.position), '[]'::jsonb)
          into videos
        from video_observations o
        join video_versions v on v.id = o.version_id
        left join channel_observations co on co.run_id = o.run_id and co.channel_id = v.channel_id
        left join channel_versions cv on cv.id = co.version_id
        where o.run_id = r.id;
        item := jsonb_set(item, '{snapshot,videos}', videos);
      end if;
    end if;
    out := out || jsonb_build_array(item);
  end loop;
  return jsonb_build_object('slots', out);
end $$;

-- ───────── 검색 예약: 일괄 갱신에서 공유 집합의 전역 예산을 한 번만 소비하도록 옵션 추가 ─────────
drop function public.reserve_search(uuid, uuid, integer, timestamptz, integer);
-- released 정산은 전역 예산을 소비한 예약만 반환해야 하므로 소비 여부를 기록한다.
alter table public.usage_reservations add column charged_global boolean not null default true;
create function public.reserve_search(
  p_user uuid, p_request uuid, p_units integer default 1, p_now timestamptz default now(),
  p_daily_limit integer default 40, p_charge_global boolean default true)
returns table (status text, reservation_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  existing usage_reservations; used_today integer; new_id uuid; day date := kst_day(p_now);
begin
  if p_units < 1 then raise exception 'units must be positive'; end if;
  perform lock_user('search', p_user);
  select * into existing from usage_reservations where user_id = p_user and kind = 'search' and request_id = p_request;
  if found then return query select 'duplicate'::text, existing.id; return; end if;

  select coalesce(sum(units), 0) into used_today from usage_reservations
    where user_id = p_user and kind = 'search' and status <> 'released' and kst_day(created_at) = day;
  if used_today + p_units > p_daily_limit then return query select 'daily_limit'::text, null::uuid; return; end if;

  if p_charge_global and not try_consume_quota('search', day, p_units) then
    return query select 'global_limit'::text, null::uuid; return;
  end if;
  insert into usage_reservations (user_id, kind, request_id, units, status, lease_expires_at, created_at, charged_global)
    values (p_user, 'search', p_request, p_units, 'reserved', p_now + interval '2 minutes', p_now, p_charge_global)
    returning id into new_id;
  return query select 'ok'::text, new_id;
end $$;

create or replace function public.settle_usage(p_user uuid, p_reservation uuid, p_status text, p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path = public as $$
declare r usage_reservations; q text;
begin
  if p_status not in ('settled', 'released', 'failed_unknown') then raise exception 'invalid status'; end if;
  perform lock_user((select kind from usage_reservations where id = p_reservation), p_user);
  select * into r from usage_reservations where id = p_reservation and user_id = p_user and status = 'reserved' for update;
  if not found then return false; end if;
  update usage_reservations set status = p_status, settled_at = p_now where id = r.id;
  if p_status = 'released' and r.charged_global then
    q := case r.kind when 'ai' then 'ai_requests' else 'search' end;
    update quota_counters set used = greatest(used - r.units, 0) where kind = q and day = kst_day(r.created_at);
  end if;
  return true;
end $$;

revoke all on function public.finish_collection_run(bigint, text, integer, jsonb, timestamptz),
  public.finish_search_run(bigint, jsonb, timestamptz),
  public.start_search_run(bigint, timestamptz, timestamptz, bigint),
  public.fail_search_run(bigint, text, text, smallint, integer, timestamptz),
  public.search_set_freshness(text, text, text, text, timestamptz, integer, text),
  public.list_active_search_sets(timestamptz),
  public.get_search_slot_view(uuid, smallint, boolean, timestamptz),
  public.reserve_search(uuid, uuid, integer, timestamptz, integer, boolean) from public;
grant execute on function public.finish_search_run(bigint, jsonb, timestamptz),
  public.start_search_run(bigint, timestamptz, timestamptz, bigint),
  public.fail_search_run(bigint, text, text, smallint, integer, timestamptz),
  public.search_set_freshness(text, text, text, text, timestamptz, integer, text),
  public.list_active_search_sets(timestamptz),
  public.get_search_slot_view(uuid, smallint, boolean, timestamptz),
  public.reserve_search(uuid, uuid, integer, timestamptz, integer, boolean),
  public.finish_popular_run(bigint, jsonb, timestamptz) to service_role;
