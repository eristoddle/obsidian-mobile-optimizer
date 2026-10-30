// Unit tests for Profiler class
// Requirements: 2.1, 2.3, 2.6

import { Profiler, PluginMetric } from "./Profiler";

// ---------------------------------------------------------------------------
// Helpers: build a minimal mock App with configurable plugin registry
// ---------------------------------------------------------------------------

function makeApp(options: {
  manifests?: Record<string, { id: string; name: string }>;
  enabledPlugins?: Set<string>;
  pluginsAccessible?: boolean;
}) {
  if (options.pluginsAccessible === false) {
    // Simulate an app where .plugins throws or is undefined
    return {
      get plugins() {
        throw new Error("plugins not available");
      },
    } as any;
  }

  return {
    plugins: {
      manifests: options.manifests ?? {},
      enabledPlugins: options.enabledPlugins ?? new Set<string>(),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Helpers: mock the global `performance` object
// ---------------------------------------------------------------------------

function mockPerformance(options: {
  namedEntries?: Record<string, PerformanceEntry[]>;
  resourceEntries?: PerformanceEntry[];
}) {
  const originalPerformance = global.performance;

  const mock = {
    getEntriesByName: jest.fn((name: string) => {
      return options.namedEntries?.[name] ?? [];
    }),
    getEntriesByType: jest.fn((type: string) => {
      if (type === "resource") {
        return options.resourceEntries ?? [];
      }
      return [];
    }),
  };

  Object.defineProperty(global, "performance", {
    value: mock,
    writable: true,
    configurable: true,
  });

  return () => {
    Object.defineProperty(global, "performance", {
      value: originalPerformance,
      writable: true,
      configurable: true,
    });
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Profiler", () => {
  describe("collectMetrics()", () => {
    it("returns a PluginMetric for every entry in the manifest registry", () => {
      const restore = mockPerformance({});
      try {
        const app = makeApp({
          manifests: {
            "plugin-a": { id: "plugin-a", name: "Plugin A" },
            "plugin-b": { id: "plugin-b", name: "Plugin B" },
            "plugin-c": { id: "plugin-c", name: "Plugin C" },
          },
          enabledPlugins: new Set(["plugin-a"]),
        });

        const profiler = new Profiler(app);
        const metrics = profiler.collectMetrics();

        expect(metrics).toHaveLength(3);
        const ids = metrics.map((m) => m.pluginId);
        expect(ids).toContain("plugin-a");
        expect(ids).toContain("plugin-b");
        expect(ids).toContain("plugin-c");
      } finally {
        restore();
      }
    });

    it("sets loadTimeMs: null for plugins with no matching performance entry", () => {
      const restore = mockPerformance({
        namedEntries: {},
        resourceEntries: [],
      });
      try {
        const app = makeApp({
          manifests: {
            "my-plugin": { id: "my-plugin", name: "My Plugin" },
          },
          enabledPlugins: new Set(),
        });

        const profiler = new Profiler(app);
        const metrics = profiler.collectMetrics();

        expect(metrics).toHaveLength(1);
        expect(metrics[0].loadTimeMs).toBeNull();
      } finally {
        restore();
      }
    });

    it("sets enabled: true for plugins in the enabledPlugins set", () => {
      const restore = mockPerformance({});
      try {
        const app = makeApp({
          manifests: {
            "enabled-plugin": { id: "enabled-plugin", name: "Enabled Plugin" },
            "disabled-plugin": { id: "disabled-plugin", name: "Disabled Plugin" },
          },
          enabledPlugins: new Set(["enabled-plugin"]),
        });

        const profiler = new Profiler(app);
        const metrics = profiler.collectMetrics();

        const enabled = metrics.find((m) => m.pluginId === "enabled-plugin")!;
        const disabled = metrics.find((m) => m.pluginId === "disabled-plugin")!;

        expect(enabled.enabled).toBe(true);
        expect(disabled.enabled).toBe(false);
      } finally {
        restore();
      }
    });

    it("returns empty array when app.plugins is inaccessible", () => {
      const app = makeApp({ pluginsAccessible: false });
      const profiler = new Profiler(app);

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const metrics = profiler.collectMetrics();
      consoleSpy.mockRestore();

      expect(metrics).toEqual([]);
    });

    it("logs a warning when app.plugins is inaccessible", () => {
      const app = makeApp({ pluginsAccessible: false });
      const profiler = new Profiler(app);

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      profiler.collectMetrics();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[MobileOptimizer]"),
        expect.anything()
      );
      consoleSpy.mockRestore();
    });

    it("returns empty array when manifest registry is empty", () => {
      const restore = mockPerformance({});
      try {
        const app = makeApp({ manifests: {}, enabledPlugins: new Set() });
        const profiler = new Profiler(app);
        const metrics = profiler.collectMetrics();

        expect(metrics).toEqual([]);
      } finally {
        restore();
      }
    });

    it("uses empty Set for enabledPlugins when it is undefined in the registry", () => {
      const restore = mockPerformance({});
      try {
        // Simulate registry without enabledPlugins property
        const app = {
          plugins: {
            manifests: {
              "some-plugin": { id: "some-plugin", name: "Some Plugin" },
            },
            // enabledPlugins intentionally absent — Profiler should default to empty Set
          },
        } as any;

        const profiler = new Profiler(app);
        const metrics = profiler.collectMetrics();

        expect(metrics).toHaveLength(1);
        expect(metrics[0].enabled).toBe(false);
      } finally {
        restore();
      }
    });

    it("maps pluginName from manifest.name", () => {
      const restore = mockPerformance({});
      try {
        const app = makeApp({
          manifests: {
            "cool-plugin": { id: "cool-plugin", name: "Cool Plugin Display Name" },
          },
          enabledPlugins: new Set(),
        });

        const profiler = new Profiler(app);
        const [metric] = profiler.collectMetrics();

        expect(metric.pluginName).toBe("Cool Plugin Display Name");
        expect(metric.pluginId).toBe("cool-plugin");
      } finally {
        restore();
      }
    });
  });

  describe("refresh()", () => {
    it("returns the same result structure as collectMetrics()", () => {
      const restore = mockPerformance({});
      try {
        const app = makeApp({
          manifests: {
            "plugin-x": { id: "plugin-x", name: "Plugin X" },
          },
          enabledPlugins: new Set(["plugin-x"]),
        });

        const profiler = new Profiler(app);
        const fromCollect = profiler.collectMetrics();
        const fromRefresh = profiler.refresh();

        expect(fromRefresh).toEqual(fromCollect);
      } finally {
        restore();
      }
    });

    it("returns empty array when registry is inaccessible (same as collectMetrics)", () => {
      const app = makeApp({ pluginsAccessible: false });
      const profiler = new Profiler(app);

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const metrics = profiler.refresh();
      consoleSpy.mockRestore();

      expect(metrics).toEqual([]);
    });
  });
});
