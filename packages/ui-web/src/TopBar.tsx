import {
  Button,
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenu,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
  OverflowMenu,
  OverflowMenuItem,
} from "@carbon/react";
import {
  AsleepFilled,
  Automatic,
  Flash,
  LightFilled,
  Search,
} from "@carbon/react/icons";
import type { ElementType, MouseEvent, ReactNode } from "react";

export type ThemePreference = "auto" | "light" | "dark";

const THEME_ICONS: Record<ThemePreference, ElementType> = {
  auto: Automatic,
  light: LightFilled,
  dark: AsleepFilled,
};

const THEME_LABELS: Record<ThemePreference, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
};

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

  onBringToFront: () => void;
  onSendToBack: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  /** Shared across all four z-order actions, same shallow gate as `canGroup` — each command is a
   * safe no-op when nothing actually moves (M18, packages/core/docs/canvas-parity-plan.md). */
  canChangeZOrder: boolean;

  onAlignLeft: () => void;
  onAlignCenterHorizontal: () => void;
  onAlignRight: () => void;
  onAlignTop: () => void;
  onAlignMiddle: () => void;
  onAlignBottom: () => void;
  /** Shared across all six align actions, same shallow `>= 2` gate as `canGroup` (M18.2,
   * packages/core/docs/canvas-parity-plan.md) — the real no-op check (fewer than two alignable elements, or
   * an already-aligned selection) happens in `Editor.applyAlign`. */
  canAlign: boolean;

  onDistributeHorizontal: () => void;
  onDistributeVertical: () => void;
  /** Shared across both distribute actions. Same shallow `>= 3` gate — the real no-op check
   * (fewer than three distributable elements, or already-even spacing) happens in
   * `Editor.applyDistribute` (M18.3, packages/core/docs/canvas-parity-plan.md). */
  canDistribute: boolean;

  onToggleLock: () => void;
  onToggleHide: () => void;
  /** Shared shallow gate for both lock and hide — any selection means the action is available
   * (M18.4, packages/core/docs/canvas-parity-plan.md). */
  canToggleLockHide: boolean;

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

  /** Background grid visibility (M17.2, packages/core/docs/canvas-parity-plan.md) — a view preference, not
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

/** Full Carbon UI Shell top bar (packages/core/docs/editor-ux.md#layout): Menu · File Edit View Insert Help. */
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
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  canChangeZOrder,
  onAlignLeft,
  onAlignCenterHorizontal,
  onAlignRight,
  onAlignTop,
  onAlignMiddle,
  onAlignBottom,
  canAlign,
  onDistributeHorizontal,
  onDistributeVertical,
  canDistribute,
  onToggleLock,
  onToggleHide,
  canToggleLockHide,
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
          <MenuAction onClick={onBringToFront} disabled={!canChangeZOrder}>
            Bring to front
          </MenuAction>
          <MenuAction onClick={onBringForward} disabled={!canChangeZOrder}>
            Bring forward
          </MenuAction>
          <MenuAction onClick={onSendBackward} disabled={!canChangeZOrder}>
            Send backward
          </MenuAction>
          <MenuAction onClick={onSendToBack} disabled={!canChangeZOrder}>
            Send to back
          </MenuAction>
          <MenuAction onClick={onAlignLeft} disabled={!canAlign}>
            Align left
          </MenuAction>
          <MenuAction onClick={onAlignCenterHorizontal} disabled={!canAlign}>
            Align center
          </MenuAction>
          <MenuAction onClick={onAlignRight} disabled={!canAlign}>
            Align right
          </MenuAction>
          <MenuAction onClick={onAlignTop} disabled={!canAlign}>
            Align top
          </MenuAction>
          <MenuAction onClick={onAlignMiddle} disabled={!canAlign}>
            Align middle
          </MenuAction>
          <MenuAction onClick={onAlignBottom} disabled={!canAlign}>
            Align bottom
          </MenuAction>
          <MenuAction
            onClick={onDistributeHorizontal}
            disabled={!canDistribute}
          >
            Distribute horizontal
          </MenuAction>
          <MenuAction onClick={onDistributeVertical} disabled={!canDistribute}>
            Distribute vertical
          </MenuAction>
          <MenuAction onClick={onToggleLock} disabled={!canToggleLockHide}>
            Toggle lock
          </MenuAction>
          <MenuAction onClick={onToggleHide} disabled={!canToggleLockHide}>
            Toggle hide
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
        <div className="icad-theme-menu">
          <OverflowMenu
            aria-label="Theme"
            renderIcon={THEME_ICONS[themePreference]}
            iconDescription={`Theme: ${THEME_LABELS[themePreference]}`}
            size="sm"
            flipped
          >
            <OverflowMenuItem
              itemText="Auto"
              disabled={themePreference === "auto"}
              onClick={() => onThemeChange("auto")}
            />
            <OverflowMenuItem
              itemText="Light"
              disabled={themePreference === "light"}
              onClick={() => onThemeChange("light")}
            />
            <OverflowMenuItem
              itemText="Dark"
              disabled={themePreference === "dark"}
              onClick={() => onThemeChange("dark")}
            />
          </OverflowMenu>
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
