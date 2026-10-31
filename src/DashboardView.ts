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
  /** User's keep-on-mobile choices, by plugin id. Absent = use the suggestion. */
  overrides?: Record<string, boolean>;
  saveOverrides?: () => Promise<void>;
}

/**
 * Sync plugins. Dropping one from the mobile config makes the mobile vault
 * pointless, so they are kept by default whatever their rating.
 */
export const SYNC_PLUGINS = new Set([
  "remotely-save",
  "obsidian-livesync",
  "remotely-secure",
  "fit",
]);

/** Suggested keep-on-mobile state, before any user override. */
export function suggestKeep(m: PluginMetric): boolean {
  return m.enabled && (SYNC_PLUGINS.has(m.pluginId) || m.rating !== "red");
}

function formatKB(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
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

const RATING_RANK: Record<CompatibilityRating, number> = { red: 0, yellow: 1, green: 2 };

/** Worst rating first, then heaviest bundle — the order you'd act on. */
export function sortByCost(metrics: PluginMetric[]): PluginMetric[] {
  return [...metrics].sort(
    (a, b) =>
      RATING_RANK[a.rating ?? "yellow"] - RATING_RANK[b.rating ?? "yellow"] ||
      (b.loadTimeMs ?? -1) - (a.loadTimeMs ?? -1) ||
      (b.bundleKB ?? -1) - (a.bundleKB ?? -1) ||
      a.pluginName.localeCompare(b.pluginName)
  );
}

function formatNum(v: number | null | undefined, unit: string): string {
  return v == null ? "\u2014" : `${v} ${unit}`;
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
      const why = plugin.reasons?.length ? ` (${plugin.reasons.join(", ")})` : "";
      list.createEl("li", { text: `Disable ${plugin.pluginName} on mobile${why}` });
    }
  } else {
    container.createEl("p", { text: "No high-risk plugins detected" });
  }
}

/**
 * The sidebar dashboard view for the Mobile Optimizer plugin.
 *
 * On open it runs the passive scan (bundle size + stored data), which touches
 * no plugin. "Measure load times" runs the active pass that briefly disables
 * and re-enables each plugin to time it. Each row has a keep-on-mobile
 * checkbox; ratings only set its default.
 */
export class DashboardView extends ItemView {
  private readonly plugin: MobileOptimizerPluginHost;
  private metrics: PluginMetric[] = [];
  private status = "";
  private busy = false;

  constructor(leaf: WorkspaceLeaf, plugin: MobileOptimizerPluginHost) {
    super(leaf);
    this.plugin = plugin;
    this.plugin.overrides ??= {};
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Mobile Optimizer";
  }

  getIcon(): string {
    return "smartphone";
  }

  async onOpen(): Promise<void> {
    this.metrics = this.rateAll(this.plugin.profiler.collectMetrics());
    this.status = "Scanning bundle sizes and stored data\u2026";
    this.render();
    await this.scan();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private rateAll(metrics: PluginMetric[]): PluginMetric[] {
    return metrics.map((m) => {
      const rated = { ...m, ...this.plugin.compatEngine.rate(m) };
      if (SYNC_PLUGINS.has(m.pluginId)) {
        rated.reasons = [...(rated.reasons ?? []), "needed for sync"];
      }
      return rated;
    });
  }

  /** Whether this plugin goes into the mobile config. */
  keeps(m: PluginMetric): boolean {
    if (!m.enabled) return false;
    return this.plugin.overrides?.[m.pluginId] ?? suggestKeep(m);
  }

  private async setKeep(m: PluginMetric, keep: boolean): Promise<void> {
    const overrides = this.plugin.overrides!;
    if (keep === suggestKeep(m)) delete overrides[m.pluginId];
    else overrides[m.pluginId] = keep;
    await this.plugin.saveOverrides?.();
    this.render();
  }

  private async resetKeeps(): Promise<void> {
    for (const id of Object.keys(this.plugin.overrides!)) {
      delete this.plugin.overrides![id];
    }
    await this.plugin.saveOverrides?.();
    this.render();
  }

  private async scan(): Promise<void> {
    this.metrics = this.rateAll(await this.plugin.profiler.scan());
    this.status = "Load times not measured yet. Measuring briefly disables and re-enables each plugin.";
    this.render();
  }

  private async measure(): Promise<void> {
    this.busy = true;
    const measured = await this.plugin.profiler.measure((done, total, name) => {
      this.status = name ? `Measuring ${done + 1}/${total}: ${name}\u2026` : "Done.";
      this.render();
    });
    this.busy = false;
    this.metrics = this.rateAll(measured);
    this.status = "Measured. Memory column is desktop-only and approximate.";
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const controls = contentEl.createDiv({ cls: "mobile-optimizer-controls" });
    const measureBtn = controls.createEl("button", {
      text: "Measure load times",
      cls: "mod-cta",
    });
    measureBtn.disabled = this.busy;
    measureBtn.addEventListener("click", () => this.measure());

    contentEl.createEl("p", { text: this.status, cls: "mobile-optimizer-status" });

    this.renderSummary();
    this.renderPluginList(sortByCost(this.metrics));
    // Only what is actually being left off — a red plugin the user kept
    // (or a sync plugin) is a decision already made, not a recommendation.
    renderRecommendationsTo(
      contentEl,
      sortByCost(this.metrics).filter(
        (m) => m.rating === "red" && m.enabled && !this.keeps(m)
      )
    );
    this.renderGenerateButton();
  }

  /** Running total of what the mobile config will carry vs desktop. */
  private renderSummary(): void {
    const enabled = this.metrics.filter((m) => m.enabled);
    const kept = enabled.filter((m) => this.keeps(m));
    const kb = (ms: PluginMetric[]) => ms.reduce((t, m) => t + (m.bundleKB ?? 0), 0);

    const row = this.contentEl.createDiv({ cls: "mobile-optimizer-summary" });
    row.createSpan({
      text: `Mobile config: ${kept.length} of ${enabled.length} plugins, ${formatKB(kb(kept))} of bundles (desktop: ${formatKB(kb(enabled))})`,
    });
    if (Object.keys(this.plugin.overrides ?? {}).length) {
      const reset = row.createEl("button", { text: "Reset to suggestions" });
      reset.addEventListener("click", () => this.resetKeeps());
    }
  }

  private renderPluginList(metrics: PluginMetric[]): void {
    const table = this.contentEl.createEl("table", { cls: "mobile-optimizer-table" });
    const headerRow = table.createEl("thead").createEl("tr");
    for (const h of ["Mobile", "", "Name", "Load", "Bundle", "Stored", "Memory"]) {
      headerRow.createEl("th", { text: h });
    }

    const tbody = table.createEl("tbody");
    for (const m of metrics) {
      const row = tbody.createEl("tr");
      if (!m.enabled) row.addClass("mobile-optimizer-disabled");

      const box = row.createEl("td").createEl("input", { type: "checkbox" });
      box.checked = this.keeps(m);
      box.disabled = !m.enabled || this.busy;
      box.setAttribute(
        "aria-label",
        m.enabled ? `Keep ${m.pluginName} on mobile` : `${m.pluginName} is off on desktop`
      );
      box.addEventListener("change", () => this.setKeep(m, box.checked));

      this.renderTrafficLight(row.createEl("td"), m.rating ?? "yellow");
      const name = row.createEl("td", { text: m.pluginName });
      if (m.reasons?.length) name.setAttribute("title", m.reasons.join(", "));
      if (SYNC_PLUGINS.has(m.pluginId)) {
        name.createSpan({ text: "sync", cls: "mobile-optimizer-tag" });
      }
      row.createEl("td", { text: m.enabled ? formatNum(m.loadTimeMs, "ms") : "off" });
      row.createEl("td", { text: m.bundleKB == null ? "\u2014" : formatKB(m.bundleKB) });
      row.createEl("td", { text: m.storageMB ? `${m.storageMB} MB` : "\u2014" });
      row.createEl("td", { text: formatNum(m.heapDeltaMB, "MB") });
    }
  }

  private renderGenerateButton(): void {
    const wrapper = this.contentEl.createEl("div", {
      cls: "mobile-optimizer-generate-wrapper",
    });
    const button = wrapper.createEl("button", {
      text: "Generate Mobile Config",
      cls: "mod-cta",
    });
    button.setAttribute("aria-label", "Generate a mobile-safe Obsidian config folder");
    button.disabled = this.busy;

    button.addEventListener("click", async () => {
      button.disabled = true;
      const spinner = wrapper.createEl("span", { cls: "mobile-optimizer-spinner" });
      const cleanup = () => {
        button.disabled = false;
        spinner.remove();
      };

      const ratings = new Map(
        this.metrics.map((m) => [m.pluginId, m.rating ?? "yellow"] as const)
      );
      const keep = new Set(this.metrics.filter((m) => this.keeps(m)).map((m) => m.pluginId));
      const generator = new ConfigGenerator(
        this.app,
        this.plugin.compatEngine,
        ratings,
        keep
      );
      const dest = `${this.app.vault.configDir}.mobile`;

      await generator.generate((state) => {
        if (state === "done") {
          new Notice(
            `Mobile config generated with ${keep.size} plugins. On mobile: Settings \u2192 Files and links \u2192 Override config folder \u2192 ${dest}`,
            10000
          );
          cleanup();
        } else if (state === "error") {
          cleanup();
        }
      });
    });
  }

  private renderTrafficLight(container: HTMLElement, rating: CompatibilityRating): void {
    const CLASS_MAP: Record<CompatibilityRating, string> = {
      red: "traffic-red",
      yellow: "traffic-yellow",
      green: "traffic-green",
    };
    const LABEL_MAP: Record<CompatibilityRating, string> = {
      red: "Red \u2013 high risk",
      yellow: "Yellow \u2013 moderate or unknown",
      green: "Green \u2013 light",
    };
    const span = container.createEl("span", { cls: CLASS_MAP[rating] });
    span.setAttribute("aria-label", LABEL_MAP[rating]);
  }
}
