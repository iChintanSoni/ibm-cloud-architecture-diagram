import { Search } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type CommandItem } from "./commandPaletteModel.js";

export interface CommandPaletteProps {
  open: boolean;
  commands: CommandItem[];
  onClose: () => void;
}

/** Run any action by name (docs/06-editor-ux.md#keyboard-first), opened with Ctrl/Cmd+K. */
export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const runnable = results.filter((command) => !command.disabled);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const runAt = (index: number) => {
    const command = runnable[index];
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div className="icad-command-palette__backdrop" onClick={onClose}>
      <div
        className="icad-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, Math.max(runnable.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            runAt(activeIndex);
          }
        }}
      >
        <Search
          ref={inputRef}
          size="lg"
          labelText="Run a command"
          placeholder="Type a command…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="icad-command-palette__list" role="listbox" aria-label="Commands">
          {runnable.length === 0 && <li className="icad-command-palette__empty">No matching commands</li>}
          {runnable.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className="icad-command-palette__item"
                data-active={index === activeIndex ? "true" : "false"}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runAt(index)}
              >
                <span>{command.label}</span>
                <span className="icad-command-palette__meta">
                  {command.category && <span className="icad-command-palette__category">{command.category}</span>}
                  {command.shortcut && <kbd>{command.shortcut}</kbd>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
