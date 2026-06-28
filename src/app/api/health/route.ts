import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = getSupabaseUrl().trim();
  const key = getSupabaseAnonKey().trim();

  return Response.json({
    ok: Boolean(url && key),
    deploy: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      env: process.env.VERCEL_ENV ?? null,
    },
    supabase: {
      urlConfigured: Boolean(url),
      keyConfigured: Boolean(key),
    },
    envSources: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ),
      SUPABASE_ANON_KEY: Boolean(process.env.SUPABASE_ANON_KEY),
    },
  });
}
