-- LokPravaah voluntary donations (run after the platform migrations).
-- Public visitors may create pending intents only. Only the signed server webhook marks a donation successful.

create table if not exists public.donation_intents (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique check (char_length(order_id) between 8 and 80),
  donor_user_id uuid references auth.users(id) on delete set null,
  amount_paise bigint not null check (amount_paise between 100 and 10000000),
  currency text not null default 'INR' check (currency = 'INR'),
  donor_name text check (donor_name is null or char_length(btrim(donor_name)) <= 80),
  donor_email text check (donor_email is null or char_length(btrim(donor_email)) <= 254),
  is_anonymous boolean not null default false,
  message text check (message is null or char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','suspicious','expired','cancelled')),
  gateway_payment_id text,
  utr text unique,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint donation_anonymous_pii_check check (not is_anonymous or (donor_name is null and donor_email is null)),
  constraint donation_verification_consistency_check check (
    (status <> 'succeeded' and verified_at is null) or (status = 'succeeded' and verified_at is not null)
  )
);

create index if not exists donation_intents_created_idx on public.donation_intents(created_at desc);
create index if not exists donation_intents_status_idx on public.donation_intents(status, created_at desc);
create index if not exists donation_intents_user_idx on public.donation_intents(donor_user_id, created_at desc) where donor_user_id is not null;

alter table public.donation_intents enable row level security;

drop policy if exists "donation create pending intent" on public.donation_intents;
create policy "donation create pending intent" on public.donation_intents
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and gateway_payment_id is null
    and utr is null
    and verified_at is null
    and currency = 'INR'
    and amount_paise between 100 and 10000000
    and (donor_user_id is null or donor_user_id = auth.uid())
    and (donor_name is null or char_length(btrim(donor_name)) <= 80)
    and (donor_email is null or char_length(btrim(donor_email)) <= 254)
    and (message is null or char_length(message) <= 300)
    and (not is_anonymous or (donor_name is null and donor_email is null))
  );

drop policy if exists "donation admins can review intents" on public.donation_intents;
create policy "donation admins can review intents" on public.donation_intents
  for select to authenticated
  using (public.is_janwatch_admin());

-- No public client updates/deletes. The webhook uses the service role after signature verification.
revoke all on public.donation_intents from anon, authenticated;
grant insert on public.donation_intents to anon, authenticated;
grant select on public.donation_intents to authenticated;
grant all on public.donation_intents to service_role;

notify pgrst, 'reload schema';
