# Gota d'Agua Platform Deploy

This package is the first real deployable version of the platform hub.

It includes:
- Hub with real Supabase login
- Sri Lanka Hub route
- Partners route connected to Supabase
- Instructors route
- Settings inside the Hub

## Current platform status

Already connected:
- Hub login and session
- workspace access loading from Supabase
- Partners data syncing to Supabase

Protected by session, but still local-state tools for now:
- Sri Lanka Hub
- Instructors

That means this version is good for:
- internal pilot
- real login
- real access control foundation
- Vercel deployment

It is not yet the final database-backed version of every workspace.

## Folder structure

- `public/platform-preview.html`
- `public/camp-hub-srilanka.html`
- `public/partners.html`
- `public/instructors.html`
- `public/supabase-config.js`
- `supabase/schema.sql`
- `vercel.json`

## Step 1: Supabase

In Supabase:

1. Create the project
2. Enable Email auth
3. Create the first user:
   - `miguel@gotadaguasurf.com`
4. Open `SQL Editor`
5. Run the file:
   - `supabase/schema.sql`

This schema:
- creates the core tables
- creates the partners tables
- creates the `upsert_partner_month_status` RPC
- seeds the main locations
- gives `miguel@gotadaguasurf.com` owner access

## Step 2: Supabase config file

Update:
- `public/supabase-config.js`

Set:
- `url`
- `anonKey`

Do not put the secret/service role key in the frontend.

## Step 3: Vercel

1. Push this folder to GitHub or upload it through Vercel
2. In Vercel create a new project
3. Use this folder as the project root
4. Deploy

Because `vercel.json` is already included, these routes should work:

- `/`
- `/camp-hub`
- `/partners`
- `/instructors`

## Step 4: First login test

After deploy:

1. Open the main URL
2. Log in with:
   - `miguel@gotadaguasurf.com`
3. Confirm:
   - Hub opens
   - Sri Lanka opens
   - Partners opens
   - Instructors opens
   - logo returns to Hub
   - logout works

## Important note

This is the right foundation version.

Next big improvements should be:
- move Sri Lanka Hub data fully into Supabase
- move Instructors into Supabase
- add real Team Access management in Settings
- connect Bookinglayer API/webhooks
- add more workspaces like Morocco and Portugal
