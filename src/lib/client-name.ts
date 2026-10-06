type NamedClient = {
  id: string;
  name: string;
  created_at?: string | null;
};

function clientNameKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

/** Oldest client with the same name, ignoring case and surrounding spaces. */
export function existingClientIdForName(
  clients: NamedClient[],
  name: string
): string | null {
  const key = clientNameKey(name);
  if (!key) return null;

  const matches = clients
    .filter((client) => clientNameKey(client.name) === key)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

  return matches[0]?.id ?? null;
}
