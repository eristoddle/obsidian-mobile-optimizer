/**
 * @jest-environment jsdom
 */
// Unit tests for renderTrafficLight and renderPluginList — task 6.2
// Feature: obsidian-mobile-optimizer
// Requirements: 1.3, 1.5, 3.5

import { DashboardView, MobileOptimizerPluginHost } from "./DashboardView";
import { CompatibilityRating } from "./CompatibilityEngine";
import { PluginMetric } from "./Profiler";

// ---------------------------------------------------------------------------
// Patch Obsidian DOM helpers onto HTMLElement so the jsdom environment mirrors
// the Obsidian runtime without pulling in the full Obsidian bundle.
// ---------------------------------------------------------------------------
function patchObsidianDom(): void {
  // createEl(tag, opts?) — creates a child element and appends it.
  (HTMLElement.prototype as any).createEl = function <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: { text?: string; cls?: string; attr?: Record<string, string> }
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag) as HTMLElementTagNameMap[K];
    if (opts?.text) el.textContent = opts.text;
    if (opts?.cls) el.className = opts.cls;
    if (opts?.attr) {
      for (const [k, v] of Object.entries(opts.attr)) {
        (el as HTMLElement).setAttribute(k, v);
      }
    }
    this.appendChild(el);
    return el;
  };

  // empty() — removes all children.
  (HTMLElement.prototype as any).empty = function (): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  };

  (HTMLElement.prototype as any).createDiv = function (opts?: { cls?: string }) {
    return this.createEl("div", opts);
  };

  (HTMLElement.prototype as any).addClass = function (cls: string): void {
    this.classList.add(cls);
  };
}

patchObsidianDom();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetric(
  overrides: Partial<PluginMetric> & { rating: CompatibilityRating }
): PluginMetric {
  return {
    pluginId: overrides.pluginId ?? "test-plugin",
    pluginName: overrides.pluginName ?? "Test Plugin",
    loadTimeMs: overrides.loadTimeMs !== undefined ? overrides.loadTimeMs : 10,
    enabled: overrides.enabled ?? true,
    bundleKB: overrides.bundleKB,
    storageMB: overrides.storageMB,
    heapDeltaMB: overrides.heapDeltaMB,
    rating: overrides.rating,
    reasons: overrides.reasons,
  };
}

/** Host whose engine passes each metric's preset rating/reasons through. */
function makePluginHost(
  metrics: PluginMetric[],
  profilerOverrides: Record<string, unknown> = {}
): MobileOptimizerPluginHost {
  return {
    profiler: {
      collectMetrics: () => metrics,
      refresh: () => metrics,
      scan: async () => metrics,
      measure: async () => metrics,
      ...profilerOverrides,
    } as any,
    compatEngine: {
      classify: (id: string) =>
        metrics.find((x) => x.pluginId === id)?.rating ?? "yellow",
      rate: (m: PluginMetric) => ({
        rating: m.rating ?? "yellow",
        reasons: m.reasons ?? [],
      }),
    } as any,
  };
}

function makeDashboardView(metrics: PluginMetric[]): DashboardView {
  return new DashboardView({} as any, makePluginHost(metrics));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Cells of the first body row: [light, name, load, bundle, stored, memory]. */
function firstRowCells(view: DashboardView): string[] {
  return Array.from(view.contentEl.querySelectorAll("tbody tr:first-child td")).map(
    (td) => td.textContent ?? ""
  );
}

function button(view: DashboardView, text: string): HTMLButtonElement {
  return Array.from(view.contentEl.querySelectorAll("button")).find(
    (b) => b.textContent === text
  ) as HTMLButtonElement;
}

// ---------------------------------------------------------------------------
// renderTrafficLight — tested via onOpen() DOM output
// ---------------------------------------------------------------------------

describe("renderTrafficLight", () => {
  const cases: [CompatibilityRating, string, string][] = [
    ["red", "traffic-red", "Red \u2013 high risk"],
    ["yellow", "traffic-yellow", "Yellow \u2013 moderate or unknown"],
    ["green", "traffic-green", "Green \u2013 light"],
  ];

  test.each(cases)(
    "rating=%s → CSS class '%s' and aria-label '%s'",
    async (rating, expectedClass, expectedLabel) => {
      const view = makeDashboardView([makeMetric({ rating })]);
      await view.onOpen();

      const span = view.contentEl.querySelector(`span.${expectedClass}`);
      expect(span).not.toBeNull();
      expect(span?.getAttribute("aria-label")).toBe(expectedLabel);
    }
  );

  it("creates exactly one span per plugin row", async () => {
    const view = makeDashboardView([
      makeMetric({ pluginId: "a", rating: "red" }),
      makeMetric({ pluginId: "b", rating: "yellow" }),
      makeMetric({ pluginId: "c", rating: "green" }),
    ]);
    await view.onOpen();

    expect(view.contentEl.querySelectorAll("span[aria-label]").length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// renderPluginList — structure and content
// ---------------------------------------------------------------------------

describe("renderPluginList", () => {
  it("renders Name, Load, Bundle, Stored and Memory columns", async () => {
    const view = makeDashboardView([makeMetric({ rating: "green" })]);
    await view.onOpen();

    const headers = Array.from(view.contentEl.querySelectorAll("th")).map(
      (th) => th.textContent
    );
    expect(headers).toEqual(["", "Name", "Load", "Bundle", "Stored", "Memory"]);
  });

  it("renders one row per metric", async () => {
    const view = makeDashboardView([
      makeMetric({ pluginId: "a", pluginName: "Alpha", rating: "green" }),
      makeMetric({ pluginId: "b", pluginName: "Beta", rating: "yellow" }),
      makeMetric({ pluginId: "c", pluginName: "Gamma", rating: "red" }),
    ]);
    await view.onOpen();

    expect(view.contentEl.querySelectorAll("tbody tr").length).toBe(3);
  });

  it("shows measured numbers, not dashes", async () => {
    const view = makeDashboardView([
      makeMetric({
        rating: "red",
        pluginName: "Dataview",
        loadTimeMs: 128,
        bundleKB: 1272,
        storageMB: 3.2,
        heapDeltaMB: 4.1,
      }),
    ]);
    await view.onOpen();

    expect(firstRowCells(view).slice(1)).toEqual([
      "Dataview",
      "128 ms",
      "1.2 MB",
      "3.2 MB",
      "4.1 MB",
    ]);
  });

  it("shows a dash only for what has not been measured", async () => {
    const view = makeDashboardView([
      makeMetric({ rating: "yellow", loadTimeMs: null, bundleKB: 34 }),
    ]);
    await view.onOpen();

    const cells = firstRowCells(view);
    expect(cells[2]).toBe("\u2014");
    expect(cells[3]).toBe("34 KB");
  });

  it("shows 'off' as the load time of a disabled plugin", async () => {
    const view = makeDashboardView([
      makeMetric({ rating: "yellow", enabled: false, loadTimeMs: null }),
    ]);
    await view.onOpen();

    expect(firstRowCells(view)[2]).toBe("off");
  });

  it("lists the worst-rated plugin first", async () => {
    const view = makeDashboardView([
      makeMetric({ pluginId: "a", pluginName: "Light", rating: "green" }),
      makeMetric({ pluginId: "b", pluginName: "Heavy", rating: "red" }),
    ]);
    await view.onOpen();

    expect(firstRowCells(view)[1]).toBe("Heavy");
  });

  it("puts the rating reasons on the name cell's tooltip", async () => {
    const view = makeDashboardView([
      makeMetric({ rating: "red", reasons: ["3.6 MB bundle"] }),
    ]);
    await view.onOpen();

    const name = view.contentEl.querySelectorAll("tbody tr td")[1];
    expect(name.getAttribute("title")).toBe("3.6 MB bundle");
  });

  // --- Controls ---

  it("renders Measure and Generate buttons", async () => {
    const view = makeDashboardView([]);
    await view.onOpen();

    const labels = Array.from(view.contentEl.querySelectorAll("button")).map(
      (b) => b.textContent
    );
    expect(labels).toEqual(["Measure load times", "Generate Mobile Config"]);
  });

  it("Measure runs the profiler's active pass and shows its load times", async () => {
    const before = [makeMetric({ rating: "yellow", loadTimeMs: null })];
    const after = [makeMetric({ rating: "red", loadTimeMs: 128 })];
    const measure = jest.fn(async () => after);
    const view = new DashboardView({} as any, makePluginHost(before, { measure }));
    await view.onOpen();

    button(view, "Measure load times").click();
    await flush();

    expect(measure).toHaveBeenCalledTimes(1);
    expect(firstRowCells(view)[2]).toBe("128 ms");
  });
});

// ---------------------------------------------------------------------------
// renderRecommendationsTo — unit tests for task 6.3
// Requirements: 3.6, 3.7
// ---------------------------------------------------------------------------

import { renderRecommendationsTo } from "./DashboardView";

describe("renderRecommendationsTo", () => {
  function makeContainer(): HTMLElement {
    return document.createElement("div");
  }

  it("renders a 'Recommendations' heading", () => {
    const container = makeContainer();
    renderRecommendationsTo(container, []);

    const heading = container.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Recommendations");
  });

  it("renders 'No high-risk plugins detected' when no red plugins", () => {
    const container = makeContainer();
    renderRecommendationsTo(container, []);

    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("No high-risk plugins detected");
  });

  it("does not render a list when no red plugins", () => {
    const container = makeContainer();
    renderRecommendationsTo(container, []);

    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("li")).toBeNull();
  });

  it("renders a list item per red plugin", () => {
    const redPlugins: PluginMetric[] = [
      makeMetric({ pluginId: "dataview", pluginName: "Dataview", rating: "red" }),
      makeMetric({ pluginId: "omnisearch", pluginName: "Omnisearch", rating: "red" }),
    ];
    const container = makeContainer();
    renderRecommendationsTo(container, redPlugins);

    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
  });

  it("each list item recommends disabling the plugin on mobile", () => {
    const redPlugins: PluginMetric[] = [
      makeMetric({ pluginId: "dataview", pluginName: "Dataview", rating: "red" }),
    ];
    const container = makeContainer();
    renderRecommendationsTo(container, redPlugins);

    const item = container.querySelector("li");
    expect(item?.textContent).toBe("Disable Dataview on mobile");
  });

  it("does not render 'No high-risk plugins detected' when red plugins exist", () => {
    const redPlugins: PluginMetric[] = [
      makeMetric({ pluginId: "dataview", pluginName: "Dataview", rating: "red" }),
    ];
    const container = makeContainer();
    renderRecommendationsTo(container, redPlugins);

    const p = container.querySelector("p");
    expect(p).toBeNull();
  });

  it("renders one list item per red plugin with correct names", () => {
    const redPlugins: PluginMetric[] = [
      makeMetric({ pluginId: "obsidian-git", pluginName: "Obsidian Git", rating: "red" }),
      makeMetric({ pluginId: "surfing", pluginName: "Surfing", rating: "red" }),
      makeMetric({ pluginId: "dataview", pluginName: "Dataview", rating: "red" }),
    ];
    const container = makeContainer();
    renderRecommendationsTo(container, redPlugins);

    const items = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toContain("Disable Obsidian Git on mobile");
    expect(items).toContain("Disable Surfing on mobile");
    expect(items).toContain("Disable Dataview on mobile");
    expect(items.length).toBe(3);
  });

  it("recommendations appear in DashboardView after onOpen()", async () => {
    const redMetric = makeMetric({ pluginId: "dataview", pluginName: "Dataview", rating: "red" });
    const view = makeDashboardView([redMetric]);
    await view.onOpen();

    const heading = Array.from(view.contentEl.querySelectorAll("h2")).find(
      (h) => h.textContent === "Recommendations"
    );
    expect(heading).not.toBeNull();

    const items = view.contentEl.querySelectorAll("li");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].textContent).toBe("Disable Dataview on mobile");
  });

  it("'No high-risk plugins detected' appears in DashboardView when no red plugins", async () => {
    const greenMetric = makeMetric({ pluginId: "calendar", pluginName: "Calendar", rating: "green" });
    const view = makeDashboardView([greenMetric]);
    await view.onOpen();

    const paras = Array.from(view.contentEl.querySelectorAll("p")).map((p) => p.textContent);
    expect(paras).toContain("No high-risk plugins detected");
  });
});
