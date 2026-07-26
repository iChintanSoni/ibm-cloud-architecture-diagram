import { Menu, MenuItem } from "@carbon/react";
import type { CommandItem } from "./commandPaletteModel.js";

export interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: CommandItem[];
  onClose: () => void;
}

/**
 * Right-click (or its keyboard equivalent — the Menu key / Shift+F10, `CanvasController`'s own
 * `onContextMenu`) canvas menu, contextual to the hit target (docs/06-editor-ux.md#core-
 * interactions) — a thin wrapper over Carbon's own `Menu`/`MenuItem`, which already handles
 * positioning, open/close, and keyboard nav (arrow keys, Enter, Escape) natively, over the same
 * `CommandItem[]` shape the command palette uses, so an action is defined once rather than
 * duplicated between the two surfaces.
 */
export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  return (
    <Menu open={open} x={x} y={y} onClose={onClose} label="Canvas actions">
      {items.map((item) => (
        <MenuItem
          key={item.id}
          label={item.label}
          {...(item.shortcut ? { shortcut: item.shortcut } : {})}
          disabled={item.disabled ?? false}
          kind={item.danger ? "danger" : "default"}
          // MenuItem already closes the root Menu itself on a non-submenu click (it calls
          // context.state.requestCloseRoot(), which invokes this same onClose) — calling it again
          // here would fire onClose twice.
          onClick={() => item.run()}
        />
      ))}
    </Menu>
  );
}
