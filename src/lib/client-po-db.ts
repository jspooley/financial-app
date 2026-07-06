import { normalizePoNumber } from "@/lib/invoice-utils";
import type { ClientPoNumber } from "@/lib/types";

type PoNumberClient = {
  from: (table: string) => {
    select: (columns: string) => PromiseLike<{
      data: Array<{ po_number?: string | null }> | null;
      error: { message: string } | null;
    }>;
    update: (payload: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq: (
          column: string,
          value: string
        ) => PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
};

/** First initial + last initial from a client display name (uppercase). */
export function clientNameInitials(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "X", last: "X" };
  const first = parts[0]![0]!.toUpperCase();
  const lastWord = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!;
  return { first, last: lastWord[0]!.toUpperCase() };
}

export function autoClientPoYearMonth(date = new Date()): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Build MJ-{F}{L}-{YYYYMM}; optional numeric suffix appended to last initial (e.g. G1). */
export function buildAutoClientPoNumber(
  name: string,
  lastInitialSuffix = "",
  date = new Date()
): string {
  const { first, last } = clientNameInitials(name);
  return `MJ-${first}${last}${lastInitialSuffix}-${autoClientPoYearMonth(date)}`;
}

/** Pick MJ-{F}{L}-{YYYYMM}, or MJ-{F}{L}1-{YYYYMM}, etc., not in existingPoNumbers. */
export function pickUniqueAutoClientPoNumber(
  clientName: string,
  existingPoNumbers: Iterable<string>,
  date = new Date()
): string {
  const taken = new Set(
    Array.from(existingPoNumbers, (po) => normalizePoNumber(po)).filter(Boolean)
  );

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = buildAutoClientPoNumber(
      clientName,
      suffix === 0 ? "" : String(suffix),
      date
    );
    if (!taken.has(normalizePoNumber(candidate))) return candidate;
  }

  throw new Error("Could not generate a unique PO number. Enter one manually.");
}

export async function fetchAllKnownPoNumbers(
  supabase: PoNumberClient
): Promise<string[]> {
  const [{ data: registry }, { data: ledger }, { data: invoicing }] = await Promise.all([
    supabase.from("client_po_numbers").select("po_number"),
    supabase.from("ledger").select("po_number"),
    supabase.from("invoicing").select("po_number"),
  ]);

  return collectClientPoOptions(
    (registry ?? []).map((row) => row.po_number),
    (ledger ?? []).map((row) => row.po_number),
    (invoicing ?? []).map((row) => row.po_number)
  );
}

export async function resolveClientPoNumber(
  supabase: PoNumberClient,
  clientName: string,
  rawPo?: string | null
): Promise<string> {
  const trimmed = rawPo?.trim();
  if (trimmed) return trimmed;
  const existing = await fetchAllKnownPoNumbers(supabase);
  return pickUniqueAutoClientPoNumber(clientName, existing);
}

export async function renameClientPoNumber(
  supabase: PoNumberClient,
  clientId: string,
  oldPoNumber: string,
  newPoNumber: string
): Promise<{ error: string | null }> {
  const oldTrim = oldPoNumber.trim();
  const newTrim = newPoNumber.trim();
  if (!newTrim) return { error: "PO number cannot be empty." };
  if (oldTrim === newTrim) return { error: null };

  const existing = await fetchAllKnownPoNumbers(supabase);
  const taken = new Set(existing.map((po) => normalizePoNumber(po)));
  taken.delete(normalizePoNumber(oldTrim));
  if (taken.has(normalizePoNumber(newTrim))) {
    return { error: `PO number "${newTrim}" is already in use.` };
  }

  const { error: registryError } = await supabase
    .from("client_po_numbers")
    .update({ po_number: newTrim })
    .eq("client_id", clientId)
    .eq("po_number", oldTrim);

  if (registryError) return { error: registryError.message };

  const { error: ledgerError } = await supabase
    .from("ledger")
    .update({ po_number: newTrim })
    .eq("client_id", clientId)
    .eq("po_number", oldTrim);

  if (ledgerError) return { error: ledgerError.message };

  const { error: invoicingError } = await supabase
    .from("invoicing")
    .update({ po_number: newTrim })
    .eq("client_id", clientId)
    .eq("po_number", oldTrim);

  if (invoicingError) return { error: invoicingError.message };

  return { error: null };
}

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

export function budgetForClientPo(
  rows: ClientPoNumber[],
  clientId: string,
  po: string
): number {
  const key = normalizePoNumber(po);
  const row = rows.find(
    (candidate) =>
      candidate.client_id === clientId &&
      normalizePoNumber(candidate.po_number) === key
  );
  return Number(row?.budget ?? 0);
}
