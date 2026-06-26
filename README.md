# Financial Manager

A responsive web app for tracking expenses, receivables, clients, invoices, and trade partner discounts. Built for two partners to share the same data from laptop, tablet, or phone.

**Stack:** Next.js 15, Supabase (PostgreSQL + Auth), Tailwind CSS, Vercel (free hosting)

## Features

- **Clients** — name, address, phone, email, unique ID
- **Trade Partners** — company info, discount amount, MAP, MAP expiration
- **Invoicing** — client + PO number (unique per client)
- **Ledger** — expenses/receivables with auto-filled trade discount, purchaser (Jess/Molly), shipping, tax, and PO linking

## Quick Start (Local)

### 1. Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Open **SQL Editor** and run the migration in [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql).
3. In **Authentication → Users**, create accounts for you and your partner (email + password).
4. Copy your project URL and anon key from **Project Settings → API**.

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

## Deploy to Vercel (Free)

1. Push this project to a GitHub repository.
2. Go to [vercel.com](https://vercel.com) and import the repo.
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Share the Vercel URL with your partner.

## Partner Onboarding

1. Create a Supabase Auth account for your partner (Authentication → Users → Add user).
2. Send them the app URL (local or Vercel).
3. They sign in with their email and password.
4. Both users see and edit the same shared data.

**Suggested workflow:**

1. Add **Clients** and **Trade Partners** first.
2. Create **Invoices** (client + PO number).
3. Record **Ledger** entries — select client, optional PO, trade partner (discount auto-fills).

## Project Structure

```
src/
  app/           # Pages (dashboard, clients, trade-partners, invoicing, ledger, login)
  components/    # UI, forms, navigation shell
  lib/           # Supabase clients, types, utilities
supabase/
  migrations/    # PostgreSQL schema + RLS policies
```

## Notes

- PO numbers on ledger entries must match an existing invoice for that client (or leave PO blank).
- Trade partner discount is copied to the ledger entry when selected; you can override it.
- Purchaser defaults to Jess or Molly if your login email contains that name.
