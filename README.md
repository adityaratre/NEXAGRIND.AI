# LokPravaah

A React + Vite civic reporting platform backed by Supabase.

## Apply the update to the existing Supabase project

1. Open **Supabase → SQL Editor** for the same project used by this app.
2. Open `supabase/lokpravaah_final_worker_blog_patch.sql` and run the **entire file** once. It is designed to be re-runnable and adds the missing Blog & Updates table, worker role/permissions, direct worker assignment support, task workflow, private evidence upload references, and referral features.
3. Wait for the query to finish successfully. The script requests a PostgREST schema-cache reload at the end.
4. In **Project Settings → API**, verify the `public` schema is exposed to the Data API if the table still reports `PGRST205`. Then refresh the app or sign out/in.
5. Deploy the updated source to the same hosting project.

Do not run `schema.sql` or `v4_platform_migration.sql` on an already-running project just to fix the missing `site_posts` table. Those are baseline/foundation migrations for a fresh installation.

## Fresh database setup

For a new Supabase project, run in order:

1. `supabase/schema.sql`
2. `supabase/v4_platform_migration.sql`
3. `supabase/lokpravaah_ai_giftcard_repair.sql`
4. `supabase/lokpravaah_final_worker_blog_patch.sql`
5. `supabase/lokpravaah_donations.sql`

Review the SQL output after each step. Keep the Supabase service-role key on the server only; never put it in `.env` variables exposed to the browser.

## Environment

Set the public client values in `.env` using `.env.example`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

AI provider secrets belong in Supabase Edge Function secrets, not client-side variables.

## Worker workflow included

- Workers can apply and wait for admin approval, or a super administrator can directly assign the **Worker** role from Admin → User role management.
- Direct assignment creates an active worker profile. Worker role never grants administrator permissions.
- Admins can assign eligible public reports to approved workers and review submitted work.
- Workers can accept tasks, start work, open a Google Maps route to the report address, and submit notes plus up to five private photo/video files or HTTPS evidence links (50 MB per file).
- Uploaded files are stored in the private `citizen-evidence` bucket. The app creates short-lived signed links when evidence is viewed.
- Blog & Updates uses `public.site_posts`; only super administrators can create, publish, edit, or delete posts.

## Validation notes

The source changes were inspected and TypeScript/TSX syntax is checked separately. A full dependency-backed production build and live Supabase deployment cannot be claimed from this package alone; run your normal deployment/build after applying the migration.


## Voluntary donations

The Donate page uses a configurable, separately deployed UPI checkout integration. See [`docs/DONATIONS_SETUP.md`](docs/DONATIONS_SETUP.md) for the required Supabase migration, public gateway environment variables, signed webhook setup and production verification checklist. The site does not treat client-side checkout events as proof of payment.
