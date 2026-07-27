import {
  Button,
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenu,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
} from "@carbon/react";
import { Flash, Search } from "@carbon/react/icons";
import type { MouseEvent, ReactNode } from "react";

export type ThemePreference = "auto" | "light" | "dark";
export type InsertKind =
  "box" | "group" | "boundary" | "actor" | "text" | "frame";

const INSERT_ITEMS: Array<{ kind: InsertKind; label: string }> = [
  { kind: "box", label: "Box (deployedOn)" },
  { kind: "group", label: "Group (deployedTo)" },
  { kind: "boundary", label: "Boundary" },
  { kind: "actor", label: "Actor" },
  { kind: "text", label: "Text" },
  { kind: "frame", label: "Frame" },
];

export interface TopBarProps {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs?: () => void;
  onExport: () => void;

  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  onGroup: () => void;
  onUngroup: () => void;
  canGroup: boolean;
  canUngroup: boolean;

  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToContent: () => void;
  onOpenFind: () => void;
  onOpenCommandPalette: () => void;

  onInsert: (kind: InsertKind) => void;

  themePreference: ThemePreference;
  onThemeChange: (preference: ThemePreference) => void;

  /** Background grid visibility (M17.2, docs/10-canvas-parity-plan.md) — a view preference, not
   * part of the document. */
  gridVisible: boolean;
  onToggleGrid: () => void;
}

function action(handler: () => void): (event: MouseEvent) => void {
  return (event) => {
    event.preventDefault();
    handler();
  };
}

function MenuAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <HeaderMenuItem
      href="#"
      aria-disabled={disabled ? "true" : undefined}
      className={disabled ? "icad-menu-item--disabled" : undefined}
      onClick={disabled ? (event) => event.preventDefault() : action(onClick)}
    >
      {children}
    </HeaderMenuItem>
  );
}

/** Full Carbon UI Shell top bar (docs/06-editor-ux.md#layout): Menu · File Edit View Insert Help. */
export function TopBar({
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onExport,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onGroup,
  onUngroup,
  canGroup,
  canUngroup,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToContent,
  onOpenFind,
  onOpenCommandPalette,
  onInsert,
  themePreference,
  onThemeChange,
  gridVisible,
  onToggleGrid,
}: TopBarProps) {
  return (
    <Header aria-label="ICAD — IBM Cloud Architecture Diagrams">
      <HeaderName
        href="#"
        prefix="ICAD"
        onClick={(event) => event.preventDefault()}
      >
        IBM Cloud Architecture Diagrams
      </HeaderName>
      <HeaderNavigation aria-label="Main menu">
        <HeaderMenu menuLinkName="File" aria-label="File">
          <MenuAction onClick={onNew}>New…</MenuAction>
          <MenuAction onClick={onOpen}>Open .icad…</MenuAction>
          <MenuAction onClick={onSave}>Save .icad</MenuAction>
          {onSaveAs && <MenuAction onClick={onSaveAs}>Save As…</MenuAction>}
          <MenuAction onClick={onExport}>Export…</MenuAction>
        </HeaderMenu>
        <HeaderMenu menuLinkName="Edit" aria-label="Edit">
          <MenuAction onClick={onUndo} disabled={!canUndo}>
            Undo
          </MenuAction>
          <MenuAction onClick={onRedo} disabled={!canRedo}>
            Redo
          </MenuAction>
          <MenuAction onClick={onGroup} disabled={!canGroup}>
            Group
          </MenuAction>
          <MenuAction onClick={onUngroup} disabled={!canUngroup}>
            Ungroup
          </MenuAction>
        </HeaderMenu>
        <HeaderMenu menuLinkName="View" aria-label="View">
          <MenuAction onClick={onZoomIn}>Zoom in</MenuAction>
          <MenuAction onClick={onZoomOut}>Zoom out</MenuAction>
          <MenuAction onClick={onResetZoom}>Reset zoom to 100%</MenuAction>
          <MenuAction onClick={onFitToContent}>Fit to content</MenuAction>
          <MenuAction onClick={onOpenFind}>Find on canvas…</MenuAction>
          <MenuAction onClick={onOpenCommandPalette}>
            Command palette…
          </MenuAction>
          <MenuAction onClick={onToggleGrid}>
            {gridVisible ? "Hide grid" : "Show grid"}
          </MenuAction>
          <MenuAction
            onClick={() => onThemeChange("auto")}
            disabled={themePreference === "auto"}
          >
            Theme: Auto
          </MenuAction>
          <MenuAction
            onClick={() => onThemeChange("light")}
            disabled={themePreference === "light"}
          >
            Theme: Light
          </MenuAction>
          <MenuAction
            onClick={() => onThemeChange("dark")}
            disabled={themePreference === "dark"}
          >
            Theme: Dark
          </MenuAction>
        </HeaderMenu>
        <HeaderMenu menuLinkName="Insert" aria-label="Insert">
          {INSERT_ITEMS.map((item) => (
            <MenuAction key={item.kind} onClick={() => onInsert(item.kind)}>
              {item.label}
            </MenuAction>
          ))}
        </HeaderMenu>
        <HeaderMenu menuLinkName="Help" aria-label="Help">
          <MenuAction onClick={onOpenCommandPalette}>
            Keyboard shortcuts &amp; commands…
          </MenuAction>
        </HeaderMenu>
      </HeaderNavigation>
      <HeaderGlobalBar>
        <span className="icad-zoom-indicator" aria-live="polite">
          {Math.round(zoomPercent)}%
        </span>
        <HeaderGlobalAction
          aria-label="Find on canvas (Ctrl+F)"
          onClick={onOpenFind}
        >
          <Search size={20} />
        </HeaderGlobalAction>
        <HeaderGlobalAction
          aria-label="Command palette (Ctrl+K)"
          onClick={onOpenCommandPalette}
        >
          <Flash size={20} />
        </HeaderGlobalAction>
        <div className="icad-theme-switch">
          {(["auto", "light", "dark"] as const).map((option) => (
            <Button
              key={option}
              kind={themePreference === option ? "primary" : "ghost"}
              size="sm"
              onClick={() => onThemeChange(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        <div className="icad-topbar__export">
          <Button kind="primary" size="sm" onClick={onExport}>
            Export
          </Button>
        </div>
      </HeaderGlobalBar>
    </Header>
  );
}
