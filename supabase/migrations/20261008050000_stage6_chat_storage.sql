-- Stage 6: AI 대화 저장·조회·삭제, 토큰 예산 보정. 모두 service_role 전용(사용자 id는 서버가 토큰에서 정한다).
-- 결정(2026-10-08): 질문 1~100자, 답변 길이는 제한하지 않는다(서버 저장 상한만 둔다). 대화는 7일 보존(사용자 결정 2026-10-08), 최근 3회 문답만 문맥.

-- ───────── 메시지 제약: 답변 100자 제한 철회, 요청 ID 멱등 키 ─────────
-- 기존 검사 제약의 이름은 자동 생성되므로 정의로 찾아 지운다.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(content)%'
  loop
    execute format('alter table public.messages drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.messages add constraint messages_content_check check (
  char_length(content) >= 1 and
  ((role = 'user' and char_length(content) <= 100) or (role = 'assistant' and char_length(content) <= 20000))
);
alter table public.messages add column request_id uuid;
-- 같은 요청 ID는 대화 안에서 질문 1개·답변 1개만 저장된다(재전송 멱등).
create unique index messages_request_role_idx on public.messages (conversation_id, request_id, role) where request_id is not null;

-- 운영 임시 상한(D08): 계정당 대화 20개, 대화당 문답 50회.
create function public.save_chat_turn(
  p_user uuid, p_conversation uuid, p_request uuid, p_question text, p_answer text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_citations jsonb default '[]'::jsonb,
  p_now timestamptz default now(), p_max_conversations integer default 20, p_max_turns integer default 50)
returns table (state text, conversation_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare conv conversations; qid bigint; aid bigint; turns integer;
begin
  perform lock_user('ai', p_user);
  if p_conversation is null then
    if (select count(*) from conversations where user_id = p_user and expires_at > p_now) >= p_max_conversations then
      return query select 'conversation_limit'::text, null::uuid; return;
    end if;
    insert into conversations (user_id, created_at, updated_at, expires_at)
      values (p_user, p_now, p_now, p_now + interval '7 days') returning * into conv;
  else
    select * into conv from conversations where id = p_conversation and user_id = p_user and expires_at > p_now for update;
    if not found then return query select 'not_found'::text, null::uuid; return; end if;
    if exists (select 1 from messages where conversation_id = conv.id and request_id = p_request and role = 'assistant') then
      return query select 'duplicate'::text, conv.id; return;
    end if;
    select count(*) into turns from messages where conversation_id = conv.id and role = 'user';
    if turns >= p_max_turns then return query select 'turn_limit'::text, null::uuid; return; end if;
  end if;
  insert into messages (conversation_id, role, content, request_id, created_at) values (conv.id, 'user', p_question, p_request, p_now)
    returning id into qid;
  insert into messages (conversation_id, role, content, model, input_tokens, output_tokens, request_id, created_at)
    values (conv.id, 'assistant', p_answer, p_model, p_input_tokens, p_output_tokens, p_request, p_now) returning id into aid;
  -- 인용은 그 실행에서 실제로 관측된 영상만 저장한다(관측이 만료되면 함께 사라진다).
  insert into message_citations (message_id, run_id, video_id)
    select aid, c.run_id, c.video_id
    from jsonb_to_recordset(coalesce(p_citations, '[]'::jsonb)) as c(run_id bigint, video_id text)
    join video_observations o on o.run_id = c.run_id and o.video_id = c.video_id
    on conflict do nothing;
  update conversations set updated_at = p_now where id = conv.id;
  return query select 'saved'::text, conv.id;
end $$;

-- 최근 문답 n회(오래된 순). 본인 소유·미만료 대화만.
create function public.get_chat_history(p_user uuid, p_conversation uuid, p_turns integer default 3, p_now timestamptz default now())
returns table (question text, answer text)
language sql stable security definer set search_path = public as $$
  select q.question, a.answer from (
    select u.request_id, u.id, u.content as question from messages u
    join conversations c on c.id = u.conversation_id
    where u.conversation_id = p_conversation and u.role = 'user' and c.user_id = p_user and c.expires_at > p_now
    order by u.id desc limit greatest(p_turns, 0)) q
  join lateral (select m.content as answer from messages m
    where m.conversation_id = p_conversation and m.role = 'assistant' and m.request_id = q.request_id limit 1) a on true
  order by q.id
$$;

-- 같은 요청 ID로 이미 저장된 답변(재전송 시 Gemini를 다시 호출하지 않는다).
create function public.get_saved_turn(p_user uuid, p_request uuid, p_now timestamptz default now())
returns table (conversation_id uuid, question text, answer text, model text)
language sql stable security definer set search_path = public as $$
  select c.id, u.content, a.content, a.model
  from conversations c
  join messages a on a.conversation_id = c.id and a.role = 'assistant' and a.request_id = p_request
  join messages u on u.conversation_id = c.id and u.role = 'user' and u.request_id = p_request
  where c.user_id = p_user and c.expires_at > p_now limit 1
$$;

-- 대화 목록(최근순)과 한 대화의 전체 메시지. 본인 것만.
create function public.list_conversations(p_user uuid, p_now timestamptz default now())
returns table (id uuid, updated_at timestamptz, expires_at timestamptz, first_question text, turns bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.updated_at, c.expires_at,
    (select m.content from messages m where m.conversation_id = c.id and m.role = 'user' order by m.id limit 1),
    (select count(*) from messages m where m.conversation_id = c.id and m.role = 'user')
  from conversations c where c.user_id = p_user and c.expires_at > p_now order by c.updated_at desc limit 50
$$;

create function public.get_conversation(p_user uuid, p_conversation uuid, p_now timestamptz default now())
returns table (role text, content text, model text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.role, m.content, m.model, m.created_at from messages m
  join conversations c on c.id = m.conversation_id
  where c.id = p_conversation and c.user_id = p_user and c.expires_at > p_now order by m.id
$$;

create function public.delete_conversation(p_user uuid, p_conversation uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from conversations where id = p_conversation and user_id = p_user;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ───────── 전체 토큰 예산 보정: 호출 후 실제 사용량으로 예약분을 조정한다 ─────────
create function public.adjust_quota(p_kind text, p_day date, p_delta integer)
returns void language sql security definer set search_path = public as $$
  update quota_counters set used = least(greatest(used + p_delta, 0), cap) where kind = p_kind and day = p_day
$$;

revoke all on function public.save_chat_turn(uuid, uuid, uuid, text, text, text, integer, integer, jsonb, timestamptz, integer, integer),
  public.get_chat_history(uuid, uuid, integer, timestamptz), public.get_saved_turn(uuid, uuid, timestamptz),
  public.list_conversations(uuid, timestamptz), public.get_conversation(uuid, uuid, timestamptz),
  public.delete_conversation(uuid, uuid), public.adjust_quota(text, date, integer) from public;
grant execute on function public.save_chat_turn(uuid, uuid, uuid, text, text, text, integer, integer, jsonb, timestamptz, integer, integer),
  public.get_chat_history(uuid, uuid, integer, timestamptz), public.get_saved_turn(uuid, uuid, timestamptz),
  public.list_conversations(uuid, timestamptz), public.get_conversation(uuid, uuid, timestamptz),
  public.delete_conversation(uuid, uuid), public.adjust_quota(text, date, integer) to service_role;
