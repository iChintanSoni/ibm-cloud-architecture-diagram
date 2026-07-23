import { ActionableNotification, Button, Tag, Theme } from "@carbon/react";
import { createEditor, type Diagnostic, type Editor } from "@icad/core";
import { useEffect, useRef, useState } from "react";
import { createIbmCloudCatalog } from "./catalog";
import { clearDraft, debounceAutosave, loadDraft, saveDraft } from "./persistence/autosave";
import { openIcadFile, saveIcadFile, supportsFileSystemAccess } from "./persistence/fileSystem";
import { type ThemePreference, useResolvedTheme } from "./useResolvedTheme";

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

  const handleExportSvg = () => {
    const svg = editorRef.current?.export({ format: "svg" });
    if (typeof svg === "string") download("diagram.svg", svg, "image/svg+xml");
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
            <Button kind="primary" size="sm" onClick={handleExportSvg}>
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
            <h2>Validation</h2>
            {diagnostics.length === 0 && <p className="icad-muted">No conformance issues found.</p>}
            <ul>
              {diagnostics.map((d) => (
                <li key={d.id}>
                  <Tag type={d.severity === "error" ? "red" : d.severity === "warn" ? "warm-gray" : "blue"}>
                    {d.severity}
                  </Tag>
                  <span>{d.message}</span>
                  {d.quickFix && (
                    <Button
                      kind="ghost"
                      size="sm"
                      onClick={() => {
                        editorRef.current!.commands.dispatch(d.quickFix!);
                        setDiagnostics(editorRef.current!.lint());
                      }}
                    >
                      Fix
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </Theme>
  );
}
