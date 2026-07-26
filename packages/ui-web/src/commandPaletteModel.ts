export interface CommandItem {
  id: string;
  label: string;
  category?: string;
  shortcut?: string;
  disabled?: boolean;
  /** Destructive action (e.g. Delete) — `ContextMenu` renders it in Carbon's danger styling; the
   * command palette doesn't currently have a destructive entry, so it just ignores the flag. */
  danger?: boolean;
  run: () => void;
}

/** Case-insensitive substring match over label + category — predictable over "smart" fuzzy ranking. */
export function filterCommands(
  commands: CommandItem[],
  query: string,
): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((command) => {
    const haystack = `${command.category ?? ""} ${command.label}`.toLowerCase();
    return haystack.includes(q);
  });
}
