import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

export async function updateSession(request: NextRequest) {
  const isAuthPage = request.nextUrl.pathname.startsWith("/login");

  try {
    const supabaseUrl = getSupabaseUrl().trim();
    const supabaseAnonKey = getSupabaseAnonKey().trim();

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error(
        "Missing Supabase env: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy."
      );
      return isAuthPage
        ? NextResponse.next({ request })
        : NextResponse.redirect(new URL("/login", request.url));
    }

    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && !isAuthPage) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (user && isAuthPage) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return supabaseResponse;
  } catch (error) {
    console.error("Middleware updateSession failed:", error);
    return isAuthPage
      ? NextResponse.next({ request })
      : NextResponse.redirect(new URL("/login", request.url));
  }
}
