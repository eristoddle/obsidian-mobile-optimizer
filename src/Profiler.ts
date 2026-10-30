// Obsidian Mobile Optimizer — Profiler
// Measures what each installed plugin actually costs.
//
// Obsidian runs every plugin on one JS thread with one shared heap, so there is
// no per-plugin CPU/RAM readout to ask for. Instead we measure indirectly:
//  - bundleKB:    size of main.js — the whole file is parsed into memory at startup
//  - storageMB:   IndexedDB databases the plugin created (search indexes, caches)
//  - loadTimeMs:  disable the plugin, then time enablePlugin() — i.e. its onload()
//  - heapDeltaMB: JS heap growth across that re-enable (Chromium only: desktop/Android)
//
// The old approach read load times from the Performance API. Obsidian loads
// plugins by reading main.js from disk and evaluating it, so no performance
// entries are ever recorded and every value came back null.

import { App, PluginManifest } from "obsidian";
import { CompatibilityRating } from "./CompatibilityEngine";

export interface PluginMetric {
  pluginId: string;
  pluginName: string;
  loadTimeMs: number | null; // null = not measured yet, or plugin is disabled
  enabled: boolean;
  bundleKB?: number | null;
  storageMB?: number | null;
  heapDeltaMB?: number | null;
  /** Attached by DashboardView after classification; undefined until enriched. */
  rating?: CompatibilityRating;
  /** Human-readable reasons behind the rating. */
  reasons?: string[];
}

interface PluginRegistry {
  manifests: Record<string, PluginManifest>;
  enabledPlugins: Set<string>;
  enablePlugin?: (id: string) => Promise<boolean>;
  disablePlugin?: (id: string) => Promise<void>;
}

const SELF_ID = "obsidian-mobile-optimizer";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normalize a plugin id or IndexedDB name for loose matching. */
export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^obsidian-/, "")
    .replace(/-?plugin$/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Attribute an IndexedDB database to a plugin. Plugins name their databases
 * after themselves (`omnisearch/cache/<appId>`, `Excalidraw <appId>`,
 * `dataview/cache/<appId>`), so the leading word identifies the owner.
 * Obsidian's own databases (`<appId>-cache`) match nothing.
 */
export function matchDbToPlugin(
  dbName: string,
  pluginIds: string[]
): string | null {
  const head = normalizeKey(dbName.split(/[/ ]/)[0]);
  if (!head) return null;
  for (const id of pluginIds) {
    if (normalizeKey(id) === head) return id;
  }
  return null;
}

export class Profiler {
  constructor(private readonly app: App) {}

  private get registry(): PluginRegistry {
    return (this.app as any).plugins as PluginRegistry;
  }

  /**
   * Static list of installed plugins — no measurement. Cheap and synchronous,
   * so the dashboard can render immediately.
   */
  collectMetrics(): PluginMetric[] {
    try {
      const plugins = this.registry;
      const manifests = plugins.manifests;
      const enabledPlugins: Set<string> = plugins.enabledPlugins ?? new Set();

      return Object.entries(manifests).map(([pluginId, manifest]) => ({
        pluginId,
        pluginName: manifest.name,
        loadTimeMs: null,
        enabled: enabledPlugins.has(pluginId),
      }));
    } catch (err) {
      console.warn(
        "[MobileOptimizer] Profiler: could not access plugin registry.",
        err
      );
      return [];
    }
  }

  refresh(): PluginMetric[] {
    return this.collectMetrics();
  }

  /**
   * Passive scan: bundle sizes and IndexedDB storage. Touches no plugin, so it
   * is safe to run on open — including on a memory-starved phone.
   */
  async scan(): Promise<PluginMetric[]> {
    const metrics = this.collectMetrics();
    const manifests = this.registry?.manifests ?? {};

    for (const m of metrics) {
      m.bundleKB = await this.bundleSize(manifests[m.pluginId]);
    }

    const storage = await this.storageByPlugin(metrics.map((m) => m.pluginId));
    for (const m of metrics) {
      m.storageMB = storage.has(m.pluginId)
        ? round(storage.get(m.pluginId)! / 1048576, 1)
        : 0;
    }
    return metrics;
  }

  /**
   * Active measurement: for each enabled plugin, disable it, then time
   * re-enabling it. Plugins are left enabled exactly as they were.
   * The in-memory enable/disable calls do not touch community-plugins.json.
   */
  async measure(
    onProgress?: (done: number, total: number, name: string) => void
  ): Promise<PluginMetric[]> {
    const metrics = await this.scan();
    const reg = this.registry;
    if (!reg?.enablePlugin || !reg?.disablePlugin) return metrics;

    const targets = metrics.filter((m) => m.enabled && m.pluginId !== SELF_ID);
    let done = 0;
    for (const m of targets) {
      onProgress?.(done, targets.length, m.pluginName);
      try {
        await reg.disablePlugin(m.pluginId);
        await sleep(50);
        const h0 = heapBytes();
        const t0 = performance.now();
        await reg.enablePlugin(m.pluginId);
        m.loadTimeMs = round(performance.now() - t0, 1);
        // Let deferred onLayoutReady/setTimeout work run before reading heap.
        await sleep(250);
        const h1 = heapBytes();
        m.heapDeltaMB =
          h0 !== null && h1 !== null
            ? round(Math.max(0, h1 - h0) / 1048576, 1)
            : null;
      } catch (err) {
        console.warn(`[MobileOptimizer] could not measure ${m.pluginId}`, err);
        // Never leave a plugin disabled because measuring it failed.
        if (!reg.enabledPlugins.has(m.pluginId)) {
          await reg.enablePlugin(m.pluginId).catch(() => undefined);
        }
      }
      done++;
    }
    onProgress?.(done, targets.length, "");
    return metrics;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async bundleSize(
    manifest: PluginManifest | undefined
  ): Promise<number | null> {
    const dir = manifest?.dir;
    if (!dir) return null;
    try {
      const stat = await this.app.vault.adapter.stat(`${dir}/main.js`);
      return stat ? Math.round(stat.size / 1024) : null;
    } catch {
      return null;
    }
  }

  /**
   * Estimated bytes per plugin across its IndexedDB databases. On desktop all
   * vaults share one origin, so only databases tagged with this vault's appId
   * (or untagged ones) are counted.
   */
  private async storageByPlugin(
    pluginIds: string[]
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (typeof indexedDB === "undefined" || !indexedDB.databases) return result;

    const appId: string | undefined = (this.app as any).appId;
    let dbs: IDBDatabaseInfo[] = [];
    try {
      dbs = await indexedDB.databases();
    } catch {
      return result;
    }

    for (const info of dbs) {
      const name = info.name;
      if (!name) continue;
      const owner = matchDbToPlugin(name, pluginIds);
      if (!owner) continue;
      if (appId && /[0-9a-f]{16}/.test(name) && !name.includes(appId)) continue;
      const bytes = await estimateDbBytes(name);
      result.set(owner, (result.get(owner) ?? 0) + bytes);
    }
    return result;
  }
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function heapBytes(): number | null {
  const mem = (performance as any).memory;
  return mem ? mem.usedJSHeapSize : null;
}

/** Rough size of a value as stored — enough to tell 1KB from 400MB. */
function valueBytes(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "string") return v.length * 2;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (typeof Blob !== "undefined" && v instanceof Blob) return v.size;
  try {
    return JSON.stringify(v).length * 2;
  } catch {
    return 0;
  }
}

/**
 * Estimate a database's size: record count per store × average size of a
 * small sample. Never reads a whole store, so it is cheap even for a huge index.
 */
async function estimateDbBytes(name: string, sample = 20): Promise<number> {
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  if (!db) return 0;

  let total = 0;
  try {
    for (const storeName of Array.from(db.objectStoreNames)) {
      total += await new Promise<number>((resolve) => {
        const store = db.transaction(storeName, "readonly").objectStore(storeName);
        const countReq = store.count();
        countReq.onerror = () => resolve(0);
        countReq.onsuccess = () => {
          const count = countReq.result;
          if (count === 0) return resolve(0);
          let seen = 0;
          let bytes = 0;
          const cur = store.openCursor();
          cur.onerror = () => resolve(0);
          cur.onsuccess = () => {
            const c = cur.result;
            if (c && seen < sample) {
              bytes += valueBytes(c.value);
              seen++;
              c.continue();
            } else {
              resolve(seen ? (bytes / seen) * count : 0);
            }
          };
        };
      });
    }
  } finally {
    db.close();
  }
  return total;
}
