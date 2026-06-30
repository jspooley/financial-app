import { normalizePoNumber } from "@/lib/invoice-utils";
import type { ClientPoNumber } from "@/lib/types";

export function poNumbersForClient(
  rows: ClientPoNumber[],
  clientId: string | null | undefined
): string[] {
  if (!clientId) return [];
  return rows
    .filter((row) => row.client_id === clientId)
    .map((row) => row.po_number.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/** Merge PO strings case-insensitively; first spelling wins for display. */
export function collectClientPoOptions(
  ...sources: Array<Array<string | null | undefined> | string | null | undefined>
): string[] {
  const flat: Array<string | null | undefined> = [];
  for (const source of sources) {
    if (Array.isArray(source)) flat.push(...source);
    else flat.push(source);
  }

  const byKey = new Map<string, string>();
  for (const raw of flat) {
    const display = (raw ?? "").trim();
    if (!display) continue;
    const key = normalizePoNumber(display);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, display);
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

export function mergePoNumberOptions(
  registered: string[],
  extra: Array<string | null | undefined>
): string[] {
  return collectClientPoOptions(registered, extra);
}

export function poNumbersFromLedgerEntries(
  entries: Array<{ client_id?: string; po_number?: string | null }>,
  clientId: string | null | undefined
): Array<string | null | undefined> {
  if (!clientId) return [];
  return entries
    .filter((entry) => entry.client_id === clientId)
    .map((entry) => entry.po_number ?? null);
}
