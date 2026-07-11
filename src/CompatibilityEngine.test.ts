import { CompatibilityEngine, CompatibilityRating } from "./CompatibilityEngine";

const RED_IDS = [
  "dataview",
  "omnisearch",
  "obsidian-excalidraw-plugin",
  "obsidian-kanban",
  "obsidian-git",
  "surfing",
  "table-editor-obsidian",
  "obsidian-tasks-plugin",
];

const GREEN_IDS = [
  "templater-obsidian",
  "calendar",
  "nldates-obsidian",
  "quickadd",
];

describe("CompatibilityEngine", () => {
  let engine: CompatibilityEngine;

  beforeEach(() => {
    engine = new CompatibilityEngine();
  });

  // ── Red list ──────────────────────────────────────────────────────────────

  describe("classify() — Red plugins", () => {
    test.each(RED_IDS)('"%s" classifies as "red"', (id) => {
      expect(engine.classify(id)).toBe("red");
    });
  });

  // ── Green list ────────────────────────────────────────────────────────────

  describe("classify() — Green plugins", () => {
    test.each(GREEN_IDS)('"%s" classifies as "green"', (id) => {
      expect(engine.classify(id)).toBe("green");
    });
  });

  // ── Unknown / Yellow default ──────────────────────────────────────────────

  describe("classify() — unknown plugins", () => {
    const unknownIds = [
      "some-random-plugin",
      "",
      "obsidian",
      "plugins",
      "DATAVIEW", // case-sensitive: uppercase ≠ red
      "Dataview",
    ];

    test.each(unknownIds)('"%s" classifies as "yellow" (default)', (id) => {
      expect(engine.classify(id)).toBe("yellow");
    });
  });

  // ── getAllRed() ────────────────────────────────────────────────────────────

  describe("getAllRed()", () => {
    it("returns exactly the 8 Red-list IDs", () => {
      const result = engine.getAllRed();
      expect(result).toHaveLength(RED_IDS.length);
      expect(result.sort()).toEqual([...RED_IDS].sort());
    });

    it("contains no Green-list IDs", () => {
      const result = engine.getAllRed();
      for (const id of GREEN_IDS) {
        expect(result).not.toContain(id);
      }
    });

    it("returns a new array on each call (not a reference to internal state)", () => {
      const a = engine.getAllRed();
      const b = engine.getAllRed();
      expect(a).not.toBe(b); // different array instances
      expect(a).toEqual(b);  // same contents
    });
  });

  // ── Return type is always one of the three valid ratings ─────────────────

  describe("classify() — return type exhaustiveness", () => {
    const validRatings: CompatibilityRating[] = ["red", "yellow", "green"];

    it("returns a valid CompatibilityRating for all known IDs", () => {
      const allKnown = [...RED_IDS, ...GREEN_IDS];
      for (const id of allKnown) {
        expect(validRatings).toContain(engine.classify(id));
      }
    });

    it("returns a valid CompatibilityRating for unknown IDs", () => {
      expect(validRatings).toContain(engine.classify("completely-unknown-plugin"));
      expect(validRatings).toContain(engine.classify(""));
    });
  });
});
