-- FUTO Bar Association — legal aid clinic, blog and archive.
--
-- Security model
--   * Admins are Supabase Auth users listed in public.admins. Only they can
--     read or change cases, barristers and drafts.
--   * Students never touch public.cases directly. They submit through
--     submit_case() and check progress through case_status(), which needs
--     both the reference number and the matric number.
--   * The public can read published posts and published case summaries only.

-- ------------------------------------------------------------------ admins
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy "Admins can see the admin list"
  on public.admins for select to authenticated
  using ((select public.is_admin()));

-- ------------------------------------------------------- updated_at helper
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -------------------------------------------------------------- barristers
create table public.barristers (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null check (length(trim(full_name)) between 2 and 120),
  email      text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone      text check (phone is null or length(phone) <= 30),
  level      text check (level is null or length(level) <= 40),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.barristers enable row level security;

create trigger barristers_touch before update on public.barristers
  for each row execute function public.touch_updated_at();

create policy "Admins manage barristers"
  on public.barristers for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ------------------------------------------------------------------- cases
create table public.cases (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  full_name     text not null check (length(trim(full_name)) between 2 and 120),
  matric_number text not null check (matric_number ~ '^[0-9]{11}$'),
  department    text not null check (length(trim(department)) between 2 and 120),
  level         text not null check (length(level) <= 40),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  phone         text not null check (length(phone) between 7 and 30),
  category      text not null check (category in (
                  'academic', 'disciplinary', 'hostel', 'harassment',
                  'tenancy', 'police', 'employment', 'consumer', 'other')),
  title         text not null check (length(trim(title)) between 4 and 160),
  description   text not null check (length(trim(description)) between 20 and 8000),
  status        text not null default 'new' check (status in (
                  'new', 'assigned', 'in_progress', 'resolved', 'closed')),
  barrister_id  uuid references public.barristers (id) on delete set null,
  update_note   text check (update_note is null or length(update_note) <= 2000),
  admin_notes   text check (admin_notes is null or length(admin_notes) <= 8000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  assigned_at   timestamptz,
  resolved_at   timestamptz
);

create index cases_status_idx on public.cases (status, created_at desc);
create index cases_barrister_idx on public.cases (barrister_id);
create index cases_matric_idx on public.cases (matric_number, created_at desc);

alter table public.cases enable row level security;

create or replace function public.cases_track_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.barrister_id is not null and old.barrister_id is distinct from new.barrister_id then
    new.assigned_at := now();
    if new.status = 'new' then
      new.status := 'assigned';
    end if;
  end if;
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_at := now();
  elsif new.status not in ('resolved', 'closed') then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create trigger cases_track before update on public.cases
  for each row execute function public.cases_track_status();

create policy "Admins read cases"
  on public.cases for select to authenticated
  using ((select public.is_admin()));

create policy "Admins update cases"
  on public.cases for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins delete cases"
  on public.cases for delete to authenticated
  using ((select public.is_admin()));

-- Public entry point for students. Validates, rate-limits per matric number
-- and returns the reference number the student keeps.
create or replace function public.submit_case(
  p_full_name     text,
  p_matric_number text,
  p_department    text,
  p_level         text,
  p_email         text,
  p_phone         text,
  p_category      text,
  p_title         text,
  p_description   text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matric text := regexp_replace(coalesce(p_matric_number, ''), '\s', '', 'g');
  v_ref    text;
begin
  if v_matric !~ '^[0-9]{11}$' then
    raise exception 'Enter your 11-digit FUTO matric (registration) number.'
      using errcode = 'P0001';
  end if;

  if (select count(*) from public.cases
      where matric_number = v_matric
        and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'You have submitted three cases in the last 24 hours. Please wait before submitting another.'
      using errcode = 'P0001';
  end if;

  loop
    v_ref := 'FBA-' || to_char(now(), 'YY') || '-'
          || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.cases where reference = v_ref);
  end loop;

  insert into public.cases (
    reference, full_name, matric_number, department, level,
    email, phone, category, title, description
  ) values (
    v_ref, trim(p_full_name), v_matric, trim(p_department), trim(p_level),
    lower(trim(p_email)), trim(p_phone), p_category, trim(p_title), trim(p_description)
  );

  return v_ref;
end;
$$;

revoke execute on function public.submit_case(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_case(text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- Public status lookup. Both values must match, so a leaked reference alone
-- reveals nothing.
create or replace function public.case_status(p_reference text, p_matric_number text)
returns table (
  reference       text,
  title           text,
  status          text,
  update_note     text,
  barrister_name  text,
  barrister_email text,
  barrister_phone text,
  submitted_at    timestamptz,
  updated_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.reference, c.title, c.status, c.update_note,
         b.full_name, b.email, b.phone,
         c.created_at, c.updated_at
  from public.cases c
  left join public.barristers b on b.id = c.barrister_id
  where c.reference = upper(trim(p_reference))
    and c.matric_number = regexp_replace(coalesce(p_matric_number, ''), '\s', '', 'g');
$$;

revoke execute on function public.case_status(text, text) from public;
grant execute on function public.case_status(text, text) to anon, authenticated;

-- ------------------------------------------- anonymised case archive entries
create table public.case_summaries (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid references public.cases (id) on delete set null,
  title        text not null check (length(trim(title)) between 4 and 160),
  category     text not null default 'other',
  summary      text not null check (length(trim(summary)) between 20 and 20000),
  outcome      text not null default '' check (length(outcome) <= 4000),
  published    boolean not null default false,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index case_summaries_pub_idx on public.case_summaries (published, published_at desc);
create index case_summaries_case_idx on public.case_summaries (case_id);

alter table public.case_summaries enable row level security;

create policy "Anyone reads published case summaries"
  on public.case_summaries for select to anon, authenticated
  using (published or (select public.is_admin()));

create policy "Admins insert case summaries"
  on public.case_summaries for insert to authenticated
  with check ((select public.is_admin()));

create policy "Admins update case summaries"
  on public.case_summaries for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins delete case summaries"
  on public.case_summaries for delete to authenticated
  using ((select public.is_admin()));

-- ------------------------------------------------------------------- posts
create table public.posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 100),
  kind         text not null default 'blog' check (kind in ('blog', 'article')),
  title        text not null check (length(trim(title)) between 4 and 200),
  excerpt      text not null default '' check (length(excerpt) <= 400),
  body         text not null default '' check (length(body) <= 100000),
  author_name  text not null default 'FUTO Bar Association' check (length(author_name) <= 120),
  published    boolean not null default false,
  published_at timestamptz,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index posts_pub_idx on public.posts (published, published_at desc);
create index posts_created_by_idx on public.posts (created_by);

alter table public.posts enable row level security;

-- Stamp the first publication time once; keep it if a post is unpublished
-- and republished later so archive months stay stable.
create or replace function public.stamp_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.published and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger posts_stamp before insert or update on public.posts
  for each row execute function public.stamp_published_at();

create trigger case_summaries_stamp before insert or update on public.case_summaries
  for each row execute function public.stamp_published_at();

create policy "Anyone reads published posts"
  on public.posts for select to anon, authenticated
  using (published or (select public.is_admin()));

create policy "Admins insert posts"
  on public.posts for insert to authenticated
  with check ((select public.is_admin()));

create policy "Admins update posts"
  on public.posts for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins delete posts"
  on public.posts for delete to authenticated
  using ((select public.is_admin()));
