-- LokPravaah Blog & Updates (safe to run more than once after v4_platform_migration.sql)
-- Only super_admin accounts can create, edit, publish, or delete posts.

-- Add the AI switch to the existing flag constraint (the table predates this feature).
alter table public.app_feature_flags drop constraint if exists app_feature_flags_flag_key_check;
alter table public.app_feature_flags add constraint app_feature_flags_flag_key_check
  check (flag_key in ('reporting','public_chat','rewards','civic_toolkit','evidence_upload','community_support','janwatch_ai'));
insert into public.app_feature_flags(flag_key, enabled, label, description)
values ('janwatch_ai', true, 'LokPravaah AI assistant', 'Allow signed-in citizens to use the multi-provider AI assistant. Provider keys remain server-side.')
on conflict (flag_key) do nothing;

create table if not exists public.site_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) between 1 and 160),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  excerpt text not null default '' check (char_length(excerpt) <= 500),
  body text not null check (char_length(btrim(body)) between 10 and 20000),
  post_type text not null default 'blog' check (post_type in ('blog','app_update','feature_update')),
  link_url text,
  is_published boolean not null default false,
  author_id uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_posts_link_https_check check (link_url is null or link_url ~* '^https://')
);
create index if not exists site_posts_public_idx on public.site_posts(is_published, published_at desc) where is_published = true;
create index if not exists site_posts_created_idx on public.site_posts(created_at desc);
alter table public.site_posts enable row level security;

drop policy if exists "site posts public read published" on public.site_posts;
create policy "site posts public read published" on public.site_posts
  for select to anon, authenticated
  using (is_published = true or public.is_janwatch_super_admin());

drop policy if exists "site posts super admin insert" on public.site_posts;
create policy "site posts super admin insert" on public.site_posts
  for insert to authenticated
  with check (public.is_janwatch_super_admin() and author_id = auth.uid());

drop policy if exists "site posts super admin update" on public.site_posts;
create policy "site posts super admin update" on public.site_posts
  for update to authenticated
  using (public.is_janwatch_super_admin())
  with check (public.is_janwatch_super_admin());

drop policy if exists "site posts super admin delete" on public.site_posts;
create policy "site posts super admin delete" on public.site_posts
  for delete to authenticated
  using (public.is_janwatch_super_admin());

-- Author role tags are server-stamped by the database trigger, not trusted from the browser.
alter table public.community_messages add column if not exists author_role text not null default 'member';

create or replace function public.janwatch_set_message_author()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_name text; v_role text;
begin
  select coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1), 'Citizen')
    into v_name
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = new.user_id;
  new.author_name := coalesce(nullif(btrim(v_name), ''), 'Citizen');
  select case
      when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'super_admin') then 'super_admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'admin') then 'admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'moderator') then 'moderator'
      when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'worker') then 'worker'
      else 'member' end
    into v_role;
  new.author_role := coalesce(v_role, 'member');
  new.body := btrim(new.body);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists janwatch_set_message_author_trigger on public.community_messages;
create trigger janwatch_set_message_author_trigger
  before insert or update of body, user_id, author_role on public.community_messages
  for each row execute function public.janwatch_set_message_author();

update public.community_messages cm
set author_role = case
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'super_admin') then 'super_admin'
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'admin') then 'admin'
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'moderator') then 'moderator'
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'worker') then 'worker'
  else 'member' end;

-- Ensure the PostgREST API roles can access the table; RLS above limits which rows/actions succeed.
grant select on public.site_posts to anon, authenticated;
grant insert, update, delete on public.site_posts to authenticated;



-- Stable self-role endpoint keeps navigation and the admin entry independent of report queries.
create or replace function public.janwatch_current_user_role()
returns text language sql stable security definer set search_path = public
as $$
  select ur.role from public.user_roles ur where ur.user_id = auth.uid() limit 1
$$;
revoke all on function public.janwatch_current_user_role() from public, anon;
grant execute on function public.janwatch_current_user_role() to authenticated;

-- Allow accounts to read only their own role; super admins can inspect assignments.
alter table public.user_roles enable row level security;
drop policy if exists "user roles read own or super admin" on public.user_roles;
create policy "user roles read own or super admin" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_janwatch_super_admin());
grant select on public.user_roles to authenticated;

-- Keep already-posted messages' public badges in sync when a moderator/admin role changes.
create or replace function public.janwatch_refresh_chat_roles()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_user_id := OLD.user_id;
  else
    v_user_id := NEW.user_id;
  end if;
  if v_user_id is not null then
    update public.community_messages
    set author_role = case
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'super_admin') then 'super_admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'admin') then 'admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'moderator') then 'moderator'
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'worker') then 'worker'
      else 'member' end
    where user_id = v_user_id;
  end if;
  return null; -- AFTER trigger return values are ignored.
end;
$$;
drop trigger if exists janwatch_refresh_chat_roles_trigger on public.user_roles;
create trigger janwatch_refresh_chat_roles_trigger
  after insert or update or delete on public.user_roles
  for each row execute function public.janwatch_refresh_chat_roles();

notify pgrst, 'reload schema';
-- LokPravaah Worker + Referral system
-- Idempotent migration. Review and run in Supabase SQL Editor against your existing project.
-- No service-role key belongs in the browser. All privileged transitions use SECURITY DEFINER RPCs.

create extension if not exists pgcrypto;

-- Workers are a real platform role, but never an administrator role.
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('citizen','worker','moderator','admin','super_admin'));

-- Keep private evidence uploads available for worker completion proof.
update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'],
    file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800)
where id = 'citizen-evidence';


-- -----------------------------------------------------------------------------
-- Volunteer / worker profiles
-- -----------------------------------------------------------------------------
create table if not exists public.worker_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','active','rejected','suspended')),
  city text not null check (char_length(btrim(city)) between 2 and 80),
  ward text not null check (char_length(btrim(ward)) between 1 and 80),
  skills text[] not null default '{}',
  motivation text not null default '' check (char_length(motivation) <= 1000),
  max_active_tasks integer not null default 3 check (max_active_tasks between 1 and 10),
  available boolean not null default true,
  admin_note text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists worker_profiles_status_idx on public.worker_profiles(status, available, created_at desc);
create index if not exists worker_profiles_location_idx on public.worker_profiles(lower(city), lower(ward));
alter table public.worker_profiles enable row level security;
drop policy if exists "worker profile read own or admin" on public.worker_profiles;
create policy "worker profile read own or admin" on public.worker_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_janwatch_admin());
-- Mutations are intentionally RPC-only. Do not add direct client insert/update policies.
revoke insert, update, delete on public.worker_profiles from anon, authenticated;
grant select on public.worker_profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Task assignment and audit trail
-- -----------------------------------------------------------------------------
create table if not exists public.work_assignments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  worker_id uuid not null references public.worker_profiles(user_id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  status text not null default 'assigned' check (status in ('assigned','accepted','in_progress','submitted_for_review','changes_requested','completed','cancelled')),
  due_at timestamptz,
  worker_note text,
  completion_note text,
  evidence_urls text[] not null default '{}',
  reward_points_awarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_assignments_worker_idx on public.work_assignments(worker_id, status, created_at desc);
create index if not exists work_assignments_report_idx on public.work_assignments(report_id, created_at desc);
create unique index if not exists work_assignments_one_open_report_idx
  on public.work_assignments(report_id)
  where status not in ('completed','cancelled');

create table if not exists public.work_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.work_assignments(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(btrim(action)) between 2 and 60),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists work_events_assignment_idx on public.work_events(assignment_id, created_at desc);
alter table public.work_assignments enable row level security;
alter table public.work_events enable row level security;
drop policy if exists "assignments worker or admin read" on public.work_assignments;
create policy "assignments worker or admin read" on public.work_assignments for select to authenticated
  using (worker_id = auth.uid() or public.is_janwatch_admin());
drop policy if exists "work events worker or admin read" on public.work_events;
create policy "work events worker or admin read" on public.work_events for select to authenticated
  using (exists (select 1 from public.work_assignments wa where wa.id = assignment_id and (wa.worker_id = auth.uid() or public.is_janwatch_admin())));
revoke insert, update, delete on public.work_assignments from anon, authenticated;
revoke insert, update, delete on public.work_events from anon, authenticated;
grant select on public.work_assignments, public.work_events to authenticated;

create table if not exists public.worker_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default true,
  points_per_approved_task integer not null default 25 check (points_per_approved_task between 0 and 100000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.worker_settings(id, enabled, points_per_approved_task)
values (true, true, 25) on conflict (id) do nothing;
alter table public.worker_settings enable row level security;
drop policy if exists "worker settings read authenticated" on public.worker_settings;
create policy "worker settings read authenticated" on public.worker_settings for select to authenticated using (true);
drop policy if exists "worker settings admin update" on public.worker_settings;
create policy "worker settings admin update" on public.worker_settings for update to authenticated
  using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
grant select on public.worker_settings to authenticated;
grant update on public.worker_settings to authenticated;

-- Apply or update own worker application. Re-applications never auto-approve a person.
create or replace function public.janwatch_worker_apply(
  p_city text, p_ward text, p_skills text[], p_motivation text, p_max_active_tasks integer default 3
) returns text language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid := auth.uid(); v_status text; v_skills text[];
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  if char_length(btrim(coalesce(p_city,''))) not between 2 and 80 then raise exception 'Enter a city or town'; end if;
  if char_length(btrim(coalesce(p_ward,''))) not between 1 and 80 then raise exception 'Enter your ward or local area'; end if;
  if char_length(coalesce(p_motivation,'')) > 1000 then raise exception 'Motivation is too long'; end if;
  if coalesce(p_max_active_tasks,3) not between 1 and 10 then raise exception 'Active task limit must be between 1 and 10'; end if;
  v_skills := (select coalesce(array_agg(distinct btrim(skill)), '{}'::text[])
    from unnest(coalesce(p_skills,'{}'::text[])) as skill_rows(skill)
    where char_length(btrim(skill)) between 1 and 80);
  if cardinality(v_skills) > 10 then raise exception 'Choose no more than 10 skills'; end if;
  select status into v_status from public.worker_profiles where user_id = v_user;
  if v_status = 'suspended' then raise exception 'Your worker access is suspended. Contact the platform team'; end if;
  insert into public.worker_profiles(user_id, status, city, ward, skills, motivation, max_active_tasks, updated_at)
  values (v_user, 'pending', btrim(p_city), btrim(p_ward), v_skills, btrim(coalesce(p_motivation,'')), coalesce(p_max_active_tasks,3), now())
  on conflict(user_id) do update set
    city=excluded.city, ward=excluded.ward, skills=excluded.skills,
    motivation=excluded.motivation, max_active_tasks=excluded.max_active_tasks,
    status=case when public.worker_profiles.status in ('active','suspended') then public.worker_profiles.status else 'pending' end,
    updated_at=now();
  return (select status from public.worker_profiles where user_id=v_user);
end; $$;
revoke all on function public.janwatch_worker_apply(text,text,text[],text,integer) from public, anon;
grant execute on function public.janwatch_worker_apply(text,text,text[],text,integer) to authenticated;

create or replace function public.janwatch_worker_set_availability(p_available boolean)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  update public.worker_profiles set available=coalesce(p_available,false),updated_at=now()
  where user_id=v_user and status='active';
  if not found then raise exception 'Only an approved active worker can update availability'; end if;
  return coalesce(p_available,false);
end; $$;
revoke all on function public.janwatch_worker_set_availability(boolean) from public, anon;
grant execute on function public.janwatch_worker_set_availability(boolean) to authenticated;

create or replace function public.janwatch_admin_review_worker(p_worker_id uuid, p_action text, p_note text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_old text; v_new text;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator access is required'; end if;
  if p_worker_id = auth.uid() then raise exception 'You cannot review your own worker application'; end if;
  if p_action is null or p_action not in ('approve','reject','suspend','reactivate') then raise exception 'Unsupported worker action'; end if;
  select status into v_old from public.worker_profiles where user_id=p_worker_id for update;
  if not found then raise exception 'Worker application was not found'; end if;
  v_new := case p_action when 'approve' then 'active' when 'reject' then 'rejected' when 'suspend' then 'suspended' else 'active' end;
  if p_action='approve' and v_old not in ('pending','rejected') then raise exception 'Only pending or rejected applications can be approved'; end if;
  if p_action='reject' and v_old <> 'pending' then raise exception 'Only pending applications can be rejected'; end if;
  if p_action='suspend' and v_old <> 'active' then raise exception 'Only active workers can be suspended'; end if;
  if p_action='reactivate' and v_old <> 'suspended' then raise exception 'Only suspended workers can be reactivated'; end if;
  update public.worker_profiles set status=v_new, admin_note=nullif(left(btrim(coalesce(p_note,'')),1000),''),
    approved_by=case when v_new='active' then auth.uid() else approved_by end,
    approved_at=case when v_new='active' then coalesce(approved_at,now()) else approved_at end,
    updated_at=now() where user_id=p_worker_id;
  if v_new='active' then
    -- Do not replace an existing privileged admin/moderator role with worker.
    if not exists (select 1 from public.user_roles where user_id=p_worker_id and role in ('moderator','admin','super_admin')) then
      insert into public.user_roles(user_id,role,assigned_by) values (p_worker_id,'worker',auth.uid())
      on conflict (user_id) do update set role='worker', assigned_by=auth.uid()
      where public.user_roles.role in ('citizen','worker');
    end if;
  else
    update public.user_roles set role='citizen', assigned_by=auth.uid()
      where user_id=p_worker_id and role='worker';
  end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'worker_'||p_action,'worker',p_worker_id::text,jsonb_build_object('old_status',v_old,'new_status',v_new,'note',left(coalesce(p_note,''),500)));
  return v_new;
end; $$;
revoke all on function public.janwatch_admin_review_worker(uuid,text,text) from public, anon;
grant execute on function public.janwatch_admin_review_worker(uuid,text,text) to authenticated;

create or replace function public.janwatch_admin_assign_work(p_report_id uuid, p_worker_id uuid, p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_report public.reports%rowtype; v_worker public.worker_profiles%rowtype; v_open_count integer; v_assignment uuid;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator access is required'; end if;
  if p_due_at is not null and p_due_at < now() then raise exception 'Due date must be in the future'; end if;
  select * into v_report from public.reports where id=p_report_id for update;
  if not found then raise exception 'Report was not found'; end if;
  if v_report.visibility <> 'public' then raise exception 'Only public reports can be assigned to a worker'; end if;
  if v_report.status in ('resolved','rejected') then raise exception 'Resolved or rejected reports cannot receive a new assignment'; end if;
  select * into v_worker from public.worker_profiles where user_id=p_worker_id for update;
  if not found then raise exception 'Worker application was not found'; end if;
  if v_worker.status <> 'active' then raise exception 'Choose an approved, active worker'; end if;
  if not v_worker.available then raise exception 'This worker is currently unavailable'; end if;
  select count(*) into v_open_count from public.work_assignments where worker_id=p_worker_id and status not in ('completed','cancelled');
  if v_open_count >= v_worker.max_active_tasks then raise exception 'Worker has reached their active task limit'; end if;
  if exists(select 1 from public.work_assignments where report_id=p_report_id and status not in ('completed','cancelled')) then raise exception 'This report already has an active work assignment'; end if;
  insert into public.work_assignments(report_id,worker_id,assigned_by,due_at,status)
  values(p_report_id,p_worker_id,auth.uid(),p_due_at,'assigned') returning id into v_assignment;
  insert into public.work_events(assignment_id,actor_id,action,note)
  values(v_assignment,auth.uid(),'assigned','Task assigned by the LokPravaah operations team.');
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'work_assigned','work_assignment',v_assignment::text,jsonb_build_object('report_id',p_report_id,'worker_id',p_worker_id,'due_at',p_due_at));
  return v_assignment;
end; $$;
revoke all on function public.janwatch_admin_assign_work(uuid,uuid,timestamptz) from public, anon;
grant execute on function public.janwatch_admin_assign_work(uuid,uuid,timestamptz) to authenticated;

create or replace function public.janwatch_worker_update_assignment(
  p_assignment_id uuid, p_action text, p_note text default null, p_evidence_urls text[] default '{}'
) returns public.work_assignments language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid := auth.uid(); v_row public.work_assignments%rowtype; v_next text; v_urls text[];
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  if not exists(select 1 from public.worker_profiles where user_id=v_user and status='active') then
    raise exception 'Only approved, active workers can update assignments';
  end if;
  select * into v_row from public.work_assignments where id=p_assignment_id and worker_id=v_user for update;
  if not found then raise exception 'This task does not belong to your account'; end if;
  if char_length(coalesce(p_note,'')) > 2000 then raise exception 'Note is too long'; end if;
  v_urls := coalesce(p_evidence_urls,'{}'::text[]);
  if cardinality(v_urls) > 5 then raise exception 'Attach no more than five evidence links'; end if;
  if exists(select 1 from unnest(v_urls) as url_rows(url)
    where char_length(url)>1000
      or not (url ~* '^https://[^[:space:]]+$'
        or url like 'storage://citizen-evidence/'||v_user::text||'/worker-work/%')) then
    raise exception 'Evidence must be an HTTPS link or a file uploaded to your own worker evidence folder';
  end if;
  if p_action='accept' and v_row.status='assigned' then v_next:='accepted';
  elsif p_action='start' and v_row.status in ('accepted','changes_requested') then v_next:='in_progress';
  elsif p_action='submit' and v_row.status='in_progress' then
    if char_length(btrim(coalesce(p_note,''))) < 15 and cardinality(v_urls)=0 then raise exception 'Add a completion note (at least 15 characters) or an evidence link'; end if;
    v_next:='submitted_for_review';
  else raise exception 'That action is not available for the current task status'; end if;
  update public.work_assignments set status=v_next,
    worker_note=case when p_action in ('accept','start') then nullif(left(btrim(coalesce(p_note,'')),2000),'') else worker_note end,
    completion_note=case when p_action='submit' then nullif(left(btrim(coalesce(p_note,'')),2000),'') else completion_note end,
    evidence_urls=case when p_action='submit' then v_urls else evidence_urls end,
    updated_at=now() where id=p_assignment_id returning * into v_row;
  insert into public.work_events(assignment_id,actor_id,action,note)
  values(p_assignment_id,v_user,v_next,nullif(left(btrim(coalesce(p_note,'')),1000),''));
  return v_row;
end; $$;
revoke all on function public.janwatch_worker_update_assignment(uuid,text,text,text[]) from public, anon;
grant execute on function public.janwatch_worker_update_assignment(uuid,text,text,text[]) to authenticated;

create or replace function public.janwatch_admin_review_assignment(p_assignment_id uuid, p_action text, p_note text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_row public.work_assignments%rowtype; v_next text; v_points integer; v_settings_enabled boolean; v_reward_enabled boolean;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator access is required'; end if;
  if p_action is null or p_action not in ('approve','request_changes','cancel') then raise exception 'Unsupported task review action'; end if;
  select * into v_row from public.work_assignments where id=p_assignment_id for update;
  if not found then raise exception 'Task assignment was not found'; end if;
  if p_action in ('approve','request_changes') and v_row.status <> 'submitted_for_review' then raise exception 'Only submitted tasks can be reviewed'; end if;
  if p_action='cancel' and v_row.status in ('completed','cancelled') then raise exception 'This task is already closed'; end if;
  v_next:=case p_action when 'approve' then 'completed' when 'request_changes' then 'changes_requested' else 'cancelled' end;
  update public.work_assignments set status=v_next, updated_at=now() where id=p_assignment_id;
  insert into public.work_events(assignment_id,actor_id,action,note)
  values(p_assignment_id,auth.uid(),v_next,nullif(left(btrim(coalesce(p_note,'')),1000),''));
  if p_action='approve' and not v_row.reward_points_awarded then
    select enabled,points_per_approved_task into v_settings_enabled,v_points from public.worker_settings where id=true;
    select coalesce((select enabled from public.reward_settings where id=true),false) and exists(select 1 from public.app_feature_flags where flag_key='rewards' and enabled) into v_reward_enabled;
    if coalesce(v_settings_enabled,false) and coalesce(v_reward_enabled,false) and coalesce(v_points,0)>0 then
      insert into public.reward_ledger(user_id,delta_points,reason,source_report_id,created_by)
      select v_row.worker_id,v_points,'Approved volunteer task: '||coalesce(r.public_code,'LokPravaah report'),v_row.report_id,auth.uid()
      from public.reports r where r.id=v_row.report_id;
      update public.work_assignments set reward_points_awarded=true where id=p_assignment_id;
    end if;
  end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'work_'||p_action,'work_assignment',p_assignment_id::text,jsonb_build_object('old_status',v_row.status,'new_status',v_next,'note',left(coalesce(p_note,''),500)));
  return v_next;
end; $$;
revoke all on function public.janwatch_admin_review_assignment(uuid,text,text) from public, anon;
grant execute on function public.janwatch_admin_review_assignment(uuid,text,text) to authenticated;

-- Admin-only reconciliation for completed tasks that were approved while rewards were paused.
create or replace function public.janwatch_admin_award_pending_worker_task_rewards()
returns integer language plpgsql security definer set search_path = public, auth as $$
declare v_task public.work_assignments%rowtype; v_points integer; v_awarded integer:=0;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator access is required'; end if;
  select points_per_approved_task into v_points from public.worker_settings where id=true and enabled;
  if not found or coalesce(v_points,0)<=0 then return 0; end if;
  if not exists(select 1 from public.reward_settings where id=true and enabled)
     or not exists(select 1 from public.app_feature_flags where flag_key='rewards' and enabled) then
    raise exception 'Enable the main Rewards setting and Rewards feature before awarding worker points';
  end if;
  for v_task in
    select * from public.work_assignments where status='completed' and not reward_points_awarded
    order by updated_at,created_at for update skip locked
  loop
    insert into public.reward_ledger(user_id,delta_points,reason,source_report_id,created_by)
    select v_task.worker_id,v_points,'Approved volunteer task: '||coalesce(r.public_code,'LokPravaah report'),v_task.report_id,auth.uid()
    from public.reports r where r.id=v_task.report_id;
    update public.work_assignments set reward_points_awarded=true where id=v_task.id and not reward_points_awarded;
    if found then v_awarded:=v_awarded+1; end if;
  end loop;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(auth.uid(),'worker_task_rewards_reconciled','worker_settings','true',jsonb_build_object('awarded_count',v_awarded));
  return v_awarded;
end; $$;
revoke all on function public.janwatch_admin_award_pending_worker_task_rewards() from public, anon;
grant execute on function public.janwatch_admin_award_pending_worker_task_rewards() to authenticated;

-- -----------------------------------------------------------------------------
-- Referral attribution, anti-self-referral guard, and optional reward bonus
-- -----------------------------------------------------------------------------
create table if not exists public.referral_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_code text not null,
  status text not null default 'pending' check (status in ('pending','qualified','rejected')),
  bonus_awarded boolean not null default false,
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  constraint referrals_no_self_referral check (referrer_id <> referred_user_id)
);
create index if not exists referrals_referrer_idx on public.referrals(referrer_id,status,created_at desc);
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
-- Private referral data is returned through scoped summary RPCs only.
revoke all on public.referral_codes from anon, authenticated;
revoke all on public.referrals from anon, authenticated;

create table if not exists public.referral_settings (
  id boolean primary key default true check (id=true),
  enabled boolean not null default true,
  bonus_points integer not null default 50 check (bonus_points between 0 and 100000),
  max_qualified_referrals integer not null default 100 check (max_qualified_referrals between 1 and 10000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.referral_settings(id,enabled,bonus_points,max_qualified_referrals)
values(true,true,50,100) on conflict(id) do nothing;
alter table public.referral_settings enable row level security;
drop policy if exists "referral settings read authenticated" on public.referral_settings;
create policy "referral settings read authenticated" on public.referral_settings for select to authenticated using (true);
drop policy if exists "referral settings admin update" on public.referral_settings;
create policy "referral settings admin update" on public.referral_settings for update to authenticated
  using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
grant select on public.referral_settings to authenticated;
grant update on public.referral_settings to authenticated;

create or replace function public.janwatch_get_my_referral_code()
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid := auth.uid(); v_code text;
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  select code into v_code from public.referral_codes where user_id=v_user;
  if v_code is null then
    loop
      v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
      begin
        insert into public.referral_codes(user_id,code) values(v_user,v_code);
        exit;
      exception when unique_violation then
        select code into v_code from public.referral_codes where user_id=v_user;
        if v_code is not null then exit; end if;
      end;
    end loop;
  end if;
  return v_code;
end; $$;
revoke all on function public.janwatch_get_my_referral_code() from public, anon;
grant execute on function public.janwatch_get_my_referral_code() to authenticated;

create or replace function public.janwatch_capture_referral(p_referral_code text)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid := auth.uid(); v_referrer uuid; v_code text; v_created_at timestamptz;
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  select created_at into v_created_at from auth.users where id=v_user;
  if v_created_at is null or v_created_at < now() - interval '14 days' then return false; end if;
  v_code:=upper(btrim(coalesce(p_referral_code,'')));
  if v_code !~ '^[A-Z0-9]{8}$' then return false; end if;
  select user_id into v_referrer from public.referral_codes where code=v_code;
  if v_referrer is null or v_referrer=v_user then return false; end if;
  if exists(select 1 from public.referrals where referred_user_id=v_user) then return false; end if;
  insert into public.referrals(referrer_id,referred_user_id,referral_code,status)
  values(v_referrer,v_user,v_code,'pending') on conflict(referred_user_id) do nothing;
  return exists(select 1 from public.referrals where referred_user_id=v_user and referrer_id=v_referrer);
end; $$;
revoke all on function public.janwatch_capture_referral(text) from public, anon;
grant execute on function public.janwatch_capture_referral(text) to authenticated;

-- Qualification only happens for a different account with a verified email and a complete city/ward profile.
create or replace function public.janwatch_qualify_my_referral()
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=auth.uid(); v_email_verified boolean; v_city text; v_ward text; v_ref public.referrals%rowtype;
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  select (email_confirmed_at is not null) into v_email_verified from auth.users where id=v_user;
  select city,ward into v_city,v_ward from public.profiles where id=v_user;
  if not coalesce(v_email_verified,false) or char_length(btrim(coalesce(v_city,'')))<2 or char_length(btrim(coalesce(v_ward,'')))<1 then return false; end if;
  select * into v_ref from public.referrals where referred_user_id=v_user and status='pending' for update;
  if not found then return false; end if;
  update public.referrals set status='qualified',qualified_at=now() where id=v_ref.id and status='pending';
  if not found then return false; end if;
  -- Award once, to the referrer, only while both referral and reward programmes are enabled.
  if exists(select 1 from public.referral_settings where id=true and enabled and bonus_points>0)
     and exists(select 1 from public.reward_settings where id=true and enabled)
     and exists(select 1 from public.app_feature_flags where flag_key='rewards' and enabled)
     and (select count(*) from public.referrals where referrer_id=v_ref.referrer_id and status='qualified') <= (select max_qualified_referrals from public.referral_settings where id=true) then
    insert into public.reward_ledger(user_id,delta_points,reason,source_report_id,created_by)
    values(v_ref.referrer_id,(select bonus_points from public.referral_settings where id=true),'Qualified referral bonus · '||substr(v_user::text,1,8),null,v_user);
    update public.referrals set bonus_awarded=true where id=v_ref.id;
  end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(v_user,'referral_qualified','referral',v_ref.id::text,jsonb_build_object('referrer_id',v_ref.referrer_id));
  return true;
end; $$;
revoke all on function public.janwatch_qualify_my_referral() from public, anon;
grant execute on function public.janwatch_qualify_my_referral() to authenticated;

-- Admin-only reconciliation lets previously qualified referrals receive their bonus
-- if rewards were paused when they qualified. Row locks and bonus_awarded prevent duplicates.
create or replace function public.janwatch_admin_award_pending_referral_bonuses()
returns integer language plpgsql security definer set search_path = public, auth as $$
declare v_ref public.referrals%rowtype; v_bonus integer; v_limit integer; v_qualified_count integer; v_awarded integer:=0;
begin
  if auth.uid() is null or not public.is_janwatch_admin() then raise exception 'Administrator access is required'; end if;
  select bonus_points,max_qualified_referrals into v_bonus,v_limit
    from public.referral_settings where id=true and enabled;
  if not found or coalesce(v_bonus,0)<=0 then return 0; end if;
  if not exists(select 1 from public.reward_settings where id=true and enabled)
     or not exists(select 1 from public.app_feature_flags where flag_key='rewards' and enabled) then
    raise exception 'Enable the main Rewards setting and Rewards feature before awarding referral bonuses';
  end if;
  for v_ref in
    select * from public.referrals where status='qualified' and not bonus_awarded
    order by qualified_at nulls last, created_at, id
    for update skip locked
  loop
    -- Enforce the cap chronologically: when rewards were paused during many signups,
    -- award the earliest qualified referrals up to the cap rather than blocking all of them.
    select count(*)::integer into v_qualified_count
    from (
      select id, row_number() over (order by qualified_at nulls last, created_at, id) as referral_rank
      from public.referrals
      where referrer_id=v_ref.referrer_id and status='qualified'
    ) ranked
    where id=v_ref.id and referral_rank <= v_limit;
    if v_qualified_count > 0 then
      insert into public.reward_ledger(user_id,delta_points,reason,source_report_id,created_by)
      values(v_ref.referrer_id,v_bonus,'Qualified referral bonus · '||substr(v_ref.referred_user_id::text,1,8),null,auth.uid());
      update public.referrals set bonus_awarded=true where id=v_ref.id and not bonus_awarded;
      if found then v_awarded:=v_awarded+1; end if;
    end if;
  end loop;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(auth.uid(),'referral_bonus_reconciled','referral_settings','true',jsonb_build_object('awarded_count',v_awarded));
  return v_awarded;
end; $$;
revoke all on function public.janwatch_admin_award_pending_referral_bonuses() from public, anon;
grant execute on function public.janwatch_admin_award_pending_referral_bonuses() to authenticated;

create or replace function public.janwatch_my_referral_summary()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=auth.uid(); v_code text; v_points integer; v_enabled boolean; v_total integer; v_qualified integer; v_pending integer; v_history jsonb;
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  v_code:=public.janwatch_get_my_referral_code();
  select bonus_points,
    (enabled and exists(select 1 from public.reward_settings where id=true and enabled)
      and exists(select 1 from public.app_feature_flags where flag_key='rewards' and enabled))
    into v_points,v_enabled from public.referral_settings where id=true;
  select count(*)::integer, count(*) filter(where status='qualified')::integer, count(*) filter(where status='pending')::integer
    into v_total,v_qualified,v_pending from public.referrals where referrer_id=v_user;
  select coalesce(jsonb_agg(jsonb_build_object('status',status,'created_at',created_at,'qualified_at',qualified_at,'bonus_awarded',bonus_awarded) order by created_at desc),'[]'::jsonb)
    into v_history from (select status,created_at,qualified_at,bonus_awarded from public.referrals where referrer_id=v_user order by created_at desc limit 30) h;
  return jsonb_build_object('code',v_code,'total',coalesce(v_total,0),'qualified',coalesce(v_qualified,0),'pending',coalesce(v_pending,0),
    'bonus_points',coalesce(v_points,0),'enabled',coalesce(v_enabled,false),'history',v_history);
end; $$;
revoke all on function public.janwatch_my_referral_summary() from public, anon;
grant execute on function public.janwatch_my_referral_summary() to authenticated;

-- Keep admin configuration changes auditable, including UI changes and SQL Editor updates.
create or replace function public.janwatch_log_worker_referral_settings_change()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),tg_table_name||'_updated',tg_table_name,'true',
    jsonb_build_object('old',to_jsonb(old)-'updated_at'-'updated_by','new',to_jsonb(new)-'updated_at'-'updated_by'));
  return new;
end; $$;
revoke all on function public.janwatch_log_worker_referral_settings_change() from public, anon, authenticated;
drop trigger if exists janwatch_worker_settings_audit on public.worker_settings;
create trigger janwatch_worker_settings_audit after update on public.worker_settings
  for each row execute function public.janwatch_log_worker_referral_settings_change();
drop trigger if exists janwatch_referral_settings_audit on public.referral_settings;
create trigger janwatch_referral_settings_audit after update on public.referral_settings
  for each row execute function public.janwatch_log_worker_referral_settings_change();

-- Realtime is optional. The UI refreshes on demand and after mutations even if Realtime is not enabled.
comment on table public.worker_profiles is 'Volunteer applications and approval state. Changes are restricted to authenticated RPCs.';
comment on table public.work_assignments is 'Task assignments linked to public civic reports. Worker completion does not change official report status.';
comment on table public.referrals is 'Private referral attribution; client access is scoped through security-definer RPCs.';

notify pgrst, 'reload schema';

-- Super-admin can directly assign a worker role. This also creates an approved worker profile,
-- so the person can receive tasks immediately without needing to submit an application first.
create or replace function public.janwatch_admin_set_role(p_target_user_id uuid, p_target_role text)
returns void language plpgsql security definer set search_path = public, auth
as $$
declare v_current text; v_super_count integer; v_city text; v_ward text;
begin
  if not public.is_janwatch_super_admin() then raise exception 'Super administrator permission required'; end if;
  if p_target_user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if p_target_role is not null and p_target_role not in ('worker','moderator','admin','super_admin') then raise exception 'Unsupported role'; end if;
  select role into v_current from public.user_roles where user_id=p_target_user_id;
  if v_current = 'super_admin' and coalesce(p_target_role,'citizen') <> 'super_admin' then
    select count(*) into v_super_count from public.user_roles where role='super_admin';
    if v_super_count <= 1 then raise exception 'Cannot remove the last super administrator'; end if;
  end if;
  if p_target_role is null or p_target_role = 'citizen' then
    delete from public.user_roles where user_id=p_target_user_id;
    update public.worker_profiles set status='suspended', available=false, updated_at=now()
      where user_id=p_target_user_id and status='active';
  else
    insert into public.user_roles(user_id,role,assigned_by) values (p_target_user_id,p_target_role,auth.uid())
    on conflict (user_id) do update set role=excluded.role, assigned_by=auth.uid();
    if p_target_role='worker' then
      select case when char_length(btrim(coalesce(city,''))) between 2 and 80 then btrim(city) else 'Unspecified city' end,
             case when char_length(btrim(coalesce(ward,''))) between 1 and 80 then btrim(ward) else 'Unspecified area' end
        into v_city,v_ward from public.profiles where id=p_target_user_id;
      v_city := coalesce(v_city,'Unspecified city'); v_ward := coalesce(v_ward,'Unspecified area');
      insert into public.worker_profiles(user_id,status,city,ward,skills,motivation,max_active_tasks,available,approved_by,approved_at)
      values (p_target_user_id,'active',v_city,v_ward,'{}','Directly assigned by a super administrator',3,true,auth.uid(),now())
      on conflict (user_id) do update set status='active',available=true,approved_by=auth.uid(),approved_at=now(),updated_at=now();
    elsif v_current='worker' then
      update public.worker_profiles set status='suspended',available=false,updated_at=now() where user_id=p_target_user_id and status='active';
    end if;
  end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values (auth.uid(),'user_role_changed','user',p_target_user_id::text,
    jsonb_build_object('old_role',coalesce(v_current,'citizen'),'new_role',coalesce(p_target_role,'citizen')));
end;
$$;
revoke all on function public.janwatch_admin_set_role(uuid,text) from public, anon;
grant execute on function public.janwatch_admin_set_role(uuid,text) to authenticated;

notify pgrst, 'reload schema';

