import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", async () => await import("./testUtils/fakeVscode.js"));

const { Uri, workspace } = await import("./testUtils/fakeVscode.js");
const { IcadDocument } = await import("./icadDocument.js");

const encoder = new TextEncoder();

beforeEach(() => {
  vi.mocked(workspace.fs.readFile).mockReset();
  vi.mocked(workspace.fs.writeFile).mockReset();
});

describe("IcadDocument", () => {
  it("reads its initial content from the document uri", async () => {
    const uri = Uri.file("/diagrams/a.icad");
    vi.mocked(workspace.fs.readFile).mockResolvedValueOnce(
      encoder.encode('{"format":"icad"}'),
    );

    const document = await IcadDocument.create(uri as never);

    expect(workspace.fs.readFile).toHaveBeenCalledWith(uri);
    expect(document.latestContent).toBe('{"format":"icad"}');
  });

  it("reads from the backup uri instead of the document uri when restoring after a crash", async () => {
    const uri = Uri.file("/diagrams/a.icad");
    vi.mocked(workspace.fs.readFile).mockResolvedValueOnce(
      encoder.encode('{"format":"icad","backup":true}'),
    );

    const document = await IcadDocument.create(
      uri as never,
      "file:///backups/a-1.icad",
    );

    const [readUri] = vi.mocked(workspace.fs.readFile).mock.calls[0]!;
    expect((readUri as InstanceType<typeof Uri>).fsPath).toBe(
      "/backups/a-1.icad",
    );
    expect(document.latestContent).toBe('{"format":"icad","backup":true}');
  });

  it("applyEdit updates latestContent and notifies listeners", async () => {
    vi.mocked(workspace.fs.readFile).mockResolvedValueOnce(
      encoder.encode("{}"),
    );
    const document = await IcadDocument.create(Uri.file("/a.icad") as never);

    const received: string[] = [];
    document.onDidChangeContent((edit) => received.push(edit.content));

    document.applyEdit({ content: '{"v":1}', label: "Add box" });

    expect(document.latestContent).toBe('{"v":1}');
    expect(received).toEqual(['{"v":1}']);
  });

  it("revert re-reads from the original uri and updates latestContent", async () => {
    const uri = Uri.file("/a.icad");
    vi.mocked(workspace.fs.readFile).mockResolvedValueOnce(
      encoder.encode("{}"),
    );
    const document = await IcadDocument.create(uri as never);
    document.applyEdit({ content: '{"v":1}', label: "Add box" });

    vi.mocked(workspace.fs.readFile).mockResolvedValueOnce(
      encoder.encode('{"onDisk":true}'),
    );
    const result = await document.revert();

    expect(result).toBe('{"onDisk":true}');
    expect(document.latestContent).toBe('{"onDisk":true}');
  });

  it("writeTo writes the current content to the given uri", async () => {
    vi.mocked(workspace.fs.readFile).mockResolvedValueOnce(
      encoder.encode("{}"),
    );
    const document = await IcadDocument.create(Uri.file("/a.icad") as never);
    document.applyEdit({ content: '{"v":2}', label: "Move" });

    const target = Uri.file("/copy.icad");
    await document.writeTo(target as never);

    expect(workspace.fs.writeFile).toHaveBeenCalledWith(
      target,
      encoder.encode('{"v":2}'),
    );
  });
});
