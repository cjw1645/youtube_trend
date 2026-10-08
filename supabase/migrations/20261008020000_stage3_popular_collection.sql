-- Stage 3: 공통 인기 목록 수집용 함수. 모두 service_role 전용(공개 읽기 함수 제외).
-- 수집 서버가 (1) start → (2) YouTube 호출 → (3) finish/fail 순서로 호출한다. 완료(complete)된 실행만 공개된다.

alter table public.quota_counters drop constraint quota_counters_kind_check;
alter table public.quota_counters
  add constraint quota_counters_kind_check check (kind in ('search', 'ai_requests', 'ai_tokens', 'youtube_units'));

-- 예산 행이 없으면 만들고(이미 있으면 유지) 소비는 try_consume_quota로 한다.
create function public.ensure_quota_row(p_kind text, p_day date, p_cap integer) returns void
language sql security definer set search_path = public as $$
  insert into quota_counters (kind, day, cap) values (p_kind, p_day, p_cap) on conflict do nothing
$$;

-- 실행 시작(멱등). state: started | done | busy | storage_hold
-- done: 같은 작업 시각이 이미 완료됨. busy: 다른 실행이 진행 중(10분 이내). storage_hold: DB가 400MiB 이상이라 새 수집 보류.
-- 실패·부분·오래된 running 실행은 같은 작업 시각으로 재시도할 수 있으며 이전 적재분은 지운다.
create function public.start_popular_run(p_scheduled_for timestamptz, p_now timestamptz default now(), p_region text default 'KR', p_hold_bytes bigint default 419430400)
returns table (state text, run_id bigint, db_bytes bigint)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  size bigint := pg_database_size(current_database());
  existing collection_runs;
  new_id bigint;
begin
  if size >= p_hold_bytes then return query select 'storage_hold'::text, null::bigint, size; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('popular:' || p_region || ':' || p_scheduled_for::text, 0));
  select * into existing from collection_runs where kind = 'popular' and region = p_region and scheduled_for = p_scheduled_for;
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
  insert into collection_runs (kind, region, scheduled_for, started_at, status, pages_expected, expires_at)
    values ('popular', p_region, p_scheduled_for, p_now, 'running', 4, p_scheduled_for + interval '28 days')
    returning id into new_id;
  return query select 'started'::text, new_id, size;
end $$;

-- 완료 적재: 한 트랜잭션에서 버전·관측·채널·카테고리 집계를 넣고 complete로 바꾼다. 중간에 실패하면 전체가 롤백된다.
-- p_payload: { pages_fetched, units, finished_at,
--   videos:   [{ video_id, position, content_hash, title, description, tags[], category_id, channel_id, published_at,
--                duration_seconds, thumbnail_url, view_count, like_count, comment_count, observed_at }],
--   channels: [{ channel_id, content_hash, title, thumbnail_url, subscriber_count, subscribers_hidden, observed_at }] }
create function public.finish_popular_run(p_run bigint, p_payload jsonb, p_now timestamptz default now())
returns text language plpgsql security definer set search_path = public as $$
declare r collection_runs; n integer; pages smallint := (p_payload->>'pages_fetched')::smallint;
begin
  select * into r from collection_runs where id = p_run and kind = 'popular' for update;
  if not found or r.status <> 'running' then return 'not_running'; end if;
  n := jsonb_array_length(p_payload->'videos');
  if n < 1 or n > 200 then raise exception 'video count out of range: %', n; end if;

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

-- 실패/부분 종료. 적재분 없이 상태만 남기고 공개하지 않는다(기본 비교에서 제외).
create function public.fail_popular_run(p_run bigint, p_status text, p_error text, p_pages smallint, p_units integer, p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_status not in ('partial', 'failed') then raise exception 'invalid status'; end if;
  update collection_runs set status = p_status, error_code = left(p_error, 40), pages_fetched = least(p_pages, pages_expected),
    quota_units = p_units, finished_at = p_now, ingested_at = p_now
  where id = p_run and kind = 'popular' and status = 'running';
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- 공개 읽기: 최신 완료 스냅샷과 마지막 시도 상태. 완료되지 않은 실행의 데이터는 반환하지 않는다.
create function public.get_latest_popular(p_region text default 'KR', p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r collection_runs; last collection_runs; videos jsonb;
begin
  select * into last from collection_runs where kind = 'popular' and region = p_region order by scheduled_for desc limit 1;
  select * into r from collection_runs where kind = 'popular' and region = p_region and status = 'complete' order by scheduled_for desc limit 1;
  if not found then
    return jsonb_build_object('snapshot', null,
      'last_attempt', case when last.id is null then null else jsonb_build_object('status', last.status, 'scheduled_for', last.scheduled_for, 'error_code', last.error_code) end);
  end if;
  select jsonb_agg(jsonb_build_object(
      'position', o.position, 'video_id', o.video_id, 'title', v.title, 'channel_id', v.channel_id,
      'channel_title', cv.title, 'thumbnail_url', v.thumbnail_url, 'published_at', v.published_at,
      'category_id', v.category_id, 'duration_seconds', v.duration_seconds, 'view_count', o.view_count,
      'like_count', o.like_count, 'comment_count', o.comment_count, 'subscriber_count', co.subscriber_count) order by o.position)
    into videos
  from video_observations o
  join video_versions v on v.id = o.version_id
  left join channel_observations co on co.run_id = o.run_id and co.channel_id = v.channel_id
  left join channel_versions cv on cv.id = co.version_id
  where o.run_id = r.id;
  return jsonb_build_object(
    'snapshot', jsonb_build_object('run_id', r.id, 'scheduled_for', r.scheduled_for, 'started_at', r.started_at,
      'finished_at', r.finished_at, 'item_count', r.item_count, 'pages_fetched', r.pages_fetched, 'videos', coalesce(videos, '[]'::jsonb)),
    'lag_minutes', floor(extract(epoch from (p_now - r.scheduled_for)) / 60),
    'last_attempt', jsonb_build_object('status', last.status, 'scheduled_for', last.scheduled_for, 'error_code', last.error_code));
end $$;

revoke all on function public.ensure_quota_row(text, date, integer),
  public.start_popular_run(timestamptz, timestamptz, text, bigint),
  public.finish_popular_run(bigint, jsonb, timestamptz),
  public.fail_popular_run(bigint, text, text, smallint, integer, timestamptz),
  public.get_latest_popular(text, timestamptz) from public;
grant execute on function public.ensure_quota_row(text, date, integer),
  public.start_popular_run(timestamptz, timestamptz, text, bigint),
  public.finish_popular_run(bigint, jsonb, timestamptz),
  public.fail_popular_run(bigint, text, text, smallint, integer, timestamptz),
  public.get_latest_popular(text, timestamptz) to service_role;
-- 공개 대시보드 읽기는 서버(service_role)가 호출한다. 브라우저가 직접 RPC를 부르지 않는다.
