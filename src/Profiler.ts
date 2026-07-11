// Obsidian Mobile Optimizer — Profiler
// Collects per-plugin load-time metrics from the Obsidian internal registry.
// Requirements: 2.1, 2.2, 2.3, 2.6

import { App, PluginManifest } from "obsidian";
import { CompatibilityRating } from "./CompatibilityEngine";

/**
 * Metrics for a single installed plugin.
 *
 * `rating` is optional at the Profiler level — it is attached by DashboardView
 * after calling CompatibilityEngine.classify(), keeping the Profiler free of any
 * classification concern (single-responsibility principle).
 */
export interface PluginMetric {
  pluginId: string;
  pluginName: string;
  loadTimeMs: number | null; // null = unmeasurable (Requirement 2.3, 2.4)
  enabled: boolean;
  /** Attached by DashboardView after classification; undefined until enriched. */
  rating?: CompatibilityRating;
}

/**
 * Collects per-plugin load-time and enabled-state metrics by reading the
 * undocumented (but widely-used) `app.plugins` internal registry.
 *
 * Timing strategy (Requirement 2.1, 2.2):
 *  1. Try `performance.getEntriesByName(pluginId)` for any named timing marks.
 *  2. Fall back to `performance.getEntriesByType("resource")` and match entries
 *     whose name contains the plugin's JS bundle path pattern.
 *  3. If neither yields an entry, set `loadTimeMs: null`.
 *
 * Error handling (Requirement 2.6):
 *  If `app.plugins` or `app.plugins.manifests` is inaccessible, the entire
 *  `collectMetrics()` call catches the error, logs a warning, and returns `[]`.
 */
export class Profiler {
  constructor(private readonly app: App) {}

  /**
   * Collect metrics for all plugins currently in the registry.
   * Returns an empty array and logs a warning if the internal registry is
   * inaccessible (e.g., older Obsidian version).
   */
  collectMetrics(): PluginMetric[] {
    try {
      // Access the undocumented internal plugin registry.
      const plugins = (this.app as any).plugins as {
        manifests: Record<string, PluginManifest>;
        enabledPlugins: Set<string>;
      };

      const manifests = plugins.manifests;
      const enabledPlugins: Set<string> = plugins.enabledPlugins ?? new Set();

      const metrics: PluginMetric[] = [];

      for (const [pluginId, manifest] of Object.entries(manifests)) {
        const loadTimeMs = this._getLoadTime(pluginId);

        metrics.push({
          pluginId,
          pluginName: manifest.name,
          loadTimeMs,
          enabled: enabledPlugins.has(pluginId),
        });
      }

      return metrics;
    } catch (err) {
      console.warn(
        "[MobileOptimizer] Profiler: could not access plugin registry.",
        err
      );
      return [];
    }
  }

  /**
   * Re-run metric collection. Used by the Dashboard "Refresh" button
   * (Requirement 1.5).
   */
  refresh(): PluginMetric[] {
    return this.collectMetrics();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Attempt to resolve a load-time duration for `pluginId`.
   *
   * Strategy:
   *  1. `performance.getEntriesByName(pluginId)` — catches any named measure/mark
   *     that the plugin system may have recorded under the plugin's ID.
   *  2. `performance.getEntriesByType("resource")` — finds resource-timing entries
   *     whose URL contains the plugin's JS bundle path
   *     (`.obsidian/plugins/<pluginId>/main.js`).
   *
   * Returns the `duration` of the first matching entry, or `null` if none found.
   */
  private _getLoadTime(pluginId: string): number | null {
    // Attempt 1: named timing entry.
    const namedEntries = performance.getEntriesByName(pluginId);
    if (namedEntries.length > 0) {
      return namedEntries[0].duration;
    }

    // Attempt 2: resource-timing entry whose URL contains the bundle path.
    const bundlePath = `plugins/${pluginId}/main.js`;
    const resourceEntries = performance.getEntriesByType("resource");
    for (const entry of resourceEntries) {
      if (entry.name.includes(bundlePath)) {
        return entry.duration;
      }
    }

    // No timing data available.
    return null;
  }
}
