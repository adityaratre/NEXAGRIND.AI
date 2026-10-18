# LokPravaah donation page setup

The public website now includes a Donate page at `/#donate`, plus a Donate item in the signed-in workspace. It accepts custom amounts from ₹1 to ₹1,00,000 (up to two decimal places), preset amounts, optional donor name/email, an anonymous option, and a short message.

## What was integrated

The supplied payment source is a separate Node.js system (API, checkout portal, database and payment-observer services), not a frontend package for a Vite/Cloudflare Pages bundle. LokPravaah loads the gateway's documented `/youpi.js` SDK from that separately deployed and authorised service. Its demo storefront and unrelated observer apps are not bundled into this website. Configure the payment service's white-label settings separately so any hosted checkout uses the LokPravaah identity.

## 1. Apply the donation migration

In the Supabase SQL Editor for the same project as LokPravaah, run the entire file:

`supabase/lokpravaah_donations.sql`

Run this after the existing platform migrations, including `v4_platform_migration.sql` (which defines `public.is_janwatch_admin()`). The migration is safe to re-run. It creates `public.donation_intents` and applies row-level security:

- Visitors can create **pending** donation intents only.
- Public clients cannot read, update or delete donation rows.
- Admins can read donation intents from an authorised session.
- A browser cannot mark a donation as successful.

## 2. Configure the public website environment

Set these values in the hosting project's environment settings and redeploy:

- `VITE_DONATION_GATEWAY_PORTAL_URL`: public HTTPS URL serving the gateway's `/youpi.js` and checkout pages.
- `VITE_DONATION_GATEWAY_API_URL`: public API base URL exposing `POST /api/v1/payments`. It may be the same URL if the gateway reverse-proxies the API.
- `VITE_DONATION_MERCHANT_KEY`: the gateway merchant identifier expected in `X-Merchant-Id`. This is intentionally a public browser setting, not a private secret.

The gateway must be separately deployed, configured for the merchant, accessible over HTTPS, and allow requests from the LokPravaah site origin. Do not put `SUPABASE_SERVICE_ROLE_KEY`, a webhook signing secret, bank credentials, email OAuth tokens or any private gateway secret in a `VITE_` variable.

The donation button stays disabled until the gateway and Supabase client are configured. This is intentional: it avoids pretending that real payments can be accepted when configuration is incomplete.

## 3. Configure server-side payment verification

Deploy the Supabase Edge Function `donation-webhook` from `supabase/functions/donation-webhook/index.ts`.

In Supabase Dashboard → Edge Functions → Secrets, set:

- `DONATION_WEBHOOK_SECRET`: the exact webhook HMAC secret configured for the merchant on the gateway.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` should be available to Supabase Edge Functions in the environment. If your project does not expose them automatically, configure them as Edge Function secrets. Keep the service-role key private.

Set the payment gateway's merchant webhook destination to:

`https://YOUR_SUPABASE_PROJECT_REF.supabase.co/functions/v1/donation-webhook`

It must send the signed JSON webhook headers described by the gateway documentation, especially `X-Gateway-Signature: sha256=<hex HMAC-SHA256 of the exact raw request body>`. The endpoint verifies that signature before parsing or updating a row, matches the order ID and exact INR amount against the pending donation intent, and only then updates status. Duplicate successful deliveries are handled idempotently.

## 4. Test before launch

1. Use a separate test merchant or smallest practical amount first.
2. Confirm the intent appears as `pending` in `public.donation_intents` before checkout opens.
3. Test success, failure, cancellation and expiry callbacks.
4. Send a real signed webhook test and confirm only the matching intent changes to `succeeded` with `verified_at` and the UTR/payment ID where available.
5. Send a request with an invalid signature and confirm it receives HTTP 401 and changes no row.
6. Verify the admin read policy only permits authorised admin accounts to inspect donor details.
7. If checkout displays gateway branding, configure the gateway's own white-label title/logo/theme rather than editing or stripping its internal source notices.

## Operational notes

- Frontend checkout events are for user feedback only. They are **not** payment proof; the server webhook is authoritative.
- Amounts are stored as integer paise to avoid floating-point rounding.
- The database stores pending intents and donor details (if supplied) privately. Do not make the table publicly readable or expose raw donor records to analytics.
- This page makes no promise of tax deductibility or government affiliation. Before soliciting public or foreign contributions, verify applicable Indian legal, tax, banking and payment-provider requirements for your project and intended use.
