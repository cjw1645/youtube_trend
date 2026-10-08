-- Stage 5: 키워드 집계 저장과 트렌드 조회 입력. 모두 service_role 전용(브라우저는 서버 API를 통해 읽는다).
-- 키워드는 영상당 1회로 집계하고 영상 수 2개 이상인 상위 100개만 저장한다. 저장된 집계에 없는 키워드는 0개가 아니라
-- 「기준 미만 또는 상위 밖」이다. aggregate_version 2부터 키워드 집계가 있다(1은 카테고리만).

-- ───────── 완료 적재: 키워드 집계 저장 추가 (재적재 시 이전 집계는 지움) ─────────
create or replace function public.finish_collection_run(p_run bigint, p_kind text, p_min integer, p_payload jsonb, p_now timestamptz)
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

  delete from keyword_counts where run_id = p_run;
  insert into keyword_counts (run_id, keyword, video_count, channel_count)
  select p_run, k.keyword, k.video_count, k.channel_count
  from jsonb_to_recordset(coalesce(p_payload->'keywords', '[]'::jsonb)) as k(keyword text, video_count integer, channel_count integer)
  where char_length(k.keyword) between 1 and 60 and k.video_count > 0 and k.channel_count between 1 and k.video_count
    and k.video_count <= n;

  update collection_runs set status = 'complete', pages_fetched = pages, pages_expected = pages, item_count = n,
    quota_units = coalesce((p_payload->>'units')::integer, 0), finished_at = coalesce((p_payload->>'finished_at')::timestamptz, p_now),
    ingested_at = p_now, aggregate_version = 2, error_code = null
  where id = p_run;
  return 'complete';
end $$;

-- ───────── 한 수집 실행의 집계 프로필 ─────────
-- 길이 구간 키: u60(60초 이하), u180(61~180초), u600(181~600초), o600(600초 초과), unknown(길이 미확인).
create function public.run_profile(p_run bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'run_id', r.id, 'scheduled_for', r.scheduled_for, 'item_count', r.item_count,
    'expires_at', r.expires_at, 'has_keywords', coalesce(r.aggregate_version, 0) >= 2,
    'video_ids', coalesce((select jsonb_agg(o.video_id order by o.position) from video_observations o where o.run_id = r.id), '[]'::jsonb),
    'categories', coalesce((select jsonb_object_agg(c.category_id, c.video_count) from category_counts c where c.run_id = r.id), '{}'::jsonb),
    'keywords', coalesce((select jsonb_object_agg(k.keyword, jsonb_build_array(k.video_count, k.channel_count)) from keyword_counts k where k.run_id = r.id), '{}'::jsonb),
    'lengths', (select jsonb_build_object(
        'u60', count(*) filter (where v.duration_seconds > 0 and v.duration_seconds <= 60),
        'u180', count(*) filter (where v.duration_seconds > 60 and v.duration_seconds <= 180),
        'u600', count(*) filter (where v.duration_seconds > 180 and v.duration_seconds <= 600),
        'o600', count(*) filter (where v.duration_seconds > 600),
        'unknown', count(*) filter (where v.duration_seconds is null or v.duration_seconds = 0))
      from video_observations o join video_versions v on v.id = o.version_id where o.run_id = r.id))
  from collection_runs r where r.id = p_run and r.status = 'complete'
$$;

-- 같은 종류·지역·검색 집합의 완료 실행 중 기준 시점에 가장 가까운 것(허용 오차 안). 직전은 offset 0.
create function public.trend_baseline_run(p_run bigint, p_offset interval, p_tolerance interval)
returns bigint language sql stable security definer set search_path = public as $$
  select c.id from collection_runs cur
  join collection_runs c on c.kind = cur.kind and c.region = cur.region
    and c.search_set_id is not distinct from cur.search_set_id and c.status = 'complete' and c.id <> cur.id
  where cur.id = p_run and c.scheduled_for < cur.scheduled_for and (
    p_offset = interval '0'
    or abs(extract(epoch from (c.scheduled_for - (cur.scheduled_for - p_offset)))) <= extract(epoch from p_tolerance))
  order by case when p_offset = interval '0' then c.scheduled_for end desc nulls last,
           abs(extract(epoch from (c.scheduled_for - (cur.scheduled_for - p_offset)))), c.id
  limit 1
$$;

-- 트렌드 입력: 현재 프로필, 기준 4종(직전/전일 동시간/7일/28일) 프로필(없으면 null), 최근 7일 상위 키워드 시계열.
-- 비교 계산·최소 표본 규칙은 서버 코드(api/_lib/trend.ts)가 한다.
create function public.get_trend_inputs(p_run bigint, p_tolerance interval default interval '2 hours')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cur collection_runs; top text[]; series jsonb;
begin
  select * into cur from collection_runs where id = p_run and status = 'complete';
  if not found then return null; end if;
  select coalesce(array_agg(keyword), '{}') into top from (
    select keyword from keyword_counts where run_id = cur.id order by video_count desc, keyword limit 5) t;
  select coalesce(jsonb_agg(jsonb_build_object('scheduled_for', c.scheduled_for, 'item_count', c.item_count,
      'counts', coalesce((select jsonb_object_agg(k.keyword, k.video_count) from keyword_counts k where k.run_id = c.id and k.keyword = any (top)), '{}'::jsonb))
      order by c.scheduled_for), '[]'::jsonb)
    into series
  from collection_runs c
  where c.kind = cur.kind and c.region = cur.region and c.search_set_id is not distinct from cur.search_set_id
    and c.status = 'complete' and coalesce(c.aggregate_version, 0) >= 2
    and c.scheduled_for > cur.scheduled_for - interval '7 days' and c.scheduled_for <= cur.scheduled_for;
  return jsonb_build_object(
    'current', public.run_profile(cur.id),
    'baselines', jsonb_build_object(
      'previous', public.run_profile(public.trend_baseline_run(cur.id, interval '0', p_tolerance)),
      'day', public.run_profile(public.trend_baseline_run(cur.id, interval '1 day', p_tolerance)),
      'week', public.run_profile(public.trend_baseline_run(cur.id, interval '7 days', p_tolerance)),
      'month', public.run_profile(public.trend_baseline_run(cur.id, interval '28 days', p_tolerance))),
    'top_keywords', to_jsonb(top),
    'series', series);
end $$;

-- 공통 인기 목록의 최신 완료 실행 기준 입력.
create function public.get_popular_trend_inputs(p_region text default 'KR')
returns jsonb language sql stable security definer set search_path = public as $$
  select public.get_trend_inputs((select id from collection_runs where kind = 'popular' and region = p_region
    and status = 'complete' order by scheduled_for desc limit 1))
$$;

-- 사용자 본인 슬롯의 최신 완료 실행 기준 입력. 슬롯 소유자만 자기 집합을 읽는다(user_id는 서버가 토큰에서 정한다).
create function public.get_slot_trend_inputs(p_user uuid, p_slot smallint)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.get_trend_inputs((
    select r.id from user_search_slots u join collection_runs r on r.kind = 'search' and r.search_set_id = u.search_set_id and r.status = 'complete'
    where u.user_id = p_user and u.slot = p_slot order by r.scheduled_for desc limit 1))
$$;

-- ───────── 근거 영상 탐색을 위해 스냅샷 영상에 태그를 포함 ─────────
create or replace function public.get_latest_popular(p_region text default 'KR', p_now timestamptz default now())
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
      'position', o.position, 'video_id', o.video_id, 'title', v.title, 'tags', v.tags, 'channel_id', v.channel_id,
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

create or replace function public.get_search_slot_view(p_user uuid, p_slot smallint default null, p_include_videos boolean default false,
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
            'position', o.position, 'video_id', o.video_id, 'title', v.title, 'tags', v.tags, 'channel_id', v.channel_id,
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

revoke all on function public.run_profile(bigint), public.trend_baseline_run(bigint, interval, interval),
  public.get_trend_inputs(bigint, interval), public.get_popular_trend_inputs(text),
  public.get_slot_trend_inputs(uuid, smallint) from public;
grant execute on function public.run_profile(bigint), public.trend_baseline_run(bigint, interval, interval),
  public.get_trend_inputs(bigint, interval), public.get_popular_trend_inputs(text),
  public.get_slot_trend_inputs(uuid, smallint) to service_role;
