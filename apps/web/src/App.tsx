import {
  ActionableNotification,
  Button,
  Modal,
  Select,
  SelectItem,
  Tag,
  Theme
} from "@carbon/react";
import {
  createEditor,
  ruleMetadata,
  type ConformanceSeverity,
  type Diagnostic,
  type Editor,
  type ExportGate
} from "@icad/core";
import { useEffect, useRef, useState } from "react";
import { createIbmCloudCatalog } from "./catalog";
import { clearDraft, debounceAutosave, loadDraft, saveDraft } from "./persistence/autosave";
import { openIcadFile, saveIcadFile, supportsFileSystemAccess } from "./persistence/fileSystem";
import { type ThemePreference, useResolvedTheme } from "./useResolvedTheme";
import { buildValidationView } from "./validation";

/** West-to-east demo layout (docs/05-ibm-spec-conformance.md#layout-convention). */
function seedDemoDiagram(editor: Editor): void {
  const ROW_Y = 150;

  const customer = editor.addActor({
    at: { x: 40, y: ROW_Y },
    label: "Customer",
    catalogRef: "ibm-cloud/user"
  });

  const vpc = editor.addBox({ at: { x: 220, y: 60 }, w: 560, h: 220, label: "VPC" });
  const zone = editor.addGroup({
    at: { x: 250, y: 100 },
    w: 380,
    h: 140,
    parentId: vpc,
    label: "Security group"
  });

  const gateway = editor.addIcon("ibm-cloud/gateway-api", { at: { x: 280, y: ROW_Y }, parentId: zone, label: "API Gateway" });
  const compute = editor.addIcon("ibm-cloud/instance-bx", { at: { x: 500, y: ROW_Y }, parentId: zone, label: "App server" });
  const storage = editor.addIcon("ibm-cloud/object-storage-application", {
    at: { x: 680, y: ROW_Y },
    parentId: vpc,
    label: "Object storage"
  });

  editor.connect({ elementId: customer, port: "e" }, { elementId: gateway, port: "w" }, {
    connectorType: "connection",
    flowColor: "public"
  });
  editor.connect({ elementId: gateway, port: "e" }, { elementId: compute, port: "w" }, {
    connectorType: "connection",
    flowColor: "private"
  });
  editor.connect({ elementId: compute, port: "e" }, { elementId: storage, port: "w" }, {
    connectorType: "dependency"
  });
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function filenameFor(title: string): string {
  return `${title.trim().replace(/\s+/g, "-").toLowerCase() || "diagram"}.icad`;
}

export function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const autosaveRef = useRef(debounceAutosave((doc: unknown) => void saveDraft(doc)));

  const [themePreference, setThemePreference] = useState<ThemePreference>("auto");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportGate, setExportGateState] = useState<ExportGate>("warn");
  const carbonTheme = useResolvedTheme(themePreference);

  useEffect(() => {
    if (!canvasRef.current) return;

    const editor = createEditor({
      container: canvasRef.current,
      catalog: createIbmCloudCatalog(),
      theme: themePreference
    });
    editorRef.current = editor;

    let cancelled = false;
    loadDraft().then((draft) => {
      if (cancelled) return;
      if (draft) {
        editor.loadIcad(draft);
        setRecoveredDraft(true);
      } else {
        seedDemoDiagram(editor);
      }
      setExportGateState(editor.scene.conformance.exportGate);
      setDiagnostics(editor.lint());
    });

    const unsubscribe = editor.on(() => {
      setDiagnostics(editor.lint());
      autosaveRef.current(editor.toIcad());
    });

    return () => {
      cancelled = true;
      unsubscribe();
      editor.destroy();
      editorRef.current = null;
    };
    // Mounted once: the editor owns its own theme thereafter via setTheme().
  }, []);

  useEffect(() => {
    editorRef.current?.setTheme(themePreference);
  }, [themePreference]);

  const openExport = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const summary = editor.complianceSummary();
    setDiagnostics(summary.diagnostics);
    setExportGateState(editor.scene.conformance.exportGate);
    setExportOpen(true);
  };

  const handleExportSvg = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const svg = editor.export({ format: "svg" });
    if (typeof svg === "string") {
      download("diagram.svg", svg, "image/svg+xml");
      setExportOpen(false);
    }
  };

  const persistIcad = async (forceSaveAs: boolean) => {
    const editor = editorRef.current;
    if (!editor) return;
    const doc = editor.toIcad();
    const content = JSON.stringify(doc, null, 2);
    const filename = filenameFor(doc.meta.title);

    if (supportsFileSystemAccess()) {
      const handle = await saveIcadFile(content, forceSaveAs ? null : fileHandleRef.current, filename);
      if (handle) {
        fileHandleRef.current = handle;
        await clearDraft();
      }
      return;
    }

    download(filename, content, "application/json");
    await clearDraft();
  };

  const handleSaveIcad = () => void persistIcad(false);
  const handleSaveIcadAs = () => void persistIcad(true);

  const loadIntoEditor = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.loadIcad(JSON.parse(text));
    setExportGateState(editor.scene.conformance.exportGate);
    setDiagnostics(editor.lint());
    setRecoveredDraft(false);
    void saveDraft(editor.toIcad());
  };

  const handleOpenClick = async () => {
    if (supportsFileSystemAccess()) {
      const opened = await openIcadFile();
      if (!opened) return; // user canceled the picker
      fileHandleRef.current = opened.handle;
      loadIntoEditor(opened.text);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleOpenIcadFallback = (file: File) => {
    fileHandleRef.current = null;
    file.text().then(loadIntoEditor);
  };

  const handleDiscardDraft = () => {
    clearDraft().then(() => window.location.reload());
  };

  const {
    groups: groupedDiagnostics,
    counts,
    fixableByRule,
    exportBlocked
  } = buildValidationView(diagnostics, exportGate);

  return (
    <Theme theme={carbonTheme}>
      <div className="icad-shell">
        <header className="icad-topbar">
          <span className="icad-brand">ICAD — IBM Cloud Architecture Diagrams</span>
          <div className="icad-toolbar">
            <Button kind="tertiary" size="sm" onClick={() => editorRef.current?.commands.undo()}>
              Undo
            </Button>
            <Button kind="tertiary" size="sm" onClick={() => editorRef.current?.commands.redo()}>
              Redo
            </Button>
            <Button kind="secondary" size="sm" onClick={handleSaveIcad}>
              Save .icad
            </Button>
            {supportsFileSystemAccess() && (
              <Button kind="tertiary" size="sm" onClick={handleSaveIcadAs}>
                Save As…
              </Button>
            )}
            <Button kind="secondary" size="sm" onClick={() => void handleOpenClick()}>
              Open .icad
            </Button>
            <Button kind="primary" size="sm" onClick={openExport}>
              Export SVG
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".icad,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleOpenIcadFallback(file);
                e.target.value = "";
              }}
            />
            <div className="icad-theme-switch">
              {(["auto", "light", "dark"] as const).map((option) => (
                <Button
                  key={option}
                  kind={themePreference === option ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setThemePreference(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
        </header>

        {recoveredDraft && (
          <ActionableNotification
            inline
            kind="info"
            lowContrast
            title="Recovered unsaved changes"
            subtitle="Restored automatically from your last session."
            actionButtonLabel="Discard"
            onActionButtonClick={handleDiscardDraft}
            onCloseButtonClick={() => setRecoveredDraft(false)}
          />
        )}

        <div className="icad-body">
          <div className="icad-canvas" ref={canvasRef} />
          <aside className="icad-validation">
            <div className="icad-validation-heading">
              <h2>Validation</h2>
              <span aria-label={`${diagnostics.length} issues`}>{diagnostics.length}</span>
            </div>
            {diagnostics.length === 0 && <p className="icad-muted">No conformance issues found.</p>}
            {groupedDiagnostics.map(
              ({ severity, items }) =>
                items.length > 0 && (
                  <section className="icad-diagnostic-group" key={severity}>
                    <h3>
                      {severity} <span>{items.length}</span>
                    </h3>
                    <ul>
                      {items.map((diagnostic) => (
                        <li key={diagnostic.id}>
                          <Tag
                            type={severity === "error" ? "red" : severity === "warn" ? "warm-gray" : "blue"}
                          >
                            {diagnostic.ruleId}
                          </Tag>
                          <button
                            className="icad-diagnostic-target"
                            type="button"
                            disabled={!diagnostic.elementId}
                            onClick={() => {
                              if (diagnostic.elementId) editorRef.current?.selection.set([diagnostic.elementId]);
                            }}
                          >
                            {diagnostic.message}
                          </button>
                          {diagnostic.quickFix && (
                            <div className="icad-fix-actions">
                              <Button
                                kind="ghost"
                                size="sm"
                                onClick={() => {
                                  editorRef.current?.applyQuickFix(diagnostic);
                                  setDiagnostics(editorRef.current?.lint() ?? []);
                                }}
                              >
                                {diagnostic.quickFixLabel ?? "Fix"}
                              </Button>
                              {(fixableByRule.get(diagnostic.ruleId) ?? 0) > 1 && (
                                <Button
                                  kind="ghost"
                                  size="sm"
                                  onClick={() => {
                                    editorRef.current?.applyQuickFixes(diagnostic.ruleId);
                                    setDiagnostics(editorRef.current?.lint() ?? []);
                                  }}
                                >
                                  Fix all of this type
                                </Button>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )
            )}
            <details className="icad-rule-settings">
              <summary>Rule settings</summary>
              <p className="icad-muted">Overrides are saved in this .icad document.</p>
              {ruleMetadata.map((rule) => (
                <Select
                  key={rule.id}
                  id={`icad-rule-${rule.id}`}
                  size="sm"
                  labelText={rule.title}
                  value={editorRef.current?.scene.conformance.ruleSeverities[rule.id] ?? "default"}
                  onChange={(event) => {
                    const value = event.target.value;
                    editorRef.current?.setRuleSeverity(
                      rule.id,
                      value === "default" ? undefined : (value as ConformanceSeverity)
                    );
                    setDiagnostics(editorRef.current?.lint() ?? []);
                  }}
                >
                  <SelectItem value="default" text={`Default (${rule.defaultSeverity})`} />
                  <SelectItem value="error" text="Error" />
                  <SelectItem value="warn" text="Warning" />
                  <SelectItem value="info" text="Info" />
                  <SelectItem value="off" text="Off" />
                </Select>
              ))}
            </details>
          </aside>
        </div>

        <Modal
          open={exportOpen}
          size="sm"
          modalLabel="Export"
          modalHeading="Export SVG"
          primaryButtonText={exportBlocked ? "Resolve errors to export" : "Export"}
          primaryButtonDisabled={exportBlocked}
          secondaryButtonText="Cancel"
          onRequestClose={() => setExportOpen(false)}
          onRequestSubmit={handleExportSvg}
        >
          <div className="icad-export-summary">
            <p>IBM conformance summary</p>
            <div className="icad-summary-counts">
              <Tag type="red">{counts.error} errors</Tag>
              <Tag type="warm-gray">{counts.warn} warnings</Tag>
              <Tag type="blue">{counts.info} info</Tag>
            </div>
            {diagnostics.length === 0 && <p className="icad-muted">Ready to export with no known issues.</p>}
            {diagnostics.length > 0 && exportGate === "warn" && (
              <p className="icad-muted">Advisory mode: export remains available with validation issues.</p>
            )}
            {exportBlocked && (
              <p className="icad-export-blocked">
                Export is blocked because the diagram has error-level diagnostics.
              </p>
            )}
            <Select
              id="icad-export-gate"
              labelText="Export gate"
              value={exportGate}
              onChange={(event) => {
                const gate = event.target.value as ExportGate;
                setExportGateState(gate);
                editorRef.current?.setExportGate(gate);
                setDiagnostics(editorRef.current?.lint() ?? []);
              }}
            >
              <SelectItem value="warn" text="Warn (advisory)" />
              <SelectItem value="block" text="Block on errors" />
            </Select>
          </div>
        </Modal>
      </div>
    </Theme>
  );
}
