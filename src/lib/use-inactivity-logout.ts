"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_STORAGE_KEY = "maison-joy-last-activity";
const ACTIVITY_THROTTLE_MS = 1000;

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "click",
  "wheel",
];

function readLastActivity(): number {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

function writeLastActivity(timestamp = Date.now()) {
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(timestamp));
  } catch {
    // Ignore private mode / quota failures.
  }
}

/**
 * Signs the user out after 15 minutes with no mouse, keyboard, touch,
 * scroll, or navigation activity. Shared across tabs via localStorage.
 */
export function useInactivityLogout() {
  const router = useRouter();
  const pathname = usePathname();
  const loggingOutRef = useRef(false);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastWrite = 0;
    loggingOutRef.current = false;

    async function logoutForInactivity() {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      if (timeoutId) clearTimeout(timeoutId);

      try {
        window.localStorage.removeItem(ACTIVITY_STORAGE_KEY);
      } catch {
        // Ignore storage failures.
      }

      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login?reason=inactive");
      router.refresh();
    }

    function scheduleFromLastActivity() {
      if (timeoutId) clearTimeout(timeoutId);
      const elapsed = Date.now() - readLastActivity();
      const remaining = INACTIVITY_TIMEOUT_MS - elapsed;
      if (remaining <= 0) {
        void logoutForInactivity();
        return;
      }
      timeoutId = setTimeout(() => {
        void logoutForInactivity();
      }, remaining);
    }

    function noteActivity(force = false) {
      if (loggingOutRef.current) return;
      const now = Date.now();
      if (!force && now - lastWrite < ACTIVITY_THROTTLE_MS) return;
      lastWrite = now;
      writeLastActivity(now);
      scheduleFromLastActivity();
    }

    function onActivity() {
      noteActivity(false);
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== ACTIVITY_STORAGE_KEY) return;
      scheduleFromLastActivity();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        scheduleFromLastActivity();
      }
    }

    writeLastActivity();
    scheduleFromLastActivity();

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, {
        passive: true,
        capture: true,
      });
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity, true);
      }
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  // Navigation between pages counts as activity.
  useEffect(() => {
    writeLastActivity();
  }, [pathname]);
}
