import { createClient } from "@/lib/supabase/client";
import type { Client, Invoice } from "@/lib/types";

export const RECORD_LOCK_TTL_SECONDS = 90;
export const RECORD_LOCK_HEARTBEAT_MS = 30_000;
export const DOCUMENTATION_LOCK_ID = "__all__";

export type RecordLockTable =
  | "clients"
  | "client_po_numbers"
  | "trade_partners"
  | "appointments"
  | "invoicing"
  | "ledger"
  | "budget_items"
  | "chart_of_accounts"
  | "app_documentation"
  | "cashflow";

export interface RecordLockTarget {
  table: RecordLockTable;
  id: string;
}

export type AcquireRecordLockResult =
  | { ok: true }
  | { ok: false; holderName: string; error?: string };

type RpcPayload = { table_name: string; record_id: string };

function toPayload(targets: RecordLockTarget[]): RpcPayload[] {
  const seen = new Set<string>();
  const payload: RpcPayload[] = [];
  for (const target of targets) {
    if (!target.id) continue;
    const key = `${target.table}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    payload.push({ table_name: target.table, record_id: target.id });
  }
  return payload;
}

function isMissingLockFunction(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("acquire_record_locks") ||
    lower.includes("release_record_locks") ||
    lower.includes("heartbeat_record_locks") ||
    lower.includes("schema cache") ||
    lower.includes("does not exist")
  );
}

function parseAcquireResult(data: unknown, errorMessage?: string): AcquireRecordLockResult {
  if (errorMessage) {
    if (isMissingLockFunction(errorMessage)) {
      return {
        ok: false,
        holderName: "",
        error:
          "Edit locking is not set up yet. Run supabase/migrations/069_record_locks.sql in the Supabase SQL editor, then try again.",
      };
    }
    return { ok: false, holderName: "", error: errorMessage };
  }

  if (!data || typeof data !== "object") return { ok: true };
  const record = data as Record<string, unknown>;
  if (record.ok === false) {
    const holderName =
      typeof record.holder_name === "string" && record.holder_name.trim()
        ? record.holder_name.trim()
        : "another user";
    const error = typeof record.error === "string" ? record.error : undefined;
    return { ok: false, holderName, error };
  }
  return { ok: true };
}

export function lockTarget(table: RecordLockTable, id: string): RecordLockTarget {
  return { table, id };
}

export function clientLockTargets(client: Pick<Client, "id" | "client_po_numbers">): RecordLockTarget[] {
  return [
    lockTarget("clients", client.id),
    ...(client.client_po_numbers ?? []).map((po) => lockTarget("client_po_numbers", po.id)),
  ];
}

export async function loadLedgerLockTargets(entryId: string): Promise<RecordLockTarget[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("ledger")
    .select("id")
    .or(`id.eq.${entryId},source_ledger_id.eq.${entryId}`);

  const ids = new Set<string>([entryId]);
  for (const row of data ?? []) {
    if (row?.id) ids.add(String(row.id));
  }
  return [...ids].map((id) => lockTarget("ledger", id));
}

export async function loadInvoiceLockTargets(
  invoice: Pick<Invoice, "id" | "invoice_id">
): Promise<RecordLockTarget[]> {
  const targets: RecordLockTarget[] = [lockTarget("invoicing", invoice.id)];
  const invoiceId = invoice.invoice_id?.trim();
  if (!invoiceId) return targets;

  const supabase = createClient();
  const { data } = await supabase.from("ledger").select("id").eq("invoice_id", invoiceId);
  for (const row of data ?? []) {
    if (row?.id) targets.push(lockTarget("ledger", String(row.id)));
  }
  return targets;
}

export function documentationLockTargets(): RecordLockTarget[] {
  return [lockTarget("app_documentation", DOCUMENTATION_LOCK_ID)];
}

export async function acquireRecordLocks(
  targets: RecordLockTarget[]
): Promise<AcquireRecordLockResult> {
  const payload = toPayload(targets);
  if (payload.length === 0) return { ok: true };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("acquire_record_locks", {
    p_locks: payload,
    p_ttl_seconds: RECORD_LOCK_TTL_SECONDS,
  });
  return parseAcquireResult(data, error?.message);
}

export async function releaseRecordLocks(targets: RecordLockTarget[]): Promise<void> {
  const payload = toPayload(targets);
  if (payload.length === 0) return;

  const supabase = createClient();
  await supabase.rpc("release_record_locks", { p_locks: payload });
}

export async function heartbeatRecordLocks(targets: RecordLockTarget[]): Promise<void> {
  const payload = toPayload(targets);
  if (payload.length === 0) return;

  const supabase = createClient();
  await supabase.rpc("heartbeat_record_locks", {
    p_locks: payload,
    p_ttl_seconds: RECORD_LOCK_TTL_SECONDS,
  });
}
