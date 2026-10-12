-- Stage 13: 내 검색어를 「자기 평소」와 비교하는 원자료, 검색 기록 28일 보관, 공개 조회의 IP별 하루 상한.

-- ───────── 1. 내 검색어의 지난 수집들(평소 대비 판정용) ─────────
-- 슬롯 검색 집합의 최근 완료 실행마다, 약 24시간 전 실행(18~30시간 전 중 24시간에 가장 가까운 것) 대비
-- 영상별 하루 조회수 증가(dailyGain, 24시간 환산)와 관측 시점의 업로드 후 경과 시간(ageHours)을 돌려준다.
-- 검색 집합은 같은 조건의 사용자끼리 공유되므로 이미 수집 중인 검색어를 추가하면 그 기록을 바로 쓴다.
-- 중앙값·평소 값·판정은 서버(TypeScript)가 계산한다.
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
          'videos', (select coalesce(jsonb_agg(jsonb_build_object(
                        'ageHours', round(extract(epoch from o.observed_at - v.published_at) / 3600),
                        'dailyGain', case when o.view_count is not null and p.view_count is not null and o.observed_at > p.observed_at
                          then round((o.view_count - p.view_count) * 86400.0 / extract(epoch from o.observed_at - p.observed_at)) end)), '[]'::jsonb)
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

-- ───────── 2. 검색 기록 보관 14일 → 28일 ─────────
-- 「쓸수록 비교할 과거가 쌓인다」가 2주에서 멈추지 않도록 인기 차트와 같은 28일로 맞춘다.
-- 검색 실행을 만드는 함수는 그대로 두고, 저장 직전에 보관 기한만 바꾼다.
create or replace function public.search_run_retention()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'search' then
    new.expires_at := new.scheduled_for + interval '28 days';
  end if;
  return new;
end $$;
drop trigger if exists search_run_retention on public.collection_runs;
create trigger search_run_retention before insert on public.collection_runs
  for each row execute function public.search_run_retention();
update public.collection_runs set expires_at = scheduled_for + interval '28 days'
 where kind = 'search' and expires_at < scheduled_for + interval '28 days';

-- ───────── 3. 공개 조회의 IP별 하루 상한 ─────────
-- 로그인 없이 부르는 공개 조회(영상 상세·관심 영상 ID 조회 등)를 한 곳에서 반복 호출해
-- 서비스 전체 공개 예산을 혼자 소진하지 못하게 한다. IP는 서버에서 해시한 값만 저장한다.
create table if not exists public.public_ip_quota (
  ip_hash text not null,
  day date not null,
  used integer not null default 0 check (used >= 0),
  primary key (ip_hash, day)
);
create index if not exists public_ip_quota_day_idx on public.public_ip_quota (day);
alter table public.public_ip_quota enable row level security;

-- 상한 안이면 units만큼 더하고 true, 넘으면 소비하지 않고 false. 이틀 지난 기록은 같이 지운다.
create or replace function public.try_consume_ip_quota(
  p_ip_hash text, p_day date, p_units integer, p_cap integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare granted boolean;
begin
  if p_units <= 0 then return true; end if;
  delete from public_ip_quota where day < p_day - 1;
  insert into public_ip_quota (ip_hash, day, used) values (p_ip_hash, p_day, 0)
    on conflict (ip_hash, day) do nothing;
  update public_ip_quota set used = used + p_units
   where ip_hash = p_ip_hash and day = p_day and used + p_units <= p_cap
  returning true into granted;
  return coalesce(granted, false);
end $$;
revoke all on function public.try_consume_ip_quota(text, date, integer, integer) from public;
grant execute on function public.try_consume_ip_quota(text, date, integer, integer) to service_role;
