-- JANWATCH V4 platform features: collapse-ready UI, public chat, admin controls,
-- site announcements, audited feature flags, moderated community, rewards ledger,
-- and secure manual-withdrawal requests. Re-runnable for the existing V3 schema.
-- Run this as the project owner in Supabase SQL Editor. Review before production.

create extension if not exists pgcrypto;

-- Store a transparent, non-AI priority suggestion used to help triage reports.
alter table public.reports add column if not exists suggested_severity text not null default 'normal';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_suggested_severity_check'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports add constraint reports_suggested_severity_check
      check (suggested_severity in ('normal','high','urgent'));
  end if;
end $$;
create index if not exists reports_suggested_severity_idx on public.reports(suggested_severity, created_at desc);

-- Ensure the current onboarding fields exist for older project databases.
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists ward text;
alter table public.profiles add column if not exists account_type text not null default 'citizen';
alter table public.profiles add column if not exists preferred_service text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create or replace function public.is_janwatch_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin','super_admin')) $$;

create or replace function public.is_janwatch_super_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'super_admin') $$;

create or replace function public.is_janwatch_moderator()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('moderator','admin','super_admin')) $$;

-- Only public-safe booleans and labels belong in this table. Never store API secrets here.
create table if not exists public.app_feature_flags (
  flag_key text primary key check (flag_key in ('reporting','public_chat','rewards','civic_toolkit','evidence_upload','community_support','janwatch_ai')),
  enabled boolean not null default true,
  label text not null,
  description text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.app_feature_flags(flag_key, enabled, label, description) values
 ('reporting', true, 'Civic reports', 'Allow citizens to submit new civic reports.'),
 ('public_chat', true, 'Public community chat', 'Enable public community conversation and message moderation.'),
 ('rewards', true, 'Rewards & withdrawal requests', 'Enable contribution points and manual withdrawal requests.'),
 ('civic_toolkit', true, 'Civic toolkit', 'Show complaint/RTI draft tools and official resource links.'),
 ('evidence_upload', true, 'Evidence uploads', 'Allow optional private evidence file uploads.'),
 ('community_support', true, 'Community support votes', 'Allow one support vote per account for public reports.'),
 ('janwatch_ai', true, 'LokPravaah AI assistant', 'Allow signed-in citizens to use the multi-provider AI assistant. Provider keys remain server-side.')
on conflict (flag_key) do nothing;
alter table public.app_feature_flags enable row level security;
drop policy if exists "feature flags public read" on public.app_feature_flags;
create policy "feature flags public read" on public.app_feature_flags for select to anon, authenticated using (true);
drop policy if exists "feature flags admin manage" on public.app_feature_flags;
create policy "feature flags admin manage" on public.app_feature_flags for all to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());

create table if not exists public.site_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 3 and 1500),
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists site_announcements_active_idx on public.site_announcements(is_active, created_at desc);
alter table public.site_announcements enable row level security;
drop policy if exists "announcements public active read" on public.site_announcements;
create policy "announcements public active read" on public.site_announcements for select to anon, authenticated
using ((is_active and (expires_at is null or expires_at > now())) or public.is_janwatch_admin());
drop policy if exists "announcements admin manage" on public.site_announcements;
create policy "announcements admin manage" on public.site_announcements for all to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Citizen',
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists community_messages_created_idx on public.community_messages(created_at desc);
create index if not exists community_messages_user_idx on public.community_messages(user_id, created_at desc);
alter table public.community_messages enable row level security;

create or replace function public.janwatch_set_message_author()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  select coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1), 'Citizen')
    into new.author_name
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = new.user_id;
  if new.author_name is null or btrim(new.author_name) = '' then new.author_name := 'Citizen'; end if;
  new.body := btrim(new.body);
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists janwatch_set_message_author_trigger on public.community_messages;
create trigger janwatch_set_message_author_trigger before insert or update of body, user_id on public.community_messages
for each row execute function public.janwatch_set_message_author();

drop policy if exists "chat read visible" on public.community_messages;
create policy "chat read visible" on public.community_messages for select to authenticated using (public.is_janwatch_moderator() or (not is_hidden and exists (select 1 from public.app_feature_flags f where f.flag_key = 'public_chat' and f.enabled)));
drop policy if exists "chat insert own when enabled" on public.community_messages;
create policy "chat insert own when enabled" on public.community_messages for insert to authenticated with check (
  user_id = auth.uid() and not is_hidden and exists (select 1 from public.app_feature_flags f where f.flag_key = 'public_chat' and f.enabled)
  and char_length(btrim(body)) between 1 and 2000
);
drop policy if exists "chat update own recent" on public.community_messages;
create policy "chat update own recent" on public.community_messages for update to authenticated using (user_id = auth.uid() and not is_hidden and created_at > now() - interval '5 minutes') with check (user_id = auth.uid() and not is_hidden);
drop policy if exists "chat admin moderate" on public.community_messages;
create policy "chat admin moderate" on public.community_messages for update to authenticated using (public.is_janwatch_moderator()) with check (public.is_janwatch_moderator());
drop policy if exists "chat delete own recent or admin" on public.community_messages;
create policy "chat delete own recent or admin" on public.community_messages for delete to authenticated using ((user_id = auth.uid() and created_at > now() - interval '5 minutes') or public.is_janwatch_moderator());

create table if not exists public.community_message_flags (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.community_messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 2 and 250),
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(message_id, reporter_id)
);
create index if not exists community_flags_status_idx on public.community_message_flags(status, created_at desc);
alter table public.community_message_flags enable row level security;
drop policy if exists "chat flags own or admin read" on public.community_message_flags;
create policy "chat flags own or admin read" on public.community_message_flags for select to authenticated using (reporter_id = auth.uid() or public.is_janwatch_moderator());
drop policy if exists "chat flags own insert" on public.community_message_flags;
create policy "chat flags own insert" on public.community_message_flags for insert to authenticated with check (
 reporter_id = auth.uid() and exists (select 1 from public.community_messages m where m.id = message_id and m.user_id <> auth.uid() and not m.is_hidden)
);
drop policy if exists "chat flags admin update" on public.community_message_flags;
create policy "chat flags admin update" on public.community_message_flags for update to authenticated using (public.is_janwatch_moderator()) with check (public.is_janwatch_moderator());

-- Rewards are an audited ledger. Client users may not write their own points.
create table if not exists public.reward_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default true,
  cash_redemption_enabled boolean not null default false,
  points_per_rupee numeric(12,2) not null default 100 check (points_per_rupee > 0 and points_per_rupee <= 100000000),
  min_withdrawal_points integer not null default 10000 check (min_withdrawal_points > 0),
  enabled_payout_methods text[] not null default array['UPI']::text[],
  auto_reward_on_verified boolean not null default true,
  points_for_verified_report integer not null default 25 check (points_for_verified_report between 0 and 100000),
  auto_reward_on_resolved boolean not null default true,
  points_for_resolved_report integer not null default 75 check (points_for_resolved_report between 0 and 100000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.reward_settings add column if not exists cash_redemption_enabled boolean not null default false;
alter table public.reward_settings add column if not exists enabled_payout_methods text[] not null default array['UPI']::text[];
alter table public.reward_settings add column if not exists auto_reward_on_verified boolean not null default true;
alter table public.reward_settings add column if not exists points_for_verified_report integer not null default 25 check (points_for_verified_report between 0 and 100000);
alter table public.reward_settings add column if not exists auto_reward_on_resolved boolean not null default true;
alter table public.reward_settings add column if not exists points_for_resolved_report integer not null default 75 check (points_for_resolved_report between 0 and 100000);
insert into public.reward_settings(id, enabled, cash_redemption_enabled, points_per_rupee, min_withdrawal_points, auto_reward_on_verified, points_for_verified_report, auto_reward_on_resolved, points_for_resolved_report)
values (true, true, false, 100, 10000, true, 25, true, 75) on conflict (id) do nothing;
alter table public.reward_settings enable row level security;
drop policy if exists "reward settings public read" on public.reward_settings;
create policy "reward settings public read" on public.reward_settings for select to anon, authenticated using (true);
drop policy if exists "reward settings admin update" on public.reward_settings;
create policy "reward settings admin update" on public.reward_settings for update to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());

create table if not exists public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  delta_points integer not null check (delta_points <> 0 and delta_points between -10000000 and 10000000),
  reason text not null check (char_length(btrim(reason)) between 3 and 400),
  source_report_id uuid references public.reports(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists reward_ledger_user_idx on public.reward_ledger(user_id, created_at desc);
alter table public.reward_ledger enable row level security;
drop policy if exists "reward ledger owner or admin read" on public.reward_ledger;
create policy "reward ledger owner or admin read" on public.reward_ledger for select to authenticated using (user_id = auth.uid() or public.is_janwatch_admin());
drop policy if exists "reward ledger admin append" on public.reward_ledger;
create policy "reward ledger admin append" on public.reward_ledger for insert to authenticated with check (public.is_janwatch_admin() and created_by = auth.uid() and exists (select 1 from public.reward_settings rs where rs.id = true and rs.enabled) and exists (select 1 from public.app_feature_flags f where f.flag_key = 'rewards' and f.enabled));
-- Ledger rows are append-only; no authenticated UPDATE or DELETE policy is created.

create table if not exists public.reward_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  points_requested integer not null check (points_requested > 0),
  amount_inr numeric(14,2) not null check (amount_inr > 0),
  payout_method text not null check (payout_method in ('UPI')),
  payout_destination text not null check (char_length(btrim(payout_destination)) between 5 and 120),
  status text not null default 'pending' check (status in ('pending','approved','paid','rejected')),
  admin_note text,
  payout_reference text,
  processed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists reward_withdrawals_user_idx on public.reward_withdrawals(user_id, created_at desc);
create index if not exists reward_withdrawals_status_idx on public.reward_withdrawals(status, created_at desc);
alter table public.reward_withdrawals enable row level security;
drop policy if exists "withdrawals owner or admin read" on public.reward_withdrawals;
create policy "withdrawals owner or admin read" on public.reward_withdrawals for select to authenticated using (user_id = auth.uid() or public.is_janwatch_admin());
drop policy if exists "withdrawals admin update" on public.reward_withdrawals;
create policy "withdrawals admin update" on public.reward_withdrawals for update to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
-- No direct user INSERT: withdrawals must go through the balance-checking RPC below.

-- Return the complete user's current point balance without relying on the UI's
-- paginated ledger history. The function never accepts a caller-supplied user ID.
create or replace function public.janwatch_reward_balance()
returns table(earned_points bigint, reserved_points bigint, available_points bigint)
language plpgsql stable security definer set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  return query
    with earned as (
      select coalesce(sum(l.delta_points),0)::bigint as points
      from public.reward_ledger l where l.user_id = v_user
    ), reserved as (
      select coalesce(sum(w.points_requested),0)::bigint as points
      from public.reward_withdrawals w where w.user_id = v_user and w.status in ('pending','approved','paid')
    )
    select earned.points, reserved.points, (earned.points - reserved.points)
    from earned cross join reserved;
end;
$$;
revoke all on function public.janwatch_reward_balance() from public, anon;
grant execute on function public.janwatch_reward_balance() to authenticated;


create or replace function public.janwatch_request_reward_withdrawal(p_points integer, p_method text, p_destination text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_enabled boolean;
  v_cash_enabled boolean;
  v_rate numeric(12,2);
  v_min integer;
  v_balance bigint;
  v_id uuid;
  v_destination text := btrim(coalesce(p_destination,''));
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  -- Serialise requests from the same account to prevent concurrent overdraws.
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  select enabled, cash_redemption_enabled, points_per_rupee, min_withdrawal_points into v_enabled, v_cash_enabled, v_rate, v_min from public.reward_settings where id = true;
  if coalesce(v_enabled,false) is not true then raise exception 'Rewards are currently disabled'; end if;
  if coalesce(v_cash_enabled,false) is not true then raise exception 'Cash redemptions are not enabled yet. Rewards points can still be earned, but payouts require an administrator to enable a funded redemption programme.'; end if;
  if not exists (select 1 from public.app_feature_flags where flag_key = 'rewards' and enabled) then raise exception 'Reward feature is disabled'; end if;
  if p_method <> 'UPI' then raise exception 'Only UPI payout requests are currently supported'; end if;
  if v_destination !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z0-9._-]{2,}$' then raise exception 'Enter a valid UPI ID'; end if;
  if p_points is null or p_points < v_min then raise exception 'Requested points are below the minimum withdrawal threshold'; end if;
  select coalesce(sum(delta_points),0) into v_balance from public.reward_ledger where user_id = v_user;
  v_balance := v_balance - coalesce((select sum(points_requested) from public.reward_withdrawals where user_id = v_user and status in ('pending','approved','paid')),0);
  if p_points > v_balance then raise exception 'Insufficient available reward points'; end if;
  insert into public.reward_withdrawals(user_id,points_requested,amount_inr,payout_method,payout_destination)
  values (v_user,p_points,round(p_points / v_rate,2),'UPI',v_destination)
  returning id into v_id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values (v_user,'reward_withdrawal_requested','reward_withdrawal',v_id::text,jsonb_build_object('points',p_points));
  return v_id;
end;
$$;
revoke all on function public.janwatch_request_reward_withdrawal(integer,text,text) from public, anon;
grant execute on function public.janwatch_request_reward_withdrawal(integer,text,text) to authenticated;

create or replace function public.janwatch_admin_process_withdrawal(p_withdrawal_id uuid, p_action text, p_note text default null, p_reference text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_row public.reward_withdrawals%rowtype;
begin
  if not public.is_janwatch_admin() then raise exception 'Administrator permission required'; end if;
  select * into v_row from public.reward_withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'Withdrawal request not found'; end if;
  if p_action = 'approve' then
    if v_row.status <> 'pending' then raise exception 'Only pending requests can be approved'; end if;
    update public.reward_withdrawals set status='approved', admin_note=nullif(btrim(coalesce(p_note,'')),''), processed_by=auth.uid(), processed_at=now() where id=p_withdrawal_id;
  elsif p_action = 'reject' then
    if v_row.status not in ('pending','approved') then raise exception 'This request can no longer be rejected'; end if;
    update public.reward_withdrawals set status='rejected', admin_note=nullif(btrim(coalesce(p_note,'')),''), processed_by=auth.uid(), processed_at=now() where id=p_withdrawal_id;
  elsif p_action = 'paid' then
    if v_row.status <> 'approved' then raise exception 'Only approved requests can be marked paid'; end if;
    if length(btrim(coalesce(p_reference,''))) < 4 then raise exception 'A real external transaction reference is required'; end if;
    update public.reward_withdrawals set status='paid', payout_reference=btrim(p_reference), admin_note=nullif(btrim(coalesce(p_note,'')),''), processed_by=auth.uid(), processed_at=now() where id=p_withdrawal_id;
  else
    raise exception 'Unsupported withdrawal action';
  end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values (auth.uid(),'reward_withdrawal_'||p_action,'reward_withdrawal',p_withdrawal_id::text,jsonb_build_object('previous_status',v_row.status,'points',v_row.points_requested,'reference',case when p_action='paid' then p_reference else null end));
end;
$$;
revoke all on function public.janwatch_admin_process_withdrawal(uuid,text,text,text) from public, anon;
grant execute on function public.janwatch_admin_process_withdrawal(uuid,text,text,text) to authenticated;

create or replace function public.janwatch_admin_set_role(p_target_user_id uuid, p_target_role text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_current text; v_super_count integer;
begin
  if not public.is_janwatch_super_admin() then raise exception 'Super administrator permission required'; end if;
  if p_target_user_id = auth.uid() then raise exception 'You cannot change your own administrator role'; end if;
  if p_target_role is not null and p_target_role not in ('moderator','admin','super_admin') then raise exception 'Unsupported role'; end if;
  select role into v_current from public.user_roles where user_id=p_target_user_id;
  if v_current = 'super_admin' and coalesce(p_target_role,'citizen') <> 'super_admin' then
    select count(*) into v_super_count from public.user_roles where role='super_admin';
    if v_super_count <= 1 then raise exception 'Cannot remove the last super administrator'; end if;
  end if;
  if p_target_role is null or p_target_role = 'citizen' then
    delete from public.user_roles where user_id=p_target_user_id;
  else
    insert into public.user_roles(user_id,role,assigned_by) values (p_target_user_id,p_target_role,auth.uid())
    on conflict (user_id) do update set role=excluded.role, assigned_by=auth.uid();
  end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values (auth.uid(),'user_role_changed','user',p_target_user_id::text,jsonb_build_object('old_role',coalesce(v_current,'citizen'),'new_role',coalesce(p_target_role,'citizen')));
end;
$$;
revoke all on function public.janwatch_admin_set_role(uuid,text) from public, anon;
grant execute on function public.janwatch_admin_set_role(uuid,text) to authenticated;

-- Auto-award a modest, idempotent points grant only after an authorised reviewer
-- changes a PUBLIC report to a reviewed milestone. This is not independent verification.
create unique index if not exists reward_ledger_unique_auto_report_milestone_idx
  on public.reward_ledger(user_id, source_report_id, reason)
  where source_report_id is not null and reason like 'Automatic report milestone:%';

create or replace function public.janwatch_award_report_milestone()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_enabled boolean;
  v_verified_enabled boolean;
  v_resolved_enabled boolean;
  v_verified_points integer;
  v_resolved_points integer;
  v_points integer := 0;
  v_label text;
begin
  if old.status is not distinct from new.status or new.visibility <> 'public' then return new; end if;
  select enabled, auto_reward_on_verified, points_for_verified_report,
         auto_reward_on_resolved, points_for_resolved_report
    into v_enabled, v_verified_enabled, v_verified_points,
         v_resolved_enabled, v_resolved_points
    from public.reward_settings where id = true;
  if coalesce(v_enabled,false) is not true then return new; end if;
  if not exists (select 1 from public.app_feature_flags f where f.flag_key = 'rewards' and f.enabled) then return new; end if;
  if new.status = 'verified' and coalesce(v_verified_enabled,false) then
    v_points := greatest(0, coalesce(v_verified_points,0));
    v_label := 'verified';
  elsif new.status = 'resolved' and coalesce(v_resolved_enabled,false) then
    v_points := greatest(0, coalesce(v_resolved_points,0));
    v_label := 'resolved';
  else
    return new;
  end if;
  if v_points > 0 then
    insert into public.reward_ledger(user_id, delta_points, reason, source_report_id, created_by)
    values (new.reporter_id, v_points, 'Automatic report milestone: ' || v_label, new.id, null)
    on conflict do nothing;
    if found then
      insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
      values (auth.uid(), 'reward_points_automatically_granted', 'report', new.id::text,
              jsonb_build_object('user_id',new.reporter_id,'points',v_points,'milestone',v_label));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists janwatch_report_reward_milestone on public.reports;
create trigger janwatch_report_reward_milestone
  after update of status on public.reports
  for each row execute function public.janwatch_award_report_milestone();

-- Audit reward-program config without recording payout destinations or other personal data.
create or replace function public.janwatch_log_reward_settings_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'reward_settings_changed', 'reward_settings', 'true',
    jsonb_build_object(
      'enabled', new.enabled,
      'cash_redemption_enabled', new.cash_redemption_enabled,
      'enabled_payout_methods', new.enabled_payout_methods,
      'points_per_rupee', new.points_per_rupee,
      'min_withdrawal_points', new.min_withdrawal_points,
      'auto_reward_on_verified', new.auto_reward_on_verified,
      'points_for_verified_report', new.points_for_verified_report,
      'auto_reward_on_resolved', new.auto_reward_on_resolved,
      'points_for_resolved_report', new.points_for_resolved_report
    ));
  return new;
end;
$$;
drop trigger if exists janwatch_reward_settings_audit on public.reward_settings;
create trigger janwatch_reward_settings_audit after update on public.reward_settings
  for each row execute function public.janwatch_log_reward_settings_change();

-- Ensure feature switches are enforced server-side for high-risk operations.
drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports for insert to authenticated with check (
 reporter_id = auth.uid() and exists (select 1 from public.app_feature_flags where flag_key='reporting' and enabled)
);
drop policy if exists "votes insert own" on public.report_votes;
create policy "votes insert own" on public.report_votes for insert to authenticated with check (
 user_id = auth.uid() and exists (select 1 from public.app_feature_flags where flag_key='community_support' and enabled)
 and exists (select 1 from public.reports r where r.id = report_id and r.visibility = 'public')
);

-- Feature flag controls private evidence uploads as well as the UI.
drop policy if exists "evidence upload own folder" on storage.objects;
create policy "evidence upload own folder" on storage.objects for insert to authenticated with check (
 bucket_id='citizen-evidence' and (storage.foldername(name))[1]=auth.uid()::text
 and exists (select 1 from public.app_feature_flags f where f.flag_key='evidence_upload' and f.enabled)
);

-- Auditable configuration changes.
create or replace function public.janwatch_log_platform_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_action text; v_target text; v_metadata jsonb;
begin
  if tg_table_name = 'app_feature_flags' then
    v_target := coalesce(new.flag_key, old.flag_key);
    v_action := case when tg_op='INSERT' then 'feature_flag_created' else 'feature_flag_changed' end;
    v_metadata := jsonb_build_object('enabled', case when tg_op='DELETE' then old.enabled else new.enabled end);
  else
    v_target := coalesce(new.id, old.id)::text;
    v_action := case when tg_op='INSERT' then 'site_announcement_created' when tg_op='DELETE' then 'site_announcement_deleted' else 'site_announcement_changed' end;
    v_metadata := jsonb_build_object('title', case when tg_op='DELETE' then old.title else new.title end, 'is_active', case when tg_op='DELETE' then false else new.is_active end);
  end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values (auth.uid(),v_action,tg_table_name,v_target,v_metadata);
  return case when tg_op='DELETE' then old else new end;
end;
$$;
drop trigger if exists janwatch_feature_flag_audit on public.app_feature_flags;
create trigger janwatch_feature_flag_audit after insert or update or delete on public.app_feature_flags for each row execute function public.janwatch_log_platform_change();
drop trigger if exists janwatch_announcement_audit on public.site_announcements;
create trigger janwatch_announcement_audit after insert or update or delete on public.site_announcements for each row execute function public.janwatch_log_platform_change();

-- Explicit API privileges for tables introduced by this migration. RLS above/below
-- remains the row-level permission boundary; grants alone do not expose protected rows.
grant select on public.app_feature_flags to anon, authenticated;
grant insert, update, delete on public.app_feature_flags to authenticated;
grant select on public.site_announcements to anon, authenticated;
grant insert, update, delete on public.site_announcements to authenticated;
grant select, insert, update, delete on public.community_messages to authenticated;
grant select, insert, update on public.community_message_flags to authenticated;
grant select on public.reward_settings to anon, authenticated;
grant update on public.reward_settings to authenticated;
grant select, insert on public.reward_ledger to authenticated;
grant select on public.reward_withdrawals to authenticated;
grant select on public.audit_logs to authenticated;

-- Enable realtime for features used by the frontend so updates propagate to other sessions.
-- The publication may be unavailable in restricted/self-hosted configurations; these blocks
-- safely skip if the publication does not exist or already contains a table.
do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['community_messages','community_message_flags','reward_ledger','reward_withdrawals','app_feature_flags','site_announcements'] loop
      if exists (select 1 from information_schema.tables where table_schema='public' and table_name=v_table)
        and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

-- Add the AI assistant to the same administrator-controlled feature switches.
alter table public.app_feature_flags drop constraint if exists app_feature_flags_flag_key_check;
alter table public.app_feature_flags add constraint app_feature_flags_flag_key_check
  check (flag_key in ('reporting','public_chat','rewards','civic_toolkit','evidence_upload','community_support','janwatch_ai'));
insert into public.app_feature_flags(flag_key, enabled, label, description) values
 ('janwatch_ai', true, 'LokPravaah AI assistant', 'Allow signed-in citizens to use the multi-provider AI assistant. Provider keys remain server-side.')
on conflict (flag_key) do nothing;
update public.app_feature_flags set label = 'LokPravaah AI assistant', description = 'Allow signed-in citizens to use the multi-provider AI assistant. Provider keys remain server-side.' where flag_key = 'janwatch_ai';
