// Unit tests for ConfigGenerator — task 8.1
// Requirements: 4.1, 4.2, 4.4, 4.6, 4.7, 4.8

import { ConfigGenerator } from "./ConfigGenerator";
import { CompatibilityEngine } from "./CompatibilityEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal `app` object whose `vault.adapter` can be configured
 * per-test via the returned `adapter` reference.
 */
function makeApp(adapterOverrides: Record<string, jest.Mock> = {}): {
  app: any;
  adapter: Record<string, jest.Mock>;
} {
  const adapter: Record<string, jest.Mock> = {
    exists: jest.fn().mockResolvedValue(false),
    mkdir: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
    read: jest.fn().mockResolvedValue(""),
    write: jest.fn().mockResolvedValue(undefined),
    copy: jest.fn().mockResolvedValue(undefined),
    ...adapterOverrides,
  };

  const app = { vault: { adapter } };
  return { app, adapter };
}

/**
 * Builds a ConfigGenerator with a fresh CompatibilityEngine.
 */
function makeGenerator(app: any): ConfigGenerator {
  const engine = new CompatibilityEngine();
  return new ConfigGenerator(app, engine);
}

// ---------------------------------------------------------------------------
// generate() — source folder missing (Requirement 4.8)
// ---------------------------------------------------------------------------

describe("ConfigGenerator.generate()", () => {
  it("shows error notice and does NOT write when .obsidian is missing", async () => {
    const { app, adapter } = makeApp({
      exists: jest.fn().mockResolvedValue(false), // .obsidian not found
    });

    const gen = makeGenerator(app);
    const onProgress = jest.fn();

    await gen.generate(onProgress);

    // No write/mkdir should have been attempted.
    expect(adapter.mkdir).not.toHaveBeenCalled();
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.copy).not.toHaveBeenCalled();

    // onProgress must NOT have been called (we aborted before start).
    expect(onProgress).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // generate() — .obsidian.mobile exists and user cancels (Requirement 4.4)
  // ---------------------------------------------------------------------------

  it("aborts silently when .obsidian.mobile exists and user cancels overwrite", async () => {
    // Both .obsidian (src) and .obsidian.mobile (dest) exist.
    const { app, adapter } = makeApp({
      exists: jest.fn().mockResolvedValue(true),
    });

    const gen = makeGenerator(app);
    const onProgress = jest.fn();

    // The OverwriteConfirmModal will be constructed.  We mock its promise to
    // resolve `false` (user cancelled) without rendering real DOM.
    //
    // We intercept by monkey-patching the private `confirmOverwrite` method.
    (gen as any).confirmOverwrite = jest.fn().mockResolvedValue(false);

    await gen.generate(onProgress);

    expect(adapter.mkdir).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // generate() — .obsidian.mobile exists and user confirms (Requirement 4.4)
  // ---------------------------------------------------------------------------

  it("proceeds when .obsidian.mobile exists and user confirms overwrite", async () => {
    const { app, adapter } = makeApp({
      exists: jest.fn().mockResolvedValue(true),
      list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
    });

    const gen = makeGenerator(app);
    (gen as any).confirmOverwrite = jest.fn().mockResolvedValue(true);
    (gen as any).patchCommunityPlugins = jest.fn().mockResolvedValue(undefined);

    const onProgress = jest.fn();
    await gen.generate(onProgress);

    expect(onProgress).toHaveBeenCalledWith("start");
    expect(onProgress).toHaveBeenCalledWith("done");
    expect(adapter.mkdir).toHaveBeenCalledWith(".obsidian.mobile");
  });

  // ---------------------------------------------------------------------------
  // generate() — happy path, no existing dest (Requirement 4.2)
  // ---------------------------------------------------------------------------

  it("calls onProgress('start') then onProgress('done') on success", async () => {
    const { app, adapter } = makeApp({
      exists: jest
        .fn()
        .mockResolvedValueOnce(true)  // .obsidian exists
        .mockResolvedValueOnce(false), // .obsidian.mobile does not exist
      list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
    });

    const gen = makeGenerator(app);
    (gen as any).patchCommunityPlugins = jest.fn().mockResolvedValue(undefined);

    const onProgress = jest.fn();
    await gen.generate(onProgress);

    expect(onProgress).toHaveBeenNthCalledWith(1, "start");
    expect(onProgress).toHaveBeenNthCalledWith(2, "done");
  });

  // ---------------------------------------------------------------------------
  // generate() — I/O error during copy signals "error" (Requirement 4.6)
  // ---------------------------------------------------------------------------

  it("calls onProgress('error') when copyRecursive throws", async () => {
    const { app } = makeApp({
      exists: jest
        .fn()
        .mockResolvedValueOnce(true)  // .obsidian exists
        .mockResolvedValueOnce(false), // no existing dest
      mkdir: jest.fn().mockRejectedValue(new Error("disk full")),
    });

    const gen = makeGenerator(app);
    const onProgress = jest.fn();
    await gen.generate(onProgress);

    expect(onProgress).toHaveBeenCalledWith("start");
    expect(onProgress).toHaveBeenCalledWith("error");
    expect(onProgress).not.toHaveBeenCalledWith("done");
  });
});

// ---------------------------------------------------------------------------
// copyRecursive — file copying via adapter.copy (Requirement 4.2)
// ---------------------------------------------------------------------------

describe("ConfigGenerator copyRecursive", () => {
  it("calls adapter.mkdir on the destination path", async () => {
    const { app, adapter } = makeApp({
      exists: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
    });

    const gen = makeGenerator(app);
    (gen as any).patchCommunityPlugins = jest.fn().mockResolvedValue(undefined);
    await gen.generate(jest.fn());

    expect(adapter.mkdir).toHaveBeenCalledWith(".obsidian.mobile");
  });

  it("copies each file via adapter.copy when available", async () => {
    const { app, adapter } = makeApp({
      exists: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      list: jest.fn().mockResolvedValue({
        files: [".obsidian/app.json", ".obsidian/workspace.json"],
        folders: [],
      }),
    });

    const gen = makeGenerator(app);
    (gen as any).patchCommunityPlugins = jest.fn().mockResolvedValue(undefined);
    await gen.generate(jest.fn());

    expect(adapter.copy).toHaveBeenCalledWith(
      ".obsidian/app.json",
      ".obsidian.mobile/app.json"
    );
    expect(adapter.copy).toHaveBeenCalledWith(
      ".obsidian/workspace.json",
      ".obsidian.mobile/workspace.json"
    );
  });

  it("falls back to read+write when adapter.copy is not a function", async () => {
    const { app, adapter } = makeApp({
      exists: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      list: jest.fn().mockResolvedValue({
        files: [".obsidian/app.json"],
        folders: [],
      }),
      read: jest.fn().mockResolvedValue('{"test":1}'),
    });

    // Remove the copy method to trigger fallback.
    delete (adapter as any).copy;

    const gen = makeGenerator(app);
    (gen as any).patchCommunityPlugins = jest.fn().mockResolvedValue(undefined);
    await gen.generate(jest.fn());

    expect(adapter.read).toHaveBeenCalledWith(".obsidian/app.json");
    expect(adapter.write).toHaveBeenCalledWith(
      ".obsidian.mobile/app.json",
      '{"test":1}'
    );
  });

  it("recurses into sub-folders", async () => {
    const { app, adapter } = makeApp({
      exists: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      list: jest
        .fn()
        // First call: root .obsidian
        .mockResolvedValueOnce({
          files: [],
          folders: [".obsidian/plugins"],
        })
        // Second call: .obsidian/plugins sub-folder
        .mockResolvedValueOnce({
          files: [".obsidian/plugins/community-plugins.json"],
          folders: [],
        }),
    });

    const gen = makeGenerator(app);
    (gen as any).patchCommunityPlugins = jest.fn().mockResolvedValue(undefined);
    await gen.generate(jest.fn());

    // mkdir called for both root dest and sub-folder dest.
    expect(adapter.mkdir).toHaveBeenCalledWith(".obsidian.mobile");
    expect(adapter.mkdir).toHaveBeenCalledWith(".obsidian.mobile/plugins");

    expect(adapter.copy).toHaveBeenCalledWith(
      ".obsidian/plugins/community-plugins.json",
      ".obsidian.mobile/plugins/community-plugins.json"
    );
  });

  // ---------------------------------------------------------------------------
  // Error notice includes failing path (Requirement 4.6)
  // ---------------------------------------------------------------------------

  it("includes the failing file path in the error Notice", async () => {
    const { app } = makeApp({
      exists: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      list: jest.fn().mockResolvedValue({
        files: [".obsidian/broken.json"],
        folders: [],
      }),
      copy: jest
        .fn()
        .mockRejectedValue(new Error("permission denied")),
    });

    const gen = makeGenerator(app);
    (gen as any).patchCommunityPlugins = jest.fn().mockResolvedValue(undefined);

    // Spy on the Notice constructor via the obsidian mock module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const noticeSpy = jest.spyOn(require("obsidian"), "Notice");

    await gen.generate(jest.fn());

    const calls: string[] = noticeSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const errorNotice = calls.find((m: string) =>
      m.includes(".obsidian/broken.json")
    );
    expect(errorNotice).toBeDefined();
    expect(errorNotice).toContain("permission denied");
  });
});

// ---------------------------------------------------------------------------
// patchCommunityPlugins — called via (generator as any) (Requirements 4.3, 4.8)
// ---------------------------------------------------------------------------

describe("ConfigGenerator patchCommunityPlugins", () => {
  // -------------------------------------------------------------------------
  // Creates [] when community-plugins.json is absent (Requirement 4.3)
  // -------------------------------------------------------------------------

  it("writes [] when community-plugins.json does not exist in dest", async () => {
    const { app, adapter } = makeApp({
      exists: jest.fn().mockResolvedValue(false), // file missing
    });

    const gen = makeGenerator(app);
    await (gen as any).patchCommunityPlugins(".obsidian.mobile");

    expect(adapter.write).toHaveBeenCalledWith(
      ".obsidian.mobile/community-plugins.json",
      "[]"
    );
  });

  // -------------------------------------------------------------------------
  // Removes Red IDs and preserves Green/Yellow IDs (Requirement 4.3)
  // -------------------------------------------------------------------------

  it("removes Red plugin IDs and preserves Green and unknown (Yellow) IDs", async () => {
    // "dataview" and "obsidian-git" are Red; "calendar" is Green; "my-plugin" is unknown/Yellow.
    const sourceIds = ["dataview", "calendar", "obsidian-git", "my-plugin"];

    const { app, adapter } = makeApp({
      exists: jest.fn().mockResolvedValue(true),
      read: jest.fn().mockResolvedValue(JSON.stringify(sourceIds)),
    });

    const gen = makeGenerator(app);
    await (gen as any).patchCommunityPlugins(".obsidian.mobile");

    expect(adapter.write).toHaveBeenCalledWith(
      ".obsidian.mobile/community-plugins.json",
      JSON.stringify(["calendar", "my-plugin"])
    );
  });

  it("preserves the relative order of remaining IDs after filtering Reds", async () => {
    // "omnisearch" and "surfing" are Red; the rest are Green or unknown.
    const sourceIds = ["quickadd", "omnisearch", "templater-obsidian", "surfing", "nldates-obsidian"];

    const { app, adapter } = makeApp({
      exists: jest.fn().mockResolvedValue(true),
      read: jest.fn().mockResolvedValue(JSON.stringify(sourceIds)),
    });

    const gen = makeGenerator(app);
    await (gen as any).patchCommunityPlugins(".obsidian.mobile");

    const written = JSON.parse(
      adapter.write.mock.calls[0][1] as string
    ) as string[];
    // Red IDs must be gone; remaining order must match source order.
    expect(written).toEqual(["quickadd", "templater-obsidian", "nldates-obsidian"]);
  });

  // -------------------------------------------------------------------------
  // Shows error notification and stops on invalid JSON (Requirement 4.3)
  // -------------------------------------------------------------------------

  it("shows error Notice and does NOT write when community-plugins.json contains invalid JSON", async () => {
    const { app, adapter } = makeApp({
      exists: jest.fn().mockResolvedValue(true),
      read: jest.fn().mockResolvedValue("this is not valid json }{"),
    });

    const gen = makeGenerator(app);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const noticeSpy = jest.spyOn(require("obsidian"), "Notice");
    noticeSpy.mockClear();

    await (gen as any).patchCommunityPlugins(".obsidian.mobile");

    // No write should have occurred after a parse failure.
    expect(adapter.write).not.toHaveBeenCalled();

    // An error Notice mentioning the file path must have been shown.
    const calls: string[] = noticeSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const errorNotice = calls.find((m: string) =>
      m.includes(".obsidian.mobile/community-plugins.json")
    );
    expect(errorNotice).toBeDefined();
  });
});
