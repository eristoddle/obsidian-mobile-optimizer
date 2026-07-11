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
    rating: overrides.rating,
  };
}

function makePluginHost(metrics: PluginMetric[]): MobileOptimizerPluginHost {
  return {
    profiler: {
      collectMetrics: () => metrics,
      refresh: () => metrics,
    } as any,
    compatEngine: {
      classify: (id: string) => {
        const m = metrics.find((x) => x.pluginId === id);
        return m?.rating ?? "yellow";
      },
    } as any,
  };
}

function makeDashboardView(metrics: PluginMetric[]): DashboardView {
  const leaf = {} as any;
  const view = new DashboardView(leaf, makePluginHost(metrics));
  return view;
}

// ---------------------------------------------------------------------------
// renderTrafficLight — tested via onOpen() DOM output
// ---------------------------------------------------------------------------

describe("renderTrafficLight", () => {
  const cases: [CompatibilityRating, string, string][] = [
    ["red", "traffic-red", "Red \u2013 high risk"],
    ["yellow", "traffic-yellow", "Yellow \u2013 unknown"],
    ["green", "traffic-green", "Green \u2013 safe"],
  ];

  test.each(cases)(
    "rating=%s → CSS class '%s' and aria-label '%s'",
    async (rating, expectedClass, expectedLabel) => {
      const metric = makeMetric({ rating });
      const view = makeDashboardView([metric]);
      await view.onOpen();

      const span = view.contentEl.querySelector(`span.${expectedClass}`);
      expect(span).not.toBeNull();
      expect(span?.getAttribute("aria-label")).toBe(expectedLabel);
    }
  );

  it("creates exactly one span per plugin row", async () => {
    const metrics = [
      makeMetric({ pluginId: "a", rating: "red" }),
      makeMetric({ pluginId: "b", rating: "yellow" }),
      makeMetric({ pluginId: "c", rating: "green" }),
    ];
    const view = makeDashboardView(metrics);
    await view.onOpen();

    const spans = view.contentEl.querySelectorAll("span[aria-label]");
    expect(spans.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// renderPluginList — structure and content
// ---------------------------------------------------------------------------

describe("renderPluginList", () => {
  it("renders a table with Name, Load Time, Rating columns", async () => {
    const view = makeDashboardView([makeMetric({ rating: "green" })]);
    await view.onOpen();

    const headers = Array.from(view.contentEl.querySelectorAll("th")).map(
      (th) => th.textContent
    );
    expect(headers).toContain("Name");
    expect(headers).toContain("Load Time");
    expect(headers).toContain("Rating");
  });

  it("renders one row per metric", async () => {
    const metrics = [
      makeMetric({ pluginId: "a", pluginName: "Alpha", rating: "green" }),
      makeMetric({ pluginId: "b", pluginName: "Beta", rating: "yellow" }),
      makeMetric({ pluginId: "c", pluginName: "Gamma", rating: "red" }),
    ];
    const view = makeDashboardView(metrics);
    await view.onOpen();

    const rows = view.contentEl.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);
  });

  it("displays the plugin name in the first cell of each row", async () => {
    const metric = makeMetric({ pluginName: "My Plugin", rating: "green" });
    const view = makeDashboardView([metric]);
    await view.onOpen();

    const firstCell = view.contentEl.querySelector("tbody tr td");
    expect(firstCell?.textContent).toBe("My Plugin");
  });

  it("displays formatted load time in the second cell", async () => {
    const metric = makeMetric({ loadTimeMs: 42.5, rating: "green" });
    const view = makeDashboardView([metric]);
    await view.onOpen();

    const cells = view.contentEl.querySelectorAll("tbody tr td");
    expect(cells[1]?.textContent).toBe("42.50 ms");
  });

  it("displays em dash for null load time", async () => {
    const metric = makeMetric({ loadTimeMs: null, rating: "yellow" });
    const view = makeDashboardView([metric]);
    await view.onOpen();

    const cells = view.contentEl.querySelectorAll("tbody tr td");
    expect(cells[1]?.textContent).toBe("\u2014");
  });

  // --- Refresh button ---

  it("renders a Refresh button", async () => {
    const view = makeDashboardView([]);
    await view.onOpen();

    const btn = view.contentEl.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe("Refresh");
  });

  it("Refresh button re-renders the table with updated metrics", async () => {
    const initial: PluginMetric[] = [
      makeMetric({ pluginId: "a", pluginName: "Alpha", loadTimeMs: 10, rating: "green" }),
    ];
    const updated: PluginMetric[] = [
      makeMetric({ pluginId: "b", pluginName: "Beta", loadTimeMs: 20, rating: "red" }),
    ];

    let callCount = 0;
    const host: MobileOptimizerPluginHost = {
      profiler: {
        collectMetrics: () => initial,
        refresh: () => {
          callCount++;
          return updated;
        },
      } as any,
      compatEngine: {
        classify: (id: string) => {
          const all = [...initial, ...updated];
          return all.find((x) => x.pluginId === id)?.rating ?? "yellow";
        },
      } as any,
    };

    const view = new DashboardView({} as any, host);
    await view.onOpen();

    // Confirm initial state
    expect(view.contentEl.querySelector("tbody")?.querySelectorAll("tr").length).toBe(1);
    expect(view.contentEl.querySelector("tbody tr td")?.textContent).toBe("Alpha");

    // Click refresh
    const btn = view.contentEl.querySelector("button") as HTMLButtonElement;
    btn.click();

    // Profiler.refresh() should have been called
    expect(callCount).toBe(1);

    // Table should now show updated metrics
    expect(view.contentEl.querySelector("tbody tr td")?.textContent).toBe("Beta");
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
