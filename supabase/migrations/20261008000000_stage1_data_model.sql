-- Stage 1: 데이터 모델·보존·RLS 초안
-- 공통 인기 목록(28일), 개인 검색(14일), AI 대화(28일).
-- 쓰기는 service_role(서버 수집 함수·API)만 한다. 브라우저 역할(anon/authenticated)은 RLS로 읽기/본인 데이터만.

-- ───────── 검색 집합과 개인 슬롯 ─────────
-- 조건(검색어·지역·언어·정렬·기간)이 모두 같을 때만 같은 집합. 미결정 조건(D03)은 컬럼만 두고 기본값을 둔다.
create table public.search_sets (
  id bigint generated always as identity primary key,
  query_norm text not null check (char_length(query_norm) between 1 and 100 and query_norm = lower(btrim(query_norm))),
  region text not null default 'KR' check (region ~ '^[A-Z]{2}$'),
  language text not null default '',
  order_by text not null default 'relevance' check (order_by in ('relevance', 'date', 'viewCount')),
  published_window text not null default '' check (published_window in ('', '1d', '7d', '30d')),
  created_at timestamptz not null default now(),
  unique (query_norm, region, language, order_by, published_window)
);

-- 계정당 슬롯 1~2. PK가 3번째 슬롯을 막고, 동시 요청은 PK 충돌로 하나만 성공한다.
create table public.user_search_slots (
  user_id uuid not null references auth.users (id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  search_set_id bigint not null references public.search_sets (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot),
  unique (user_id, search_set_id)
);
create index user_search_slots_set_idx on public.user_search_slots (search_set_id);

-- ───────── 수집 실행 ─────────
-- scheduled_for(작업 시각) / started_at·finished_at(실제 수집 구간) / ingested_at(적재 시각)을 구분한다.
create table public.collection_runs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('popular', 'search')),
  region text not null default 'KR',
  search_set_id bigint references public.search_sets (id) on delete cascade,
  scheduled_for timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ingested_at timestamptz not null default now(),
  status text not null default 'running' check (status in ('running', 'complete', 'partial', 'failed')),
  pages_expected smallint not null check (pages_expected between 1 and 4),
  pages_fetched smallint not null default 0 check (pages_fetched between 0 and 4),
  item_count smallint not null default 0 check (item_count between 0 and 200),
  quota_units integer not null default 0 check (quota_units >= 0),
  error_code text,
  aggregate_version smallint,
  expires_at timestamptz not null,
  check ((kind = 'popular') = (search_set_id is null)),
  check (pages_fetched <= pages_expected),
  check (status <> 'complete' or (finished_at is not null and pages_fetched = pages_expected)),
  check (expires_at > scheduled_for)
);
-- 같은 작업 시각의 중복 실행/재시도는 한 행으로 수렴한다 (멱등 키).
create unique index collection_runs_popular_key on public.collection_runs (region, scheduled_for) where kind = 'popular';
create unique index collection_runs_search_key on public.collection_runs (search_set_id, scheduled_for) where kind = 'search';
create index collection_runs_expiry_idx on public.collection_runs (expires_at);
create index collection_runs_latest_idx on public.collection_runs (kind, region, scheduled_for desc) where status = 'complete';

-- ───────── 영상·채널 버전 (내용 변경 시에만 새 버전) ─────────
-- 버전은 관측이 참조하는 동안만 산다. 마지막 참조가 사라지면 purge가 지운다(재조회로 과거를 연장하지 않음).
create table public.video_versions (
  id bigint generated always as identity primary key,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  content_hash text not null,
  title text not null,
  description text not null default '',
  tags text[] not null default '{}',
  category_id text,
  channel_id text not null,
  published_at timestamptz not null,
  duration_seconds integer check (duration_seconds >= 0),
  thumbnail_url text,
  first_seen_at timestamptz not null default now(),
  unique (video_id, content_hash)
);

create table public.channel_versions (
  id bigint generated always as identity primary key,
  channel_id text not null,
  content_hash text not null,
  title text not null,
  thumbnail_url text,
  first_seen_at timestamptz not null default now(),
  unique (channel_id, content_hash)
);

-- ───────── 관측 ─────────
-- 통계 null(비공개/누락)과 0을 구분한다. position은 목록 반환 순서이며 전체 YouTube 순위가 아니다.
create table public.video_observations (
  run_id bigint not null references public.collection_runs (id) on delete cascade,
  video_id text not null,
  version_id bigint not null references public.video_versions (id) on delete restrict,
  position smallint not null check (position between 1 and 200),
  view_count bigint check (view_count >= 0),
  like_count bigint check (like_count >= 0),
  comment_count bigint check (comment_count >= 0),
  observed_at timestamptz not null,
  primary key (run_id, video_id),
  unique (run_id, position)
);
create index video_observations_version_idx on public.video_observations (version_id);
create index video_observations_video_idx on public.video_observations (video_id, observed_at desc);

create table public.channel_observations (
  run_id bigint not null references public.collection_runs (id) on delete cascade,
  channel_id text not null,
  version_id bigint not null references public.channel_versions (id) on delete restrict,
  subscriber_count bigint check (subscriber_count >= 0),
  subscribers_hidden boolean not null default false,
  observed_at timestamptz not null,
  primary key (run_id, channel_id),
  check (not subscribers_hidden or subscriber_count is null)
);
create index channel_observations_version_idx on public.channel_observations (version_id);

-- ───────── 집계 (run 삭제 시 함께 삭제, 버전은 runs.aggregate_version) ─────────
create table public.category_counts (
  run_id bigint not null references public.collection_runs (id) on delete cascade,
  category_id text not null,
  video_count integer not null check (video_count > 0),
  primary key (run_id, category_id)
);

-- 같은 영상 안의 반복 단어는 영상당 1회 (규칙 확정은 Stage 5).
create table public.keyword_counts (
  run_id bigint not null references public.collection_runs (id) on delete cascade,
  keyword text not null check (char_length(keyword) between 1 and 60),
  video_count integer not null check (video_count > 0),
  channel_count integer not null check (channel_count > 0 and channel_count <= video_count),
  primary key (run_id, keyword)
);

-- ───────── 관심 영상·AI 대화 ─────────
-- 관심은 영상 ID만 저장한다. 제목·통계는 표시할 때 조회해 보존 정책 대상 데이터를 따로 쌓지 않는다.
create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 만료는 생성 시점 기준 28일. 새 메시지가 원 관측의 만료를 연장하지 않는다(관측은 run 만료로 삭제).
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create index conversations_user_idx on public.conversations (user_id, updated_at desc);
create index conversations_expiry_idx on public.conversations (expires_at);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- 질문·답변 모두 1~100자(코드 포인트). 사용자 결정(2026-10-08).
  content text not null check (
    char_length(content) >= 1 and
    ((role = 'user' and char_length(content) <= 100) or (role = 'assistant' and char_length(content) <= 100))
  ),
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, id);

-- 답변이 인용한 관측. 관측이 만료되면 인용 참조도 함께 사라진다(과거 수치를 보존하지 않음).
create table public.message_citations (
  message_id bigint not null references public.messages (id) on delete cascade,
  run_id bigint not null,
  video_id text not null,
  primary key (message_id, run_id, video_id),
  foreign key (run_id, video_id) references public.video_observations (run_id, video_id) on delete cascade
);

-- ───────── 사용량 예약·예산 ─────────
-- 전체 예산: 조건부 UPDATE 한 문장으로 원자적으로 소비한다. 검색 개인 상한은 cap으로 보관(알파: 40/일).
create table public.quota_counters (
  kind text not null check (kind in ('search', 'ai_requests', 'ai_tokens')),
  day date not null,
  used integer not null default 0 check (used >= 0),
  cap integer not null check (cap >= 0),
  primary key (kind, day),
  check (used <= cap)
);

create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('search', 'ai')),
  request_id uuid not null,
  units integer not null default 1 check (units > 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'failed_unknown', 'released')),
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, kind, request_id)
);
-- 사용자당 진행 중 AI 요청 1건. 동시 요청 중 하나만 INSERT에 성공한다.
create unique index usage_reservations_ai_inflight on public.usage_reservations (user_id) where kind = 'ai' and status = 'reserved';
create index usage_reservations_day_idx on public.usage_reservations (user_id, kind, created_at);

create function public.try_consume_quota(p_kind text, p_day date, p_units integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update quota_counters set used = used + p_units where kind = p_kind and day = p_day and used + p_units <= cap;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.try_consume_quota(text, date, integer) from public;

-- ───────── 만료 정리 ─────────
-- 삭제 순서: 만료 run(관측·채널 관측·집계·인용 cascade) → 참조 없는 버전 → 만료 대화 → 구독자 없고 run 없는 검색 집합.
create function public.purge_expired(p_now timestamptz default now())
returns table (runs bigint, video_versions bigint, channel_versions bigint, conversations bigint, search_sets bigint)
language plpgsql security definer set search_path = public as $$
declare a bigint; b bigint; c bigint; d bigint; e bigint;
begin
  delete from collection_runs where expires_at <= p_now; get diagnostics a = row_count;
  delete from video_versions v where not exists (select 1 from video_observations o where o.version_id = v.id); get diagnostics b = row_count;
  delete from channel_versions v where not exists (select 1 from channel_observations o where o.version_id = v.id); get diagnostics c = row_count;
  delete from conversations where expires_at <= p_now; get diagnostics d = row_count;
  delete from search_sets s
    where not exists (select 1 from user_search_slots u where u.search_set_id = s.id)
      and not exists (select 1 from collection_runs r where r.search_set_id = s.id); get diagnostics e = row_count;
  return query select a, b, c, d, e;
end $$;
revoke all on function public.purge_expired(timestamptz) from public;

-- ───────── RLS ─────────
alter table public.search_sets enable row level security;
alter table public.user_search_slots enable row level security;
alter table public.collection_runs enable row level security;
alter table public.video_versions enable row level security;
alter table public.channel_versions enable row level security;
alter table public.video_observations enable row level security;
alter table public.channel_observations enable row level security;
alter table public.category_counts enable row level security;
alter table public.keyword_counts enable row level security;
alter table public.favorites enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_citations enable row level security;
alter table public.quota_counters enable row level security;
alter table public.usage_reservations enable row level security;

-- 공통 인기 데이터는 누구나 읽는다. 개인 검색 데이터는 해당 집합을 슬롯에 둔 본인만 읽는다.
create function public.can_read_run(p_kind text, p_set bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select p_kind = 'popular' or exists (
    select 1 from user_search_slots u where u.user_id = auth.uid() and u.search_set_id = p_set)
$$;

create policy runs_read on public.collection_runs for select to anon, authenticated
  using (status = 'complete' and public.can_read_run(kind, search_set_id));
create policy obs_read on public.video_observations for select to anon, authenticated
  using (exists (select 1 from collection_runs r where r.id = run_id and r.status = 'complete' and public.can_read_run(r.kind, r.search_set_id)));
create policy chobs_read on public.channel_observations for select to anon, authenticated
  using (exists (select 1 from collection_runs r where r.id = run_id and r.status = 'complete' and public.can_read_run(r.kind, r.search_set_id)));
create policy cat_read on public.category_counts for select to anon, authenticated
  using (exists (select 1 from collection_runs r where r.id = run_id and r.status = 'complete' and public.can_read_run(r.kind, r.search_set_id)));
create policy kw_read on public.keyword_counts for select to anon, authenticated
  using (exists (select 1 from collection_runs r where r.id = run_id and r.status = 'complete' and public.can_read_run(r.kind, r.search_set_id)));
create policy vv_read on public.video_versions for select to anon, authenticated
  using (exists (select 1 from video_observations o join collection_runs r on r.id = o.run_id
                 where o.version_id = video_versions.id and r.status = 'complete' and public.can_read_run(r.kind, r.search_set_id)));
create policy cv_read on public.channel_versions for select to anon, authenticated
  using (exists (select 1 from channel_observations o join collection_runs r on r.id = o.run_id
                 where o.version_id = channel_versions.id and r.status = 'complete' and public.can_read_run(r.kind, r.search_set_id)));

create policy sets_read on public.search_sets for select to authenticated
  using (exists (select 1 from user_search_slots u where u.user_id = auth.uid() and u.search_set_id = search_sets.id));
create policy slots_own on public.user_search_slots for select to authenticated using (user_id = auth.uid());
create policy fav_own on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy conv_own on public.conversations for select to authenticated using (user_id = auth.uid());
create policy msg_own on public.messages for select to authenticated
  using (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()));
create policy cit_own on public.message_citations for select to authenticated
  using (exists (select 1 from messages m join conversations c on c.id = m.conversation_id
                 where m.id = message_id and c.user_id = auth.uid()));
-- 대화 삭제는 본인이 직접 요청할 수 있다.
create policy conv_delete on public.conversations for delete to authenticated using (user_id = auth.uid());
-- quota_counters, usage_reservations: 정책 없음 → 브라우저 역할 접근 불가(service_role 전용).

-- 테이블 권한: 기본 권한을 모두 회수한 뒤 필요한 읽기/본인 쓰기만 부여.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.collection_runs, public.video_observations, public.channel_observations,
  public.category_counts, public.keyword_counts, public.video_versions, public.channel_versions to anon, authenticated;
grant select on public.search_sets, public.user_search_slots, public.conversations, public.messages, public.message_citations to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant delete on public.conversations to authenticated;
