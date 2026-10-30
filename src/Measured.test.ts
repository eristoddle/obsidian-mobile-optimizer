// Unit tests for the measurement-based pieces: rating from measured costs,
// IndexedDB → plugin attribution, and the lean mobile config copy.

import { CompatibilityEngine } from "./CompatibilityEngine";
import { ConfigGenerator } from "./ConfigGenerator";
import { matchDbToPlugin } from "./Profiler";

// ---------------------------------------------------------------------------
// CompatibilityEngine.rate()
// ---------------------------------------------------------------------------

describe("CompatibilityEngine.rate()", () => {
  const engine = new CompatibilityEngine();

  it("rates a slow-loading unknown plugin red, with the reason", () => {
    expect(engine.rate({ pluginId: "x", loadTimeMs: 128 })).toEqual({
      rating: "red",
      reasons: ["128 ms load"],
    });
  });

  it("rates a huge bundle red", () => {
    expect(engine.rate({ pluginId: "x", bundleKB: 4241 }).rating).toBe("red");
  });

  it("rates a large stored index red", () => {
    expect(engine.rate({ pluginId: "x", storageMB: 400 }).rating).toBe("red");
  });

  it("rates moderate costs yellow", () => {
    expect(engine.rate({ pluginId: "x", loadTimeMs: 40, bundleKB: 100 }).rating).toBe(
      "yellow"
    );
  });

  it("rates a measured, cheap plugin green", () => {
    expect(
      engine.rate({ pluginId: "x", loadTimeMs: 1, bundleKB: 34, storageMB: 0 })
    ).toEqual({ rating: "green", reasons: [] });
  });

  it("keeps a known-heavy plugin red even when it measured fast", () => {
    const r = engine.rate({ pluginId: "omnisearch", loadTimeMs: 2, bundleKB: 50 });
    expect(r.rating).toBe("red");
    expect(r.reasons).toContain("known mobile-heavy");
  });

  it("falls back to the hardcoded database when nothing was measured", () => {
    expect(engine.rate({ pluginId: "calendar" }).rating).toBe("green");
    expect(engine.rate({ pluginId: "unknown" }).rating).toBe("yellow");
  });
});

// ---------------------------------------------------------------------------
// matchDbToPlugin()
// ---------------------------------------------------------------------------

describe("matchDbToPlugin()", () => {
  const ids = [
    "omnisearch",
    "dataview",
    "obsidian-excalidraw-plugin",
    "notebook-navigator",
  ];

  it.each([
    ["omnisearch/cache/43a02d8f27e2d3ad", "omnisearch"],
    ["dataview/cache/0badbb5a149c223a", "dataview"],
    ["Excalidraw 254dd4c91fbc5a80", "obsidian-excalidraw-plugin"],
    ["notebooknavigator/icons/254dd4c91fbc5a80", "notebook-navigator"],
  ])("attributes %s to %s", (db, id) => {
    expect(matchDbToPlugin(db, ids)).toBe(id);
  });

  it.each(["43a02d8f27e2d3ad-cache", "keyval-store", "remotelysavedb"])(
    "does not attribute %s to any installed plugin",
    (db) => {
      expect(matchDbToPlugin(db, ids)).toBeNull();
    }
  );
});

// ---------------------------------------------------------------------------
// ConfigGenerator — lean copy
// ---------------------------------------------------------------------------

/** In-memory folder tree for adapter.list(). */
function makeTreeApp(tree: Record<string, { files: string[]; folders: string[] }>, manifests: Record<string, string> = {}) {
  const adapter = {
    exists: jest.fn(async (p: string) => p === ".obsidian" || p.endsWith("/community-plugins.json")),
    mkdir: jest.fn(async (_p: string) => undefined),
    list: jest.fn(async (p: string) => tree[p] ?? { files: [], folders: [] }),
    read: jest.fn(async (p: string) => {
      if (p in manifests) return manifests[p];
      if (p.endsWith("community-plugins.json")) return '["dataview","my-plugin"]';
      throw new Error("not found");
    }),
    write: jest.fn(async (_p: string, _d: string) => undefined),
    copy: jest.fn(async (_from: string, _to: string) => undefined),
  };
  return { app: { vault: { adapter, configDir: ".obsidian" } }, adapter };
}

describe("ConfigGenerator lean copy", () => {
  const tree = {
    ".obsidian": {
      files: [".obsidian/app.json", ".obsidian/community-plugins.json", ".obsidian/.DS_Store"],
      folders: [".obsidian/plugins"],
    },
    ".obsidian/plugins": {
      files: [],
      folders: [".obsidian/plugins/plugin-task-manager", ".obsidian/plugins/dataview"],
    },
    ".obsidian/plugins/plugin-task-manager": {
      files: [
        ".obsidian/plugins/plugin-task-manager/main.js",
        ".obsidian/plugins/plugin-task-manager/manifest.json",
        ".obsidian/plugins/plugin-task-manager/package.json",
        ".obsidian/plugins/plugin-task-manager/tsconfig.json",
      ],
      folders: [
        ".obsidian/plugins/plugin-task-manager/node_modules",
        ".obsidian/plugins/plugin-task-manager/.git",
        ".obsidian/plugins/plugin-task-manager/src",
      ],
    },
    ".obsidian/plugins/dataview": {
      files: [".obsidian/plugins/dataview/main.js", ".obsidian/plugins/dataview/manifest.json"],
      folders: [],
    },
  };
  const manifests = {
    ".obsidian/plugins/plugin-task-manager/manifest.json": '{"id":"my-plugin"}',
    ".obsidian/plugins/dataview/manifest.json": '{"id":"dataview"}',
  };

  async function run() {
    const { app, adapter } = makeTreeApp(tree, manifests);
    const ratings = new Map([
      ["dataview", "red" as const],
      ["my-plugin", "green" as const],
    ]);
    const gen = new ConfigGenerator(app as any, new CompatibilityEngine(), ratings);
    await gen.generate(() => undefined);
    return { copied: adapter.copy.mock.calls.map((c) => c[0]), adapter };
  }

  it("copies only a plugin's runtime files", async () => {
    const { copied } = await run();
    expect(copied).toContain(".obsidian/plugins/plugin-task-manager/main.js");
    expect(copied).toContain(".obsidian/plugins/plugin-task-manager/manifest.json");
    expect(copied).not.toContain(".obsidian/plugins/plugin-task-manager/package.json");
  });

  it("never descends into node_modules, .git or src", async () => {
    const { adapter } = await run();
    const listed = adapter.list.mock.calls.map((c) => c[0]);
    expect(listed.some((p: string) => /node_modules|\.git|\/src$/.test(p))).toBe(false);
  });

  it("skips red plugins' folders entirely, matched by manifest id", async () => {
    const { copied } = await run();
    expect(copied.some((p: string) => p.includes("/dataview/"))).toBe(false);
  });

  it("skips .DS_Store", async () => {
    const { copied } = await run();
    expect(copied).not.toContain(".obsidian/.DS_Store");
  });

  it("removes measured-red plugins from community-plugins.json", async () => {
    const { adapter } = await run();
    expect(adapter.write).toHaveBeenCalledWith(
      ".obsidian.mobile/community-plugins.json",
      '["my-plugin"]'
    );
  });
});

describe("ConfigGenerator with an explicit keep set", () => {
  it("keeps a red plugin the user checked and drops a green one they unchecked", async () => {
    const tree = {
      ".obsidian": { files: [".obsidian/community-plugins.json"], folders: [".obsidian/plugins"] },
      ".obsidian/plugins": {
        files: [],
        folders: [".obsidian/plugins/remotely-save", ".obsidian/plugins/calendar"],
      },
      ".obsidian/plugins/remotely-save": { files: [".obsidian/plugins/remotely-save/main.js"], folders: [] },
      ".obsidian/plugins/calendar": { files: [".obsidian/plugins/calendar/main.js"], folders: [] },
    };
    const { app, adapter } = makeTreeApp(tree, {
      ".obsidian/plugins/remotely-save/manifest.json": '{"id":"remotely-save"}',
      ".obsidian/plugins/calendar/manifest.json": '{"id":"calendar"}',
    });
    adapter.read.mockImplementation(async (p: string) => {
      if (p.endsWith("remotely-save/manifest.json")) return '{"id":"remotely-save"}';
      if (p.endsWith("calendar/manifest.json")) return '{"id":"calendar"}';
      if (p.endsWith("community-plugins.json")) return '["remotely-save","calendar"]';
      throw new Error("not found");
    });
    const gen = new ConfigGenerator(
      app as any,
      new CompatibilityEngine(),
      new Map([["remotely-save", "red" as const], ["calendar", "green" as const]]),
      new Set(["remotely-save"])
    );
    await gen.generate(() => undefined);

    const copied = adapter.copy.mock.calls.map((c) => c[0]);
    expect(copied).toContain(".obsidian/plugins/remotely-save/main.js");
    expect(copied).not.toContain(".obsidian/plugins/calendar/main.js");
    expect(adapter.write).toHaveBeenCalledWith(
      ".obsidian.mobile/community-plugins.json",
      '["remotely-save"]'
    );
  });
});

