-- JANWATCH initial schema draft. Review and apply only after configuring Supabase Auth.
-- RLS is enabled by default below. No public write policies are added intentionally.
create extension if not exists pgcrypto;

create type public.report_status as enum ('submitted','under_review','verified','in_progress','resolved','rejected');
create type public.report_visibility as enum ('public','private');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  preferred_language text not null default 'en' check (preferred_language in ('en','hi')),
  impact_points integer not null default 0 check (impact_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  public_code text unique not null default ('JW-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 5 and 160),
  description text not null default '' check (char_length(description) <= 5000),
  category text not null,
  status public.report_status not null default 'submitted',
  visibility public.report_visibility not null default 'public',
  address_label text,
  latitude double precision,
  longitude double precision,
  evidence_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint reports_longitude_range check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.report_votes (
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id,user_id)
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'citizen' check (role in ('citizen','moderator','admin','super_admin')),
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx on public.reports(created_at desc);
create index if not exists reports_status_idx on public.reports(status);
create index if not exists reports_reporter_idx on public.reports(reporter_id);
create index if not exists report_events_report_idx on public.report_events(report_id,created_at);

alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.report_events enable row level security;
alter table public.report_votes enable row level security;
alter table public.user_roles enable row level security;
alter table public.departments enable row level security;
alter table public.audit_logs enable row level security;

-- Important: policies are intentionally not opened to public here.
-- Add and test least-privilege policies before using real citizen data.
-- AI provider secrets must remain in Edge Function secrets / trusted backend env vars.

-- JANWATCH MVP security policies (apply in Supabase SQL Editor after reviewing).
-- Helper checks use SECURITY DEFINER to avoid recursive RLS on user_roles.
create or replace function public.is_janwatch_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin','super_admin')) $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created_janwatch on auth.users;
create trigger on_auth_user_created_janwatch after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Idempotent least-privilege policies.
drop policy if exists "profiles read own or admin" on public.profiles;
create policy "profiles read own or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_janwatch_admin());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "reports read public or own" on public.reports;
create policy "reports read public or own" on public.reports for select to anon, authenticated using (visibility = 'public' or reporter_id = auth.uid() or public.is_janwatch_admin());
drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "reports update own or admin" on public.reports;
drop policy if exists "reports update admin only" on public.reports;
create policy "reports update admin only" on public.reports for update to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists "events read visible reports" on public.report_events;
create policy "events read visible reports" on public.report_events for select to authenticated using (exists (select 1 from public.reports r where r.id = report_id and (r.visibility = 'public' or r.reporter_id = auth.uid() or public.is_janwatch_admin())));
drop policy if exists "events insert admin only" on public.report_events;
create policy "events insert admin only" on public.report_events for insert to authenticated with check (public.is_janwatch_admin() and (actor_id is null or actor_id = auth.uid()));
drop policy if exists "votes read authenticated" on public.report_votes;
create policy "votes read authenticated" on public.report_votes for select to authenticated using (true);
drop policy if exists "votes insert own" on public.report_votes;
create policy "votes insert own" on public.report_votes for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.reports r where r.id = report_id and r.visibility = 'public'));
drop policy if exists "votes delete own or admin" on public.report_votes;
create policy "votes delete own or admin" on public.report_votes for delete to authenticated using (user_id = auth.uid() or public.is_janwatch_admin());
drop policy if exists "roles read self or admin" on public.user_roles;
create policy "roles read self or admin" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_janwatch_admin());
drop policy if exists "departments read active" on public.departments;
create policy "departments read active" on public.departments for select to authenticated using (active or public.is_janwatch_admin());
drop policy if exists "departments manage admin" on public.departments;
create policy "departments manage admin" on public.departments for all to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists "audit read admin" on public.audit_logs;
create policy "audit read admin" on public.audit_logs for select to authenticated using (public.is_janwatch_admin());

-- Private evidence bucket. Upload paths must start with the authenticated user's UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('citizen-evidence','citizen-evidence',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict (id) do update set public = false, file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm'];
drop policy if exists "evidence upload own folder" on storage.objects;
create policy "evidence upload own folder" on storage.objects for insert to authenticated with check (bucket_id = 'citizen-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "evidence read own or admin" on storage.objects;
create policy "evidence read own or admin" on storage.objects for select to authenticated using (bucket_id = 'citizen-evidence' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_janwatch_admin()));
drop policy if exists "evidence delete own or admin" on storage.objects;
create policy "evidence delete own or admin" on storage.objects for delete to authenticated using (bucket_id = 'citizen-evidence' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_janwatch_admin()));
