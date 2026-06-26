# Deployment Guide

Step-by-step instructions to deploy the Financial Manager app for free.

## Part 1: Supabase (Database + Auth)

1. Go to [https://supabase.com](https://supabase.com) and sign up (free).
2. Click **New Project**, choose a name and password, and wait for the project to provision.
3. Open **SQL Editor** → **New query**.
4. Copy the entire contents of [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql) and click **Run**.
5. Open **Authentication** → **Users** → **Add user** → **Create new user**.
   - Create one account for Jess (e.g. `jess@yourbusiness.com`)
   - Create one account for Molly (e.g. `molly@yourbusiness.com`)
   - Set passwords and check **Auto Confirm User** so they can sign in immediately.
6. Open **Project Settings** → **API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Part 2: Vercel (Web App Hosting)

1. Push this project to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial financial management app"
   git remote add origin https://github.com/YOUR_USERNAME/financial-app.git
   git push -u origin main
   ```
2. Go to [https://vercel.com](https://vercel.com) and sign up with GitHub (free).
3. Click **Add New** → **Project** → import your `financial-app` repository.
4. Under **Environment Variables**, add:
   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
5. Click **Deploy**. Wait ~2 minutes for the build to finish.
6. Copy your live URL (e.g. `https://financial-app-xyz.vercel.app`).

## Part 3: Partner Onboarding

1. Send your partner:
   - The Vercel app URL
   - Their login email and password (from Supabase step 5)
2. Both of you bookmark the URL on laptop, tablet, and phone.
3. Sign in from any device — you share the same data.

## Recommended Data Entry Order

1. **Clients** — add your customers first
2. **Trade Partners** — add industry partners with discount amounts
3. **Invoicing** — create PO numbers per client
4. **Ledger** — record expenses and receivables (select client, PO, trade partner; discount auto-fills)

## Local Development (Optional)

```bash
cp .env.example .env.local
# Edit .env.local with your Supabase URL and anon key
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Invalid API key" on login | Double-check env vars in Vercel match Supabase API settings |
| Can't insert ledger with PO | Create an invoice with that client + PO first, or leave PO blank |
| Duplicate PO error | Each PO number must be unique per client in Invoicing |
| Build fails on Vercel | Ensure both `NEXT_PUBLIC_*` env vars are set before deploying |
