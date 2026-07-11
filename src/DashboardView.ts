// Obsidian Mobile Optimizer — DashboardView
// ItemView that renders the plugin compatibility dashboard.
// Requirements: 1.2, 1.7, 4.1, 4.5, 4.7

import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { CompatibilityEngine, CompatibilityRating } from "./CompatibilityEngine";
import { Profiler, PluginMetric } from "./Profiler";
import { ConfigGenerator } from "./ConfigGenerator";

export const VIEW_TYPE = "mobile-optimizer-dashboard";

/**
 * Minimal interface for the plugin host, avoiding a circular import with main.ts
 * while the plugin entry point is still being built out (task 10.1).
 * Once MobileOptimizerPlugin is fully exported from main.ts this can be replaced
 * with the concrete type.
 */
export interface MobileOptimizerPluginHost {
  profiler: Profiler;
  compatEngine: CompatibilityEngine;
}

/**
 * Sort an array of PluginMetric objects according to the dashboard ordering rules.
 *
 * Rules (Requirements 2.4, 2.5):
 *  1. Measured plugins (loadTimeMs !== null) appear before unmeasured ones (loadTimeMs === null).
 *  2. Among measured plugins: descending by loadTimeMs; ties broken by pluginName ascending.
 *  3. Among unmeasured plugins: ascending by pluginName.
 *
 * Returns a new array — the input is never mutated.
 */
export function sortMetrics(metrics: PluginMetric[]): PluginMetric[] {
  return [...metrics].sort((a, b) => {
    const aMeasured = a.loadTimeMs !== null;
    const bMeasured = b.loadTimeMs !== null;

    // Rule 1: measured before unmeasured
    if (aMeasured && !bMeasured) return -1;
    if (!aMeasured && bMeasured) return 1;

    if (aMeasured && bMeasured) {
      // Rule 2: descending by loadTimeMs
      const timeDiff = (b.loadTimeMs as number) - (a.loadTimeMs as number);
      if (timeDiff !== 0) return timeDiff;
      // Tie-break: ascending by pluginName
      return a.pluginName.localeCompare(b.pluginName);
    }

    // Rule 3: both unmeasured — ascending by pluginName
    return a.pluginName.localeCompare(b.pluginName);
  });
}

export function formatLoadTime(ms: number | null): string {
  if (ms === null) return "\u2014";
  return ms.toFixed(2) + " ms";
}

/**
 * Render the Recommendations section into `container`.
 *
 * Extracted as a standalone exported function so it can be unit-tested and
 * property-tested independently of the full `DashboardView` class.
 *
 * Structure:
 *  - An <h2> heading: "Recommendations"
 *  - If redPlugins is non-empty: a <ul> with one <li> per red plugin, each
 *    reading "Disable <pluginName> on mobile"
 *  - If redPlugins is empty: a <p> reading "No high-risk plugins detected"
 *
 * Requirements: 3.6, 3.7
 *
 * @param container  - The DOM element to append the section into.
 * @param redPlugins - PluginMetric objects whose rating === "red".
 */
export function renderRecommendationsTo(
  container: HTMLElement,
  redPlugins: PluginMetric[]
): void {
  container.createEl("h2", { text: "Recommendations" });

  if (redPlugins.length > 0) {
    const list = container.createEl("ul");
    for (const plugin of redPlugins) {
      list.createEl("li", { text: `Disable ${plugin.pluginName} on mobile` });
    }
  } else {
    container.createEl("p", { text: "No high-risk plugins detected" });
  }
}

/**
 * The sidebar dashboard view for the Mobile Optimizer plugin.
 *
 * Extends Obsidian's `ItemView` and owns the complete dashboard DOM.
 * All DOM manipulation uses native APIs only — no React, Vue, or Preact.
 *
 * Requirements: 1.2, 1.7
 */
export class DashboardView extends ItemView {
  private readonly plugin: MobileOptimizerPluginHost;

  /**
   * @param leaf   - The workspace leaf this view is attached to.
   * @param plugin - The plugin host providing access to Profiler and CompatibilityEngine.
   */
  constructor(leaf: WorkspaceLeaf, plugin: MobileOptimizerPluginHost) {
    super(leaf);
    this.plugin = plugin;
  }

  /** Returns the unique view type identifier used to register this view. */
  getViewType(): string {
    return VIEW_TYPE;
  }

  /** Returns the human-readable title shown in the tab header. */
  getDisplayText(): string {
    return "Mobile Optimizer";
  }

  /** Returns the icon ID used for the sidebar tab (Requirement 1.2). */
  getIcon(): string {
    return "smartphone";
  }

  /**
   * Called by Obsidian when the view is opened.
   *
   * Lifecycle:
   *  1. Collect raw metrics from the Profiler.
   *  2. Attach a `rating` to each metric via CompatibilityEngine.classify().
   *  3. Sort the enriched metrics with sortMetrics().
   *  4. Render the plugin list table.
   *  5. Render the recommendations section.
   *
   * Requirements: 1.2, 1.7
   */
  async onOpen(): Promise<void> {
    // Step 1 — collect raw PluginMetric[] from the Profiler.
    const rawMetrics = this.plugin.profiler.collectMetrics();

    // Step 2 — enrich each metric with a compatibility rating.
    // PluginMetric as defined in Profiler.ts does not carry a `rating` field;
    // we cast to the extended dashboard shape defined in design.md.
    const enrichedMetrics: PluginMetric[] = rawMetrics.map((m) => ({
      ...m,
      rating: this.plugin.compatEngine.classify(m.pluginId),
    }));

    // Step 3 — sort according to the dashboard ordering rules.
    const sorted = sortMetrics(enrichedMetrics);

    // Step 4 — render the plugin list.
    this.renderPluginList(sorted);

    // Step 5 — render the recommendations section.
    // Pass the full metrics for red-rated plugins so names can be displayed.
    const redPlugins = sorted.filter((m) => m.rating === "red");

    this.renderRecommendations(redPlugins);

    // Step 6 — render the "Generate Mobile Config" button (Requirements 4.1, 4.5, 4.7).
    this.renderGenerateButton();
  }

  /**
   * Called by Obsidian when the view is closed.
   * Clears all DOM content to release memory (Requirement 5.2).
   */
  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /**
   * Render the plugin table into `contentEl`.
   *
   * Structure:
   *  - A "Refresh" button above the table.
   *  - A <table> with columns: Name, Load Time, Rating.
   *  - One <tr> per metric.
   *
   * Requirements: 1.3, 1.5, 3.5
   */
  private renderPluginList(metrics: PluginMetric[]): void {
    const { contentEl } = this;

    // --- Refresh button (Requirement 1.5) ---
    const refreshBtn = contentEl.createEl("button", {
      text: "Refresh",
      cls: "mod-cta",
    });
    refreshBtn.setAttribute("aria-label", "Refresh plugin list");
    refreshBtn.addEventListener("click", () => {
      // Re-run profiler, re-classify, re-sort, then re-render the full view.
      const rawMetrics = this.plugin.profiler.refresh();
      const enrichedMetrics: PluginMetric[] = rawMetrics.map((m) => ({
        ...m,
        rating: this.plugin.compatEngine.classify(m.pluginId),
      }));
      const sorted = sortMetrics(enrichedMetrics);

      contentEl.empty();
      this.renderPluginList(sorted);

      const redPlugins = sorted.filter((m) => m.rating === "red");
      this.renderRecommendations(redPlugins);
    });

    // --- Table (Requirements 1.3, 3.5) ---
    const table = contentEl.createEl("table", { cls: "mobile-optimizer-table" });

    // Header row
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "Name" });
    headerRow.createEl("th", { text: "Load Time" });
    headerRow.createEl("th", { text: "Rating" });

    // Body rows — one per metric
    const tbody = table.createEl("tbody");
    for (const metric of metrics) {
      const row = tbody.createEl("tr");

      // Name cell
      row.createEl("td", { text: metric.pluginName });

      // Load Time cell — formatLoadTime handles null → "—" (Requirements 1.6, 2.2)
      row.createEl("td", { text: formatLoadTime(metric.loadTimeMs) });

      // Rating cell — contains a traffic-light span (Requirement 3.5)
      const ratingCell = row.createEl("td");
      this.renderTrafficLight(ratingCell, metric.rating ?? "yellow");
    }
  }

  /**
   * Render the "Generate Mobile Config" button and wire its click handler.
   *
   * Behaviour (Requirements 4.1, 4.5, 4.7):
   *  - Button is disabled and a spinner is injected while the operation runs.
   *  - On "done": shows a Notice with instructions for the mobile device.
   *  - On "error": ConfigGenerator already fired the error Notice; no extra notice needed.
   *  - In all terminal cases ("done" or "error"): re-enables the button and removes the spinner.
   */
  private renderGenerateButton(): void {
    const { contentEl } = this;

    const wrapper = contentEl.createEl("div", {
      cls: "mobile-optimizer-generate-wrapper",
    });

    const button = wrapper.createEl("button", {
      text: "Generate Mobile Config",
      cls: "mod-cta",
    });
    button.setAttribute("aria-label", "Generate a mobile-safe Obsidian config folder");

    button.addEventListener("click", async () => {
      // Requirement 4.7 — disable button and show spinner.
      button.disabled = true;
      const spinner = wrapper.createEl("span", {
        cls: "mobile-optimizer-spinner",
      });
      spinner.setAttribute("aria-label", "Generating…");

      const cleanup = () => {
        button.disabled = false;
        spinner.remove();
      };

      const generator = new ConfigGenerator(
        this.app,
        this.plugin.compatEngine
      );

      await generator.generate((state) => {
        if (state === "done") {
          // Requirement 4.5 — instruct user how to apply the config on mobile.
          new Notice(
            "Mobile config generated. On mobile: Settings → About → Override config folder → .obsidian.mobile"
          );
          cleanup();
        } else if (state === "error") {
          // ConfigGenerator already fired the error Notice.
          cleanup();
        }
        // "start" state: operation underway — keep spinner visible.
      });
    });
  }

  /**
   * Render the recommendations section into `contentEl`.
   *
   * Delegates to the exported `renderRecommendationsTo` helper so the logic
   * can be unit-tested independently without constructing a full `DashboardView`.
   *
   * Requirements: 3.6, 3.7
   *
   * @param redPlugins - Array of PluginMetric objects whose rating === "red".
   */
  private renderRecommendations(redPlugins: PluginMetric[]): void {
    renderRecommendationsTo(this.contentEl, redPlugins);
  }

  /**
   * Render a traffic-light indicator `<span>` into `container`.
   *
   * The span receives:
   *  - CSS class: `traffic-red` | `traffic-yellow` | `traffic-green`
   *  - `aria-label`: human-readable description of the rating
   *
   * Requirements: 1.3, 3.5
   */
  private renderTrafficLight(container: HTMLElement, rating: CompatibilityRating): void {
    const CLASS_MAP: Record<CompatibilityRating, string> = {
      red: "traffic-red",
      yellow: "traffic-yellow",
      green: "traffic-green",
    };
    const LABEL_MAP: Record<CompatibilityRating, string> = {
      red: "Red \u2013 high risk",
      yellow: "Yellow \u2013 unknown",
      green: "Green \u2013 safe",
    };

    const span = container.createEl("span", { cls: CLASS_MAP[rating] });
    span.setAttribute("aria-label", LABEL_MAP[rating]);
  }
}
