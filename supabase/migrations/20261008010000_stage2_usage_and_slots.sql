-- Stage 2: 원자적 사용량 예약(AI 개인 한도·검색 개인 한도·전역 예산)과 검색 슬롯 함수.
-- 모든 함수는 service_role 전용이다. 사용자 id는 서버가 검증한 토큰에서만 가져온다(클라이언트 입력 아님).
-- 일 경계는 Asia/Seoul 자정(임시값, D07에서 확정). 예산 행이 없으면 전역 소비는 실패한다(fail-closed).

create function public.kst_day(p_ts timestamptz) returns date
language sql immutable as $$ select (p_ts at time zone 'Asia/Seoul')::date $$;

-- 같은 사용자 요청을 직렬화하는 잠금(트랜잭션 종료 시 해제)
create function public.lock_user(p_kind text, p_user uuid) returns void
language sql as $$ select pg_advisory_xact_lock(hashtextextended(p_kind || ':' || p_user::text, 0)) $$;

-- AI 요청 예약. status: ok | duplicate | in_flight | too_soon | daily_limit | global_limit
-- 오래된 lease는 'failed_unknown'으로 닫는다. 공급자 호출 여부를 알 수 없으므로 개인·전역 사용량에 그대로 남긴다.
create function public.reserve_ai_request(
  p_user uuid, p_request uuid, p_now timestamptz default now(),
  p_daily_limit integer default 10, p_min_gap_seconds integer default 30, p_lease_seconds integer default 120)
returns table (status text, reservation_id uuid, retry_after_seconds integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  existing usage_reservations; last_at timestamptz; used_today integer; new_id uuid;
  day date := kst_day(p_now);
begin
  perform lock_user('ai', p_user);
  update usage_reservations set status = 'failed_unknown', settled_at = p_now
    where user_id = p_user and kind = 'ai' and status = 'reserved' and lease_expires_at <= p_now;

  select * into existing from usage_reservations where user_id = p_user and kind = 'ai' and request_id = p_request;
  if found then return query select 'duplicate'::text, existing.id, 0; return; end if;

  if exists (select 1 from usage_reservations where user_id = p_user and kind = 'ai' and status = 'reserved') then
    return query select 'in_flight'::text, null::uuid, 0; return;
  end if;

  select max(created_at) into last_at from usage_reservations where user_id = p_user and kind = 'ai' and status <> 'released';
  if last_at is not null and last_at + make_interval(secs => p_min_gap_seconds) > p_now then
    return query select 'too_soon'::text, null::uuid,
      ceil(extract(epoch from (last_at + make_interval(secs => p_min_gap_seconds) - p_now)))::integer;
    return;
  end if;

  select coalesce(sum(units), 0) into used_today from usage_reservations
    where user_id = p_user and kind = 'ai' and status <> 'released' and kst_day(created_at) = day;
  if used_today >= p_daily_limit then
    return query select 'daily_limit'::text, null::uuid, 0; return;
  end if;

  if not try_consume_quota('ai_requests', day, 1) then
    return query select 'global_limit'::text, null::uuid, 0; return;
  end if;

  insert into usage_reservations (user_id, kind, request_id, units, status, lease_expires_at, created_at)
    values (p_user, 'ai', p_request, 1, 'reserved', p_now + make_interval(secs => p_lease_seconds), p_now)
    returning id into new_id;
  return query select 'ok'::text, new_id, 0;
end $$;

-- 검색 호출 예약(search.list 1회 = 1 unit). 개인 일일 상한(알파 40)과 전역 'search' 예산을 모두 통과해야 한다.
-- 개인 상한은 이 사용자가 하루에 소비한 search 유닛 합이다. status: ok | duplicate | daily_limit | global_limit
create function public.reserve_search(
  p_user uuid, p_request uuid, p_units integer default 1, p_now timestamptz default now(),
  p_daily_limit integer default 40)
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

  if not try_consume_quota('search', day, p_units) then
    return query select 'global_limit'::text, null::uuid; return;
  end if;
  insert into usage_reservations (user_id, kind, request_id, units, status, lease_expires_at, created_at)
    values (p_user, 'search', p_request, p_units, 'reserved', p_now + interval '2 minutes', p_now)
    returning id into new_id;
  return query select 'ok'::text, new_id;
end $$;

-- 정산. 'settled' = 호출 수행(사용량 유지), 'released' = 공급자 호출이 확실히 없었음(사용량 반환),
-- 'failed_unknown' = 호출 여부 불명(사용량 유지). 본인 소유 'reserved'만 바꾼다. 반환: 변경 여부.
create function public.settle_usage(p_user uuid, p_reservation uuid, p_status text, p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path = public as $$
declare r usage_reservations; q text;
begin
  if p_status not in ('settled', 'released', 'failed_unknown') then raise exception 'invalid status'; end if;
  perform lock_user((select kind from usage_reservations where id = p_reservation), p_user);
  select * into r from usage_reservations where id = p_reservation and user_id = p_user and status = 'reserved' for update;
  if not found then return false; end if;
  update usage_reservations set status = p_status, settled_at = p_now where id = r.id;
  if p_status = 'released' then
    q := case r.kind when 'ai' then 'ai_requests' else 'search' end;
    update quota_counters set used = greatest(used - r.units, 0) where kind = q and day = kst_day(r.created_at);
  end if;
  return true;
end $$;

-- 검색 슬롯 설정(등록·변경). 조건이 모두 같은 집합만 공유한다. 집합 연결만 바꾸며 이전 집합 데이터는 건드리지 않는다.
create function public.set_search_slot(
  p_user uuid, p_slot smallint, p_query text, p_region text default 'KR', p_language text default '',
  p_order text default 'relevance', p_window text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare qn text := lower(btrim(p_query)); sid bigint;
begin
  if p_slot not in (1, 2) then raise exception 'invalid slot'; end if;
  perform lock_user('slots', p_user);
  insert into search_sets (query_norm, region, language, order_by, published_window)
    values (qn, p_region, p_language, p_order, p_window) on conflict do nothing;
  select id into sid from search_sets where query_norm = qn and region = p_region and language = p_language
    and order_by = p_order and published_window = p_window;
  insert into user_search_slots (user_id, slot, search_set_id) values (p_user, p_slot, sid)
    on conflict (user_id, slot) do update set search_set_id = excluded.search_set_id, updated_at = now();
  return sid;
end $$;

create function public.clear_search_slot(p_user uuid, p_slot smallint) returns boolean
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare n integer;
begin
  perform lock_user('slots', p_user);
  delete from user_search_slots where user_id = p_user and slot = p_slot;
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.kst_day(timestamptz), public.lock_user(text, uuid),
  public.reserve_ai_request(uuid, uuid, timestamptz, integer, integer, integer),
  public.reserve_search(uuid, uuid, integer, timestamptz, integer),
  public.settle_usage(uuid, uuid, text, timestamptz),
  public.set_search_slot(uuid, smallint, text, text, text, text, text),
  public.clear_search_slot(uuid, smallint) from public;
grant execute on function public.reserve_ai_request(uuid, uuid, timestamptz, integer, integer, integer),
  public.reserve_search(uuid, uuid, integer, timestamptz, integer),
  public.settle_usage(uuid, uuid, text, timestamptz),
  public.set_search_slot(uuid, smallint, text, text, text, text, text),
  public.clear_search_slot(uuid, smallint),
  public.try_consume_quota(text, date, integer),
  public.purge_expired(timestamptz) to service_role;
