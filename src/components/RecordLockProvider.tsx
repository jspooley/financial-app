"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { RecordLockDialog } from "@/components/ui/RecordLockDialog";
import {
  RECORD_LOCK_HEARTBEAT_MS,
  acquireRecordLocks,
  heartbeatRecordLocks,
  releaseRecordLocks,
  type RecordLockTarget,
} from "@/lib/record-lock";

interface RecordLockContextValue {
  acquireLocks: (
    targets: RecordLockTarget[],
    options?: { mode?: "replace" | "add" }
  ) => Promise<boolean>;
  releaseLocks: (targets?: RecordLockTarget[]) => Promise<void>;
}

const RecordLockContext = createContext<RecordLockContextValue | null>(null);

function targetKey(target: RecordLockTarget) {
  return `${target.table}:${target.id}`;
}

function mergeTargets(
  current: RecordLockTarget[],
  incoming: RecordLockTarget[]
): RecordLockTarget[] {
  const map = new Map(current.map((target) => [targetKey(target), target]));
  for (const target of incoming) {
    if (target.id) map.set(targetKey(target), target);
  }
  return [...map.values()];
}

function subtractTargets(
  current: RecordLockTarget[],
  removing: RecordLockTarget[]
): RecordLockTarget[] {
  const remove = new Set(removing.map(targetKey));
  return current.filter((target) => !remove.has(targetKey(target)));
}

export function RecordLockProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const [held, setHeld] = useState<RecordLockTarget[]>([]);
  const [blocked, setBlocked] = useState<{ holderName: string; error?: string } | null>(
    null
  );
  const heldRef = useRef<RecordLockTarget[]>([]);
  heldRef.current = held;

  const releaseLocks = useCallback(async (targets?: RecordLockTarget[]) => {
    const toRelease = targets ?? heldRef.current;
    if (toRelease.length === 0) return;
    await releaseRecordLocks(toRelease);
    heldRef.current = subtractTargets(heldRef.current, toRelease);
    setHeld(heldRef.current);
  }, []);

  const acquireLocks = useCallback(
    async (
      targets: RecordLockTarget[],
      options?: { mode?: "replace" | "add" }
    ) => {
      const mode = options?.mode ?? "replace";
      const nextTargets = targets.filter((target) => Boolean(target.id));

      if (mode === "replace" && heldRef.current.length > 0) {
        await releaseRecordLocks(heldRef.current);
        heldRef.current = [];
        setHeld([]);
      }

      if (nextTargets.length === 0) return true;

      const result = await acquireRecordLocks(nextTargets);
      if (!result.ok) {
        setBlocked({
          holderName: result.holderName || "another user",
          error: result.error,
        });
        return false;
      }

      heldRef.current =
        mode === "add" ? mergeTargets(heldRef.current, nextTargets) : nextTargets;
      setHeld(heldRef.current);
      return true;
    },
    []
  );

  useEffect(() => {
    if (held.length === 0) return;

    const interval = window.setInterval(() => {
      void heartbeatRecordLocks(heldRef.current);
    }, RECORD_LOCK_HEARTBEAT_MS);

    return () => window.clearInterval(interval);
  }, [held.length]);

  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    const current = heldRef.current;
    if (current.length === 0) return;
    void releaseRecordLocks(current);
    heldRef.current = [];
    setHeld([]);
  }, [pathname]);

  useEffect(() => {
    function releaseHeld() {
      const current = heldRef.current;
      if (current.length === 0) return;
      void releaseRecordLocks(current);
      heldRef.current = [];
    }

    function onPageHide() {
      releaseHeld();
    }

    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      releaseHeld();
    };
  }, []);

  const value = useMemo(
    () => ({ acquireLocks, releaseLocks }),
    [acquireLocks, releaseLocks]
  );

  return (
    <RecordLockContext.Provider value={value}>
      {children}
      {blocked ? (
        <RecordLockDialog
          holderName={blocked.holderName}
          error={blocked.error}
          onDismiss={() => setBlocked(null)}
        />
      ) : null}
    </RecordLockContext.Provider>
  );
}

export function useRecordLocks() {
  const context = useContext(RecordLockContext);
  if (!context) {
    throw new Error("useRecordLocks must be used within RecordLockProvider");
  }
  return context;
}
