/**
 * @jest-environment jsdom
 */
// Feature: obsidian-mobile-optimizer, Property 4: sort produces valid ordering for any plugin list
// Feature: obsidian-mobile-optimizer, Property 7: recommendations match exactly the red-rated plugins

import * as fc from "fast-check";
import { sortMetrics, renderRecommendationsTo } from "./DashboardView";
import { PluginMetric } from "./Profiler";

// ---------------------------------------------------------------------------
// Patch Obsidian DOM helpers onto HTMLElement so jsdom mirrors the Obsidian
// runtime for tests that exercise DOM-rendering functions.
// ---------------------------------------------------------------------------
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

/**
 * Property-based tests for sortMetrics (DashboardView sorting logic).
 *
 * **Validates: Requirements 2.4, 2.5**
 */

/** Arbitrary generator for a single PluginMetric. */
const arbitraryPluginMetric = fc.record<PluginMetric>({
  pluginId: fc.string(),
  pluginName: fc.string(),
  loadTimeMs: fc.option(fc.float({ noNaN: true, min: 0 })),
  rating: fc.constantFrom("red", "yellow", "green"),
  enabled: fc.boolean(),
});

describe("DashboardView — Property 4: sort produces valid ordering for any plugin list", () => {
  /**
   * Property 4: Plugin list sort order invariant
   *
   * For any collection of PluginMetric objects, after sortMetrics is applied:
   *   1. All plugins with loadTimeMs !== null appear before all with loadTimeMs === null.
   *   2. Among measured plugins, loadTimeMs values are in non-increasing (descending) order.
   *   3. Among measured plugins with equal loadTimeMs, names are in non-decreasing (ascending) order.
   *   4. Among unmeasured plugins, names are in non-decreasing (ascending) alphabetical order.
   *
   * **Validates: Requirements 2.4, 2.5**
   */
  it("Property 4: all four sort-order invariants hold for any arbitrary plugin list", () => {
    fc.assert(
      fc.property(fc.array(arbitraryPluginMetric), (metrics) => {
        const sorted = sortMetrics(metrics);

        // Invariant 1: measured plugins appear before unmeasured ones.
        // Find the index of the first unmeasured plugin.
        const firstUnmeasuredIndex = sorted.findIndex((m) => m.loadTimeMs === null);

        if (firstUnmeasuredIndex !== -1) {
          // Every plugin after the first unmeasured must also be unmeasured.
          for (let i = firstUnmeasuredIndex; i < sorted.length; i++) {
            if (sorted[i].loadTimeMs !== null) {
              return false; // Violation: a measured plugin appears after an unmeasured one
            }
          }
        }

        // Split into measured and unmeasured partitions.
        const measured = sorted.filter((m) => m.loadTimeMs !== null);
        const unmeasured = sorted.filter((m) => m.loadTimeMs === null);

        // Invariant 2: among measured plugins, loadTimeMs is non-increasing (descending).
        for (let i = 0; i < measured.length - 1; i++) {
          const cur = measured[i].loadTimeMs as number;
          const next = measured[i + 1].loadTimeMs as number;
          if (cur < next) {
            return false; // Violation: load times not descending
          }
        }

        // Invariant 3: among measured plugins with equal loadTimeMs, names are non-decreasing.
        for (let i = 0; i < measured.length - 1; i++) {
          const cur = measured[i];
          const next = measured[i + 1];
          if (cur.loadTimeMs === next.loadTimeMs) {
            if (cur.pluginName.localeCompare(next.pluginName) > 0) {
              return false; // Violation: names not ascending within tied load times
            }
          }
        }

        // Invariant 4: among unmeasured plugins, names are non-decreasing (ascending).
        for (let i = 0; i < unmeasured.length - 1; i++) {
          if (unmeasured[i].pluginName.localeCompare(unmeasured[i + 1].pluginName) > 0) {
            return false; // Violation: unmeasured names not ascending
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it("Property 4 (non-mutation): sortMetrics does not mutate the input array", () => {
    fc.assert(
      fc.property(fc.array(arbitraryPluginMetric), (metrics) => {
        const copy = metrics.map((m) => ({ ...m }));
        sortMetrics(metrics);

        // Each original element must remain in the same position.
        for (let i = 0; i < metrics.length; i++) {
          if (
            metrics[i].pluginId !== copy[i].pluginId ||
            metrics[i].pluginName !== copy[i].pluginName ||
            metrics[i].loadTimeMs !== copy[i].loadTimeMs
          ) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7 — Recommendations section correctness
// ---------------------------------------------------------------------------

/**
 * Property-based tests for renderRecommendationsTo (Recommendations section).
 *
 * **Validates: Requirements 3.6, 3.7**
 */

/** Arbitrary generator for a single PluginMetric with a random rating. */
const arbitraryPluginMetricWithRating = fc.record<PluginMetric>({
  pluginId: fc.uuid(),
  pluginName: fc.string({ minLength: 1, maxLength: 40 }),
  loadTimeMs: fc.option(fc.float({ noNaN: true, min: 0, max: 10_000 })),
  rating: fc.constantFrom("red", "yellow", "green") as fc.Arbitrary<"red" | "yellow" | "green">,
  enabled: fc.boolean(),
});

describe("DashboardView — Property 7: recommendations match exactly the red-rated plugins", () => {
  // Feature: obsidian-mobile-optimizer, Property 7: recommendations match exactly the red-rated plugins

  /**
   * Property 7a: Every red-rated plugin name appears in the Recommendations section.
   *
   * For any collection of PluginMetric[], filter to red-rated ones, render
   * recommendations, then assert every red plugin's name is listed.
   *
   * **Validates: Requirements 3.6**
   */
  it("Property 7a: every red-rated plugin name appears in the recommendations list", () => {
    fc.assert(
      fc.property(fc.array(arbitraryPluginMetricWithRating), (metrics) => {
        const redPlugins = metrics.filter((m) => m.rating === "red");

        const container = document.createElement("div");
        renderRecommendationsTo(container, redPlugins);

        const liTexts = Array.from(container.querySelectorAll("li")).map(
          (li) => li.textContent ?? ""
        );

        // Every red plugin must have a corresponding list item.
        for (const plugin of redPlugins) {
          const expected = `Disable ${plugin.pluginName} on mobile`;
          if (!liTexts.includes(expected)) {
            return false;
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7b: No yellow- or green-rated plugin name appears in the
   * Recommendations section.
   *
   * **Validates: Requirements 3.7**
   */
  it("Property 7b: no yellow or green plugin name appears in the recommendations list", () => {
    fc.assert(
      fc.property(fc.array(arbitraryPluginMetricWithRating), (metrics) => {
        const redPlugins = metrics.filter((m) => m.rating === "red");
        const nonRedPlugins = metrics.filter((m) => m.rating !== "red");

        const container = document.createElement("div");
        renderRecommendationsTo(container, redPlugins);

        const liTexts = Array.from(container.querySelectorAll("li")).map(
          (li) => li.textContent ?? ""
        );

        // No non-red plugin should appear in the list.
        for (const plugin of nonRedPlugins) {
          const unexpected = `Disable ${plugin.pluginName} on mobile`;
          if (liTexts.includes(unexpected)) {
            return false;
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7c: The list contains EXACTLY one entry per red plugin — no
   * extras and no duplicates beyond what the input contains.
   *
   * **Validates: Requirements 3.6, 3.7**
   */
  it("Property 7c: the recommendations list length equals the number of red plugins", () => {
    fc.assert(
      fc.property(fc.array(arbitraryPluginMetricWithRating), (metrics) => {
        const redPlugins = metrics.filter((m) => m.rating === "red");

        const container = document.createElement("div");
        renderRecommendationsTo(container, redPlugins);

        const items = container.querySelectorAll("li");
        return items.length === redPlugins.length;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7d: When no plugins have rating === "red", the section displays
   * the "No high-risk plugins detected" message and renders no list items.
   *
   * **Validates: Requirements 3.7**
   */
  it('Property 7d: "No high-risk plugins detected" appears and no items are listed when there are no red plugins', () => {
    // Generate only yellow/green metrics (no red).
    const nonRedMetric = fc.record<PluginMetric>({
      pluginId: fc.uuid(),
      pluginName: fc.string({ minLength: 1, maxLength: 40 }),
      loadTimeMs: fc.option(fc.float({ noNaN: true, min: 0, max: 10_000 })),
      rating: fc.constantFrom("yellow", "green") as fc.Arbitrary<"yellow" | "green">,
      enabled: fc.boolean(),
    });

    fc.assert(
      fc.property(fc.array(nonRedMetric), (metrics) => {
        const redPlugins = metrics.filter((m) => m.rating === "red"); // always []

        const container = document.createElement("div");
        renderRecommendationsTo(container, redPlugins);

        // Must show the no-risk message.
        const p = container.querySelector("p");
        if (!p || p.textContent !== "No high-risk plugins detected") {
          return false;
        }

        // Must not show any list items.
        const items = container.querySelectorAll("li");
        return items.length === 0;
      }),
      { numRuns: 100 }
    );
  });
});
