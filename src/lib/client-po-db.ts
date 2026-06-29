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

export function mergePoNumberOptions(
  registered: string[],
  extra: Array<string | null | undefined>
): string[] {
  const set = new Set<string>();
  for (const value of registered) {
    const trimmed = value.trim();
    if (trimmed) set.add(trimmed);
  }
  for (const value of extra) {
    const trimmed = (value ?? "").trim();
    if (trimmed) set.add(trimmed);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
