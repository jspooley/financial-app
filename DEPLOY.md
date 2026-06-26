# Deployment Guide

Step-by-step instructions to deploy the Maison Joy Financial Manager for free.

## Part 1: Supabase (Database + Auth)

1. Go to [https://supabase.com](https://supabase.com) and sign up (free).
2. Click **New Project**, choose a name and password, and wait for the project to provision.
3. Open **SQL Editor** → **New query** and run all migrations in `supabase/migrations/` (in order).
4. Open **Authentication** → **Users** → **Add user** → **Create new user**.
   - Create one account for Jess (e.g. `jess@yourbusiness.com`)
   - Create one account for Molly (e.g. `molly@yourbusiness.com`)
   - Set passwords and check **Auto Confirm User** so they can sign in immediately.
5. Open **Project Settings** → **API** (or **Connect**) and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key **or** **publishable** key → see environment variables below

## Part 2: Vercel (Web App Hosting)

1. Push this project to GitHub (`jspooley/financial-app`).
2. Go to [https://vercel.com](https://vercel.com) and sign up with GitHub (free).
3. Click **Add New** → **Project** → import your `financial-app` repository.
4. Under **Environment Variables**, add the **same names and values** as your local `.env.local`.

### Required environment variables

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` |

Plus **one** of these key variables (use the name that matches your `.env.local`):

| Name | When to use |
|------|-------------|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy **anon public** key (`eyJ...`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | New **publishable** key (`sb_publishable_...`) |

**Important:** Variable names are case-sensitive. Copy from `.env.local` exactly — do not rename `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `NEXT_PUBLIC_SUPABASE_ANON_KEY` unless you also change the value to the anon key.

5. For each variable, check **Production** (and **Preview** if you use preview URLs).
6. Click **Deploy**. Wait ~2 minutes for the build to finish.
7. Copy your live URL (e.g. `https://financial-app-xyz.vercel.app`).

### After the first deploy

1. Open `https://YOUR-VERCEL-URL/api/health` in your browser.
2. You should see JSON like:

```json
{
  "ok": true,
  "supabase": { "urlConfigured": true, "keyConfigured": true },
  "envSources": { ... }
}
```

- If `"ok": false`, one or both Supabase variables are missing on Vercel. Fix them and **redeploy**.
- If `"ok": true` but the main site still errors, go to **Deployments** → **Redeploy** (with cache cleared).

## Part 3: Supabase auth URLs (required for live login)

In **Supabase** → **Authentication** → **URL Configuration**:

| Field | Value |
|-------|-------|
| **Site URL** | `https://YOUR-VERCEL-URL.vercel.app` |
| **Redirect URLs** | `https://YOUR-VERCEL-URL.vercel.app/**` |

Save, then try signing in on the live site.

## Part 4: Partner Onboarding

1. Send your partner:
   - The Vercel app URL
   - Their login email and password (from Supabase)
2. Both of you bookmark the URL on laptop, tablet, and phone.
3. Sign in from any device — you share the same data.

## Local Development

```bash
cp .env.example .env.local
# Edit .env.local with your Supabase URL and key
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `500 MIDDLEWARE_INVOCATION_FAILED` | Env vars missing or wrong on Vercel. Check `/api/health`, fix variables, then **Redeploy**. |
| `"ok": false` on `/api/health` | Add `NEXT_PUBLIC_SUPABASE_URL` and your key variable. Enable **Production**. Redeploy. |
| Env vars set but still failing | **Deployments** → **⋯** → **Redeploy** → check **Clear build cache**. |
| Local works, Vercel does not | Compare Vercel variable **names** to `.env.local` exactly (publishable vs anon key name). |
| "Invalid API key" on login | Key value does not match Supabase project. Re-copy from **Project Settings → API**. |
| Login page loads but sign-in fails | Update Supabase **Site URL** and **Redirect URLs** to your Vercel URL. |
| Build fails on Vercel | Ensure both `NEXT_PUBLIC_SUPABASE_URL` and a key variable are set before deploying. |

### Optional runtime fallbacks (Vercel)

If middleware still cannot read `NEXT_PUBLIC_*` variables, you can also set (same values):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The app checks these as fallbacks in `src/lib/supabase/env.ts`.
