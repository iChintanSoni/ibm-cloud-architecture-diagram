export interface CommandItem {
  id: string;
  label: string;
  category?: string;
  shortcut?: string;
  disabled?: boolean;
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
