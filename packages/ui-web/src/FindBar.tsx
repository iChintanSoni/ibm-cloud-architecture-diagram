import { Button, Search } from "@carbon/react";
import { ChevronDown, ChevronUp, Close } from "@carbon/react/icons";
import { useEffect, useRef } from "react";
import type { FindMatch } from "./findModel.js";

export interface FindBarProps {
  open: boolean;
  query: string;
  matches: FindMatch[];
  activeIndex: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

/** Find on canvas (docs/06-editor-ux.md#find-on-canvas-f): labels, icon names, frame names. */
export function FindBar({
  open,
  query,
  matches,
  activeIndex,
  onQueryChange,
  onNext,
  onPrevious,
  onClose
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    // Restores focus to whatever opened Find (docs/07-accessibility.md#chrome-the-easy-80).
    return () => previousFocusRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    // Carbon's <Search> already renders its own named role="search" landmark
    // (labelText below) — an outer role="search" here would just duplicate it.
    <div className="icad-find-bar">
      <Search
        ref={inputRef}
        size="sm"
        labelText="Find on canvas"
        placeholder="Find labels, icons, frames…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          }
        }}
      />
      <span className="icad-find-bar__count">
        {matches.length === 0 ? "No results" : `${activeIndex + 1} / ${matches.length}`}
      </span>
      <Button kind="ghost" size="sm" iconDescription="Previous match" hasIconOnly renderIcon={ChevronUp} onClick={onPrevious} disabled={matches.length === 0} />
      <Button kind="ghost" size="sm" iconDescription="Next match" hasIconOnly renderIcon={ChevronDown} onClick={onNext} disabled={matches.length === 0} />
      <Button kind="ghost" size="sm" iconDescription="Close find" hasIconOnly renderIcon={Close} onClick={onClose} />
    </div>
  );
}
