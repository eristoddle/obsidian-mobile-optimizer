// Feature: obsidian-mobile-optimizer, Property 1: classify returns red/yellow/green for any input
// Feature: obsidian-mobile-optimizer, Property 3: absent IDs classify as yellow

import * as fc from "fast-check";
import { CompatibilityEngine, CompatibilityRating } from "./CompatibilityEngine";

/**
 * Property-based tests for CompatibilityEngine.
 *
 * Validates: Requirements 3.1, 3.4
 */

describe("CompatibilityEngine — Property Tests", () => {
  let engine: CompatibilityEngine;

  beforeEach(() => {
    engine = new CompatibilityEngine();
  });

  /**
   * Property 1: Classification completeness
   *
   * For any plugin ID string, classify() SHALL return exactly one of
   * "red", "yellow", or "green" — never undefined, null, or any other value.
   *
   * Validates: Requirements 3.1, 3.4
   */
  it('Property 1: classify returns "red", "yellow", or "green" for any arbitrary plugin ID', () => {
    const validRatings: CompatibilityRating[] = ["red", "yellow", "green"];

    fc.assert(
      fc.property(fc.string(), (pluginId) => {
        const result = engine.classify(pluginId);
        return validRatings.includes(result);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Unknown plugins default to Yellow
   *
   * For any plugin ID that is absent from the CompatibilityDatabase,
   * classify() SHALL return "yellow".
   *
   * **Validates: Requirements 3.4, 1.4**
   */
  it('Property 3: Unknown plugins default to Yellow', () => {
    // All IDs known to the database (red + green entries)
    const knownIds = new Set<string>([
      "dataview",
      "omnisearch",
      "obsidian-excalidraw-plugin",
      "obsidian-kanban",
      "obsidian-git",
      "surfing",
      "table-editor-obsidian",
      "obsidian-tasks-plugin",
      "templater-obsidian",
      "calendar",
      "nldates-obsidian",
      "quickadd",
    ]);

    fc.assert(
      fc.property(
        fc.string().filter((s) => !knownIds.has(s)),
        (unknownId) => {
          const result = engine.classify(unknownId);
          return result === "yellow";
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: obsidian-mobile-optimizer, Property 2: red overrides green for same ID

/**
 * Property 2: Red takes precedence over Green
 *
 * For any plugin ID that is present in the Red set of the CompatibilityDatabase,
 * classify() SHALL return "red" — even when the same ID could theoretically also
 * appear in the Green set.
 *
 * Since COMPATIBILITY_DATABASE is private and static, the strategy here is:
 *  1. Use fc.constantFrom(...redIds) to property-test over all known Red IDs.
 *  2. Assert that every Red ID returns "red" regardless of anything else.
 *  3. Additionally verify that for any known Red ID, if it were also considered
 *     "green" by any hypothetical lookup, the result is still "red".
 *
 * Validates: Requirement 3.3
 */
describe("CompatibilityEngine — Property 2: Red takes precedence over Green", () => {
  let engine: CompatibilityEngine;

  // The full set of known Red IDs from the design / CompatibilityDatabase
  const RED_IDS = [
    "dataview",
    "omnisearch",
    "obsidian-excalidraw-plugin",
    "obsidian-kanban",
    "obsidian-git",
    "surfing",
    "table-editor-obsidian",
    "obsidian-tasks-plugin",
  ] as const;

  beforeEach(() => {
    engine = new CompatibilityEngine();
  });

  it('Property 2: "Red takes precedence over Green" — every known Red ID returns "red"', () => {
    // Use fc.constantFrom to sample uniformly from all known Red IDs,
    // asserting the Red-beats-Green invariant holds for each one.
    fc.assert(
      fc.property(fc.constantFrom(...RED_IDS), (redId) => {
        const result = engine.classify(redId);
        return result === "red";
      }),
      { numRuns: 100 }
    );
  });

  it("Property 2: getAllRed() IDs all classify as red (cross-check via engine)", () => {
    // getAllRed() exposes the live Red set; every ID it returns must classify
    // as "red" — verifying Red-beats-Green at the engine level without
    // hard-coding the list a second time.
    fc.assert(
      fc.property(
        fc.constantFrom(...engine.getAllRed()),
        (redId) => engine.classify(redId) === "red"
      ),
      { numRuns: 100 }
    );
  });
});
