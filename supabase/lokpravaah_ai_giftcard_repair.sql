-- LokPravaah AI + configurable gift-card withdrawal repair.
-- Run once in Supabase SQL Editor against the existing V4 LokPravaah database.
-- Safe to re-run. Gift card codes are shown only to the requesting user and administrators;
-- no email/SMS delivery is attempted by this migration.

-- IMPORTANT: create the missing relation FIRST. Run this entire file (Ctrl+A, then Run); do not execute only the final verification SELECT.

-- 1) Admin-managed gift-card brands (created first) and per-brand rupee limits.
create table if not exists public.reward_gift_card_options (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (char_length(btrim(brand)) between 2 and 80),
  min_amount_inr numeric(12,2) not null default 100 check (min_amount_inr > 0),
  max_amount_inr numeric(12,2) not null default 1000 check (max_amount_inr >= min_amount_inr),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists reward_gift_card_options_brand_unique on public.reward_gift_card_options (lower(brand));
alter table public.reward_gift_card_options enable row level security;
drop policy if exists "gift card options active read" on public.reward_gift_card_options;
create policy "gift card options active read" on public.reward_gift_card_options
  for select to anon, authenticated using (active or public.is_janwatch_admin());
drop policy if exists "gift card options admin insert" on public.reward_gift_card_options;
create policy "gift card options admin insert" on public.reward_gift_card_options
  for insert to authenticated with check (public.is_janwatch_admin() and (created_by is null or created_by = auth.uid()));
drop policy if exists "gift card options admin update" on public.reward_gift_card_options;
create policy "gift card options admin update" on public.reward_gift_card_options
  for update to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists "gift card options admin delete" on public.reward_gift_card_options;
create policy "gift card options admin delete" on public.reward_gift_card_options
  for delete to authenticated using (public.is_janwatch_admin());

insert into public.reward_gift_card_options (brand, min_amount_inr, max_amount_inr, active)
values ('Amazon',100,5000,true), ('Google Play',100,5000,true), ('Croma',100,5000,true), ('PVR',100,5000,true)
on conflict do nothing;

-- Explicit grants: RLS policies still decide which rows a caller may access.
grant select on public.reward_gift_card_options to anon, authenticated;
grant insert, update, delete on public.reward_gift_card_options to authenticated;


-- 2) Global withdrawal cap.
alter table public.reward_settings
  add column if not exists max_withdrawal_points integer not null default 1000000;
update public.reward_settings set max_withdrawal_points = greatest(min_withdrawal_points, 1000000)
where id = true and (max_withdrawal_points is null or max_withdrawal_points < min_withdrawal_points);
alter table public.reward_settings drop constraint if exists reward_settings_max_withdrawal_points_check;
alter table public.reward_settings add constraint reward_settings_max_withdrawal_points_check
  check (max_withdrawal_points > 0 and max_withdrawal_points >= min_withdrawal_points);

-- 3) Keep selected brand and assigned code on the withdrawal row. Existing RLS keeps
-- these fields readable only by the owner or authorised administrators.
alter table public.reward_withdrawals add column if not exists gift_card_brand text;
alter table public.reward_withdrawals add column if not exists gift_card_code text;
-- Ensure legacy databases have the payout-method array before referencing it.
alter table public.reward_settings
  add column if not exists enabled_payout_methods text[] not null default array['UPI']::text[];

-- Normalize legacy settings before applying the supported-method constraint.
update public.reward_settings rs
set enabled_payout_methods = coalesce((
  select array_agg(distinct u.method order by u.method)
  from unnest(coalesce(rs.enabled_payout_methods, array[]::text[])) as u(method)
  where u.method = any(array['UPI','Bank transfer','Gift card']::text[])
), array['UPI']::text[]);

alter table public.reward_settings drop constraint if exists reward_settings_enabled_payout_methods_check;
alter table public.reward_settings add constraint reward_settings_enabled_payout_methods_check
  check (enabled_payout_methods <@ array['UPI','Bank transfer','Gift card']::text[]);

alter table public.reward_withdrawals drop constraint if exists reward_withdrawals_payout_method_check;
alter table public.reward_withdrawals add constraint reward_withdrawals_payout_method_check
  check (payout_method in ('UPI','Bank transfer','Gift card'));

-- 4) Replace request RPC with server-enforced global and per-brand limits.
drop function if exists public.janwatch_request_reward_withdrawal(integer,text,text);
create or replace function public.janwatch_request_reward_withdrawal(
  p_points integer,
  p_method text,
  p_destination text,
  p_gift_card_brand text default null
)
returns uuid language plpgsql security definer set search_path = public
as $request_fn$
declare
  v_user uuid := auth.uid();
  v_enabled boolean;
  v_cash_enabled boolean;
  v_rate numeric(12,2);
  v_min integer;
  v_max integer;
  v_methods text[];
  v_balance bigint;
  v_id uuid;
  v_destination text := btrim(coalesce(p_destination,''));
  v_method text := btrim(coalesce(p_method,''));
  v_brand text := nullif(btrim(coalesce(p_gift_card_brand,'')),'');
  v_amount numeric(14,2);
  v_card_min numeric(12,2);
  v_card_max numeric(12,2);
begin
  if v_user is null then raise exception 'Sign in is required'; end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  select enabled, cash_redemption_enabled, points_per_rupee, min_withdrawal_points,
         max_withdrawal_points, enabled_payout_methods
    into v_enabled, v_cash_enabled, v_rate, v_min, v_max, v_methods
    from public.reward_settings where id = true;
  if coalesce(v_enabled,false) is not true then raise exception 'Rewards are currently disabled'; end if;
  if coalesce(v_cash_enabled,false) is not true then raise exception 'Withdrawals are not enabled yet'; end if;
  if not exists (select 1 from public.app_feature_flags where flag_key = 'rewards' and enabled) then raise exception 'Reward feature is disabled'; end if;
  if v_method not in ('UPI','Bank transfer','Gift card') or not (v_method = any(coalesce(v_methods,array['UPI']::text[]))) then
    raise exception 'This payout method is not currently available';
  end if;
  if p_points is null or p_points < v_min or p_points > v_max then
    raise exception 'Requested points must be within the configured minimum and maximum';
  end if;
  if char_length(v_destination) < 5 or char_length(v_destination) > 120 then raise exception 'Payout details are incomplete'; end if;
  if v_method = 'UPI' and v_destination !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z0-9._-]{2,}$' then
    raise exception 'Enter a valid UPI ID';
  elsif v_method = 'Bank transfer' and v_destination !~* '^Name: [^;]{2,50}; Account: [0-9]{8,18}; IFSC: [A-Z]{4}0[A-Z0-9]{6}$' then
    raise exception 'Enter a valid account name, account number and IFSC code';
  elsif v_method = 'Gift card' then
    if v_destination <> 'IN_APP' then raise exception 'Gift card codes are delivered in the LokPravaah withdrawal section'; end if;
    if v_brand is null then raise exception 'Choose a gift card brand'; end if;
    select min_amount_inr, max_amount_inr into v_card_min, v_card_max
      from public.reward_gift_card_options where lower(brand)=lower(v_brand) and active for share;
    if not found then raise exception 'This gift card is not currently available'; end if;
    v_amount := round(p_points / v_rate, 2);
    if v_amount < v_card_min or v_amount > v_card_max then
      raise exception 'Gift card amount must be between INR % and INR %', v_card_min, v_card_max;
    end if;
  end if;
  select coalesce(sum(delta_points),0) into v_balance from public.reward_ledger where user_id = v_user;
  v_balance := v_balance - coalesce((select sum(points_requested) from public.reward_withdrawals where user_id = v_user and status in ('pending','approved','paid')),0);
  if p_points > v_balance then raise exception 'Insufficient available reward points'; end if;
  insert into public.reward_withdrawals(user_id,points_requested,amount_inr,payout_method,payout_destination,gift_card_brand)
    values (v_user,p_points,round(p_points / v_rate,2),v_method,v_destination,case when v_method='Gift card' then v_brand else null end)
    returning id into v_id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values (v_user,'reward_withdrawal_requested','reward_withdrawal',v_id::text,jsonb_build_object('points',p_points,'method',v_method,'gift_card_brand',case when v_method='Gift card' then v_brand else null end));
  return v_id;
end;
$request_fn$;
revoke all on function public.janwatch_request_reward_withdrawal(integer,text,text,text) from public, anon;
grant execute on function public.janwatch_request_reward_withdrawal(integer,text,text,text) to authenticated;

-- 5) Secure code delivery: only an admin can assign a code to an approved gift-card request.
-- The code itself is deliberately excluded from audit metadata.
create or replace function public.janwatch_admin_deliver_gift_card(p_withdrawal_id uuid, p_code text, p_note text default null)
returns void language plpgsql security definer set search_path = public
as $deliver_fn$
declare v_row public.reward_withdrawals%rowtype; v_code text := btrim(coalesce(p_code,''));
begin
  if not public.is_janwatch_admin() then raise exception 'Administrator permission required'; end if;
  if char_length(v_code) < 4 or char_length(v_code) > 250 then raise exception 'Enter a valid gift card code'; end if;
  select * into v_row from public.reward_withdrawals where id=p_withdrawal_id for update;
  if not found then raise exception 'Withdrawal request not found'; end if;
  if v_row.payout_method <> 'Gift card' then raise exception 'This is not a gift-card request'; end if;
  if v_row.status <> 'approved' then raise exception 'Only approved gift-card requests can receive a code'; end if;
  update public.reward_withdrawals set gift_card_code=v_code, status='paid',
    admin_note=nullif(btrim(coalesce(p_note,'')),''), processed_by=auth.uid(), processed_at=now()
    where id=p_withdrawal_id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values (auth.uid(),'reward_gift_card_delivered','reward_withdrawal',p_withdrawal_id::text,
      jsonb_build_object('previous_status',v_row.status,'brand',v_row.gift_card_brand,'points',v_row.points_requested,'delivery','in-app withdrawal history'));
end;
$deliver_fn$;
revoke all on function public.janwatch_admin_deliver_gift_card(uuid,text,text) from public, anon;
grant execute on function public.janwatch_admin_deliver_gift_card(uuid,text,text) to authenticated;

-- End: verify current configuration and available brands.
select id, enabled, cash_redemption_enabled, points_per_rupee, min_withdrawal_points, max_withdrawal_points, enabled_payout_methods
from public.reward_settings where id=true;
select brand, min_amount_inr, max_amount_inr, active from public.reward_gift_card_options order by brand;


-- Ask Supabase PostgREST to refresh its schema cache after the new table is added.
notify pgrst, 'reload schema';
