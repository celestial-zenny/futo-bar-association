-- Students choose their own barrister; barristers sign in to accept cases.
--
--   * A case is "requested" while status = 'new' and barrister_id is set: the
--     student picked that barrister, who has not answered yet. Functions that
--     report status return the word 'requested' for that state.
--   * The barrister accepts (-> 'assigned') or declines (barrister cleared),
--     and the student can then pick someone else from the status page.
--   * Public barrister profiles come from public_barristers(), which never
--     returns email or phone. Contact details reach a student only once the
--     case is accepted or assigned by an admin.
--   * Barristers act only through the barrister_* functions, so they never
--     see admin notes or cases that are not theirs.

-- ------------------------------------------------------------- barristers
create or replace function public.my_barrister_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select id from public.barristers where user_id = (select auth.uid()); $$;
revoke execute on function public.my_barrister_id() from public, anon;
grant execute on function public.my_barrister_id() to authenticated;

-- Links an invited user to the barrister profile carrying their confirmed
-- email. The portal calls it after every sign-in.
create or replace function public.claim_barrister_profile()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(email) into v_email from auth.users
  where id = (select auth.uid()) and email_confirmed_at is not null;
  if v_email is not null and public.my_barrister_id() is null then
    update public.barristers set user_id = (select auth.uid())
    where user_id is null and lower(email) = v_email;
  end if;
  return public.my_barrister_id();
end;
$$;
revoke execute on function public.claim_barrister_profile() from public, anon;
grant execute on function public.claim_barrister_profile() to authenticated;

create or replace function public.public_barristers()
returns table (id uuid, full_name text, level text, bio text, areas text[],
               photo_url text, active boolean, open_cases integer)
language sql stable security definer set search_path = ''
as $$
  select b.id, b.full_name, b.level, b.bio, b.areas, b.photo_url, b.active,
         (select count(*)::integer from public.cases c
          where c.barrister_id = b.id and c.status in ('new', 'assigned', 'in_progress'))
  from public.barristers b
  order by b.active desc, b.full_name;
$$;
revoke execute on function public.public_barristers() from public;
grant execute on function public.public_barristers() to anon, authenticated;

create or replace function public.barrister_is_available(p_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.barristers where id = p_id and active); $$;
revoke execute on function public.barrister_is_available(uuid) from public, anon, authenticated;

create policy "Barristers read their own profile"
  on public.barristers for select to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------ cases
-- An admin giving a 'new' case to a barrister assigns it outright. A
-- student's choice sets fba.student_choice so the case stays 'new' (that is,
-- requested) until the barrister answers.
create or replace function public.cases_track_status()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.barrister_id is not null and old.barrister_id is distinct from new.barrister_id then
    new.assigned_at := now();
    if new.status = 'new' and coalesce(current_setting('fba.student_choice', true), '') <> 'on' then
      new.status := 'assigned';
    end if;
  end if;
  if new.barrister_id is null and new.status = 'assigned' then
    new.status := 'new';
  end if;
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_at := now();
  elsif new.status not in ('resolved', 'closed') then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.submit_case(
  p_full_name text, p_matric_number text, p_department text, p_level text,
  p_email text, p_phone text, p_category text, p_title text, p_description text,
  p_barrister_id uuid, p_judiciary_suit text
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_matric text := regexp_replace(coalesce(p_matric_number, ''), '\s', '', 'g');
  v_ref    text;
begin
  if v_matric !~ '^[0-9]{11}$' then
    raise exception 'Enter your 11-digit FUTO matric (registration) number.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.cases
      where matric_number = v_matric and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'You have submitted three cases in the last 24 hours. Please wait before submitting another.' using errcode = 'P0001';
  end if;
  if p_barrister_id is not null and not public.barrister_is_available(p_barrister_id) then
    raise exception 'That barrister is not taking new cases right now. Please choose another, or let the FBA choose for you.' using errcode = 'P0001';
  end if;

  loop
    v_ref := 'FBA-' || to_char(now(), 'YY') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.cases where reference = v_ref);
  end loop;

  insert into public.cases (
    reference, full_name, matric_number, department, level, email, phone,
    category, title, description, barrister_id, assigned_at, judiciary_suit_number
  ) values (
    v_ref, trim(p_full_name), v_matric, trim(p_department), trim(p_level),
    lower(trim(p_email)), trim(p_phone), p_category, trim(p_title), trim(p_description),
    p_barrister_id,
    case when p_barrister_id is null then null else now() end,
    nullif(trim(coalesce(p_judiciary_suit, '')), '')
  );
  return v_ref;
end;
$$;
revoke execute on function public.submit_case(text, text, text, text, text, text, text, text, text, uuid, text) from public;
grant execute on function public.submit_case(text, text, text, text, text, text, text, text, text, uuid, text) to anon, authenticated;

-- The original nine-argument form now forwards to the one above.
create or replace function public.submit_case(
  p_full_name text, p_matric_number text, p_department text, p_level text,
  p_email text, p_phone text, p_category text, p_title text, p_description text
)
returns text language sql security definer set search_path = ''
as $$
  select public.submit_case(p_full_name, p_matric_number, p_department, p_level, p_email,
                            p_phone, p_category, p_title, p_description, null::uuid, null::text);
$$;

-- Same columns as before; status reads 'requested' while the chosen
-- barrister has not answered, and contact details stay hidden until then.
create or replace function public.case_status(p_reference text, p_matric_number text)
returns table (reference text, title text, status text, update_note text,
               barrister_name text, barrister_email text, barrister_phone text,
               submitted_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.reference, c.title,
         case when c.status = 'new' and c.barrister_id is not null then 'requested' else c.status end,
         c.update_note, b.full_name,
         case when c.status <> 'new' then b.email end,
         case when c.status <> 'new' then b.phone end,
         c.created_at, c.updated_at
  from public.cases c
  left join public.barristers b on b.id = c.barrister_id
  where c.reference = upper(trim(p_reference))
    and c.matric_number = regexp_replace(coalesce(p_matric_number, ''), '\s', '', 'g');
$$;

create or replace function public.choose_barrister(p_reference text, p_matric_number text, p_barrister_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.cases
  where reference = upper(trim(p_reference))
    and matric_number = regexp_replace(coalesce(p_matric_number, ''), '\s', '', 'g')
    and status = 'new' and barrister_id is null
  for update;
  if v_id is null then
    raise exception 'This case already has a barrister, or the reference and matric number do not match.' using errcode = 'P0001';
  end if;
  if not public.barrister_is_available(p_barrister_id) then
    raise exception 'That barrister is not taking new cases right now. Please choose another.' using errcode = 'P0001';
  end if;

  perform set_config('fba.student_choice', 'on', true);
  update public.cases set barrister_id = p_barrister_id, update_note = null where id = v_id;
  perform set_config('fba.student_choice', '', true);
  return 'requested';
end;
$$;
revoke execute on function public.choose_barrister(text, text, uuid) from public;
grant execute on function public.choose_barrister(text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------- barrister portal API
create or replace function public.barrister_cases()
returns table (id uuid, reference text, full_name text, matric_number text, department text,
               level text, email text, phone text, category text, title text, description text,
               judiciary_suit_number text, status text, update_note text, barrister_note text,
               created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  -- A requested case shows the matter but not the student's contact
  -- details until the barrister accepts it.
  select c.id, c.reference, c.full_name, c.matric_number, c.department, c.level,
         case when c.status = 'new' then null else c.email end,
         case when c.status = 'new' then null else c.phone end,
         c.category, c.title, c.description, c.judiciary_suit_number,
         case when c.status = 'new' then 'requested' else c.status end,
         c.update_note, c.barrister_note, c.created_at, c.updated_at
  from public.cases c
  where c.barrister_id = public.my_barrister_id()
  order by (c.status = 'new') desc, c.updated_at desc;
$$;
revoke execute on function public.barrister_cases() from public, anon;
grant execute on function public.barrister_cases() to authenticated;

create or replace function public.barrister_respond(p_case_id uuid, p_accept boolean, p_message text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_me   uuid := public.my_barrister_id();
  v_name text;
  v_msg  text := nullif(trim(coalesce(p_message, '')), '');
begin
  if v_me is null then
    raise exception 'Your account is not linked to a barrister profile.' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.barristers where id = v_me;

  if p_accept then
    update public.cases
    set status = 'assigned', update_note = coalesce(v_msg, update_note)
    where id = p_case_id and barrister_id = v_me and status = 'new';
  else
    update public.cases
    set barrister_id = null,
        update_note = v_name || ' is unable to take this case' || coalesce(': ' || v_msg, '')
          || '. Please choose another barrister below, or wait for the FBA to assign one.',
        admin_notes = concat_ws(E'\n', admin_notes, to_char(now(), 'YYYY-MM-DD') || ' declined by ' || v_name)
    where id = p_case_id and barrister_id = v_me and status = 'new';
  end if;

  if not found then
    raise exception 'This case is no longer waiting for your answer.' using errcode = 'P0001';
  end if;
  return case when p_accept then 'assigned' else 'declined' end;
end;
$$;
revoke execute on function public.barrister_respond(uuid, boolean, text) from public, anon;
grant execute on function public.barrister_respond(uuid, boolean, text) to authenticated;

create or replace function public.barrister_update_case(p_case_id uuid, p_status text, p_update_note text, p_barrister_note text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('assigned', 'in_progress', 'resolved') then
    raise exception 'Choose Accepted, In progress or Resolved.' using errcode = 'P0001';
  end if;
  update public.cases
  set status = p_status,
      update_note = nullif(trim(coalesce(p_update_note, '')), ''),
      barrister_note = nullif(trim(coalesce(p_barrister_note, '')), '')
  where id = p_case_id and barrister_id = public.my_barrister_id()
    and status in ('assigned', 'in_progress', 'resolved');
  if not found then
    raise exception 'You can only update cases you have accepted.' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.barrister_update_case(uuid, text, text, text) from public, anon;
grant execute on function public.barrister_update_case(uuid, text, text, text) to authenticated;

create or replace function public.barrister_update_profile(
  p_level text, p_bio text, p_areas text[], p_email text, p_phone text, p_photo_url text, p_active boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.barristers
  set level = nullif(trim(coalesce(p_level, '')), ''),
      bio = trim(coalesce(p_bio, '')),
      areas = coalesce(p_areas, '{}'),
      email = nullif(lower(trim(coalesce(p_email, ''))), ''),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      photo_url = nullif(trim(coalesce(p_photo_url, '')), ''),
      active = coalesce(p_active, active)
  where id = public.my_barrister_id();
  if not found then
    raise exception 'Your account is not linked to a barrister profile.' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.barrister_update_profile(text, text, text[], text, text, text, boolean) from public, anon;
grant execute on function public.barrister_update_profile(text, text, text[], text, text, text, boolean) to authenticated;
