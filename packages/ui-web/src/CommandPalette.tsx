import { Search } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type CommandItem } from "./commandPaletteModel.js";

export interface CommandPaletteProps {
  open: boolean;
  commands: CommandItem[];
  onClose: () => void;
}

/** Run any action by name (packages/core/docs/editor-ux.md#keyboard-first), opened with Ctrl/Cmd+K. */
export function CommandPalette({
  open,
  commands,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );
  const runnable = results.filter((command) => !command.disabled);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
    // Restores focus to whatever opened the palette (packages/core/docs/accessibility.md#chrome-the-easy-80).
    return () => previousFocusRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keeps the highlighted option in view as arrow keys move it — the list's items are
  // intentionally not real tab stops (arrow keys navigate instead, standard combobox/listbox
  // pattern), so this is how keyboard users reach options that have scrolled out of view.
  useEffect(() => {
    const activeItem = listRef.current?.querySelector('[data-active="true"]');
    // jsdom has no layout engine and doesn't implement scrollIntoView at all.
    if (
      activeItem instanceof HTMLElement &&
      typeof activeItem.scrollIntoView === "function"
    ) {
      activeItem.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

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
            setActiveIndex((index) =>
              Math.min(index + 1, Math.max(runnable.length - 1, 0)),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            runAt(activeIndex);
          } else if (event.key === "Tab") {
            // The search input is the only stop in the tab sequence — arrow keys navigate
            // the list (standard combobox/listbox pattern) — so Tab traps focus here rather
            // than leaking out to whatever is behind the modal backdrop.
            event.preventDefault();
            inputRef.current?.focus();
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
        <ul
          ref={listRef}
          className="icad-command-palette__list"
          role="listbox"
          aria-label="Commands"
        >
          {runnable.length === 0 && (
            <li role="presentation" className="icad-command-palette__empty">
              No matching commands
            </li>
          )}
          {runnable.map((command, index) => (
            <li key={command.id} role="presentation">
              <button
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === activeIndex}
                className="icad-command-palette__item"
                data-active={index === activeIndex ? "true" : "false"}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runAt(index)}
              >
                <span>{command.label}</span>
                <span className="icad-command-palette__meta">
                  {command.category && (
                    <span className="icad-command-palette__category">
                      {command.category}
                    </span>
                  )}
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
