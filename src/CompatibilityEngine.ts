/**
 * Mobile compatibility ratings for Obsidian plugins.
 * - "red"    — known resource-heavy or mobile-incompatible
 * - "yellow" — unknown / not tested (default)
 * - "green"  — known lightweight and mobile-safe
 */
export type CompatibilityRating = "red" | "yellow" | "green";

/**
 * Classifies installed Obsidian plugins by their mobile compatibility.
 *
 * The static COMPATIBILITY_DATABASE is initialized at module load time and
 * never modified at runtime (Requirement 5.5 — no network requests, no dynamic
 * loading).
 */
export class CompatibilityEngine {
  /**
   * Hardcoded compatibility database (Requirement 5.5).
   *
   * Precedence rule: if an ID appears in both the Red and Green sets the Red
   * classification wins (Requirement 3.3).  The map is built with Red entries
   * first; any subsequent Green entry for the same ID would be ignored by Map
   * semantics, but since the IDs are disjoint in the current dataset the order
   * is documented here for clarity.
   */
  private static readonly COMPATIBILITY_DATABASE: ReadonlyMap<
    string,
    CompatibilityRating
  > = new Map<string, CompatibilityRating>([
    // Red — known to be resource-heavy or incompatible with mobile (Requirement 3.2)
    ["dataview", "red"],
    ["omnisearch", "red"],
    ["obsidian-excalidraw-plugin", "red"],
    ["obsidian-kanban", "red"],
    ["obsidian-git", "red"],
    ["surfing", "red"],
    ["table-editor-obsidian", "red"],
    ["obsidian-tasks-plugin", "red"],

    // Green — known to be lightweight and mobile-safe (Requirement 3.3)
    ["templater-obsidian", "green"],
    ["calendar", "green"],
    ["nldates-obsidian", "green"],
    ["quickadd", "green"],
  ]);

  /**
   * Classify a plugin by its ID.
   *
   * Returns:
   *  - "red"    if the ID is in the Red set (even if it were also in Green)
   *  - "green"  if the ID is in the Green set only
   *  - "yellow" for any ID absent from the database (Requirement 3.4)
   *
   * The Red-beats-Green precedence is enforced by checking for "red"
   * explicitly before returning any other value (Requirement 3.3).
   */
  classify(pluginId: string): CompatibilityRating {
    const rating = CompatibilityEngine.COMPATIBILITY_DATABASE.get(pluginId);

    if (rating === "red") {
      return "red";
    }

    if (rating === "green") {
      return "green";
    }

    // Unknown ID → Yellow default (Requirement 3.4)
    return "yellow";
  }

  /**
   * Rate a plugin from its measured costs, with the hardcoded database as a
   * floor: a known-heavy plugin stays red even if it measured fast, because
   * its cost may only show up at runtime (e.g. an index rebuilding later).
   *
   * Falls back to classify() when nothing was measured.
   */
  rate(m: {
    pluginId: string;
    loadTimeMs?: number | null;
    bundleKB?: number | null;
    storageMB?: number | null;
    heapDeltaMB?: number | null;
  }): { rating: CompatibilityRating; reasons: string[] } {
    const known = this.classify(m.pluginId);
    const red: string[] = [];
    const yellow: string[] = [];

    const check = (
      value: number | null | undefined,
      redAt: number,
      yellowAt: number,
      label: (v: number) => string
    ) => {
      if (value == null) return;
      if (value >= redAt) red.push(label(value));
      else if (value >= yellowAt) yellow.push(label(value));
    };
    check(m.loadTimeMs, 100, 30, (v) => `${v} ms load`);
    check(m.bundleKB, 2000, 500, (v) => `${(v / 1024).toFixed(1)} MB bundle`);
    check(m.storageMB, 50, 5, (v) => `${v} MB stored`);
    check(m.heapDeltaMB, 30, 10, (v) => `+${v} MB memory`);

    if (known === "red") red.unshift("known mobile-heavy");

    const measured = [m.loadTimeMs, m.bundleKB, m.storageMB, m.heapDeltaMB].some(
      (v) => v != null
    );
    if (red.length) return { rating: "red", reasons: red };
    if (yellow.length) return { rating: "yellow", reasons: yellow };
    return { rating: measured ? "green" : known, reasons: [] };
  }

  /**
   * Return every plugin ID that is classified as "red".
   *
   * The returned array is in insertion order of the database map.
   */
  getAllRed(): string[] {
    const reds: string[] = [];
    for (const [id, rating] of CompatibilityEngine.COMPATIBILITY_DATABASE) {
      if (rating === "red") {
        reds.push(id);
      }
    }
    return reds;
  }
}
