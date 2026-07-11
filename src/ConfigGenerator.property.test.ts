// Feature: obsidian-mobile-optimizer, Property 5: patching removes only red plugins

import * as fc from "fast-check";
import { ConfigGenerator } from "./ConfigGenerator";
import { CompatibilityEngine } from "./CompatibilityEngine";

/**
 * Property 5: community-plugins.json round-trip removes only Red plugins
 *
 * For any array of plugin IDs written to community-plugins.json, after
 * patchCommunityPlugins() runs the resulting array SHALL contain exactly the
 * plugin IDs from the original array that are NOT classified as "red", in the
 * same relative order.
 *
 * **Validates: Requirements 4.3**
 */

// Known Red plugin IDs (from CompatibilityEngine / Requirements 3.2)
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

// Known Green plugin IDs (from CompatibilityEngine / Requirements 3.3)
const GREEN_IDS = [
  "templater-obsidian",
  "calendar",
  "nldates-obsidian",
  "quickadd",
] as const;

// Arbitrary string generator that produces IDs which are unknown (yellow)
const unknownPluginId = fc
  .string({ minLength: 1 })
  .filter(
    (s) =>
      !(RED_IDS as readonly string[]).includes(s) &&
      !(GREEN_IDS as readonly string[]).includes(s)
  );

// Generator that produces a mix of red, green, and unknown plugin IDs
const mixedPluginIdArray = fc.array(
  fc.oneof(
    fc.constantFrom(...RED_IDS),
    fc.constantFrom(...GREEN_IDS),
    unknownPluginId
  )
);

/**
 * Builds a minimal mock app whose vault.adapter implements the methods
 * required by patchCommunityPlugins:  exists, read, write.
 *
 * The adapter is pre-configured so that:
 *   - exists(filePath) → true  (file is present)
 *   - read(filePath)   → JSON stringified version of `pluginIds`
 *   - write(filePath, content) → captures the written content in `captured`
 */
function makeAdapterForIds(pluginIds: string[]): {
  adapter: Record<string, jest.Mock>;
  getCaptured: () => string | undefined;
} {
  let captured: string | undefined;

  const adapter: Record<string, jest.Mock> = {
    exists: jest.fn().mockResolvedValue(true),
    read: jest.fn().mockResolvedValue(JSON.stringify(pluginIds)),
    write: jest.fn().mockImplementation((_path: string, content: string) => {
      captured = content;
      return Promise.resolve();
    }),
  };

  return { adapter, getCaptured: () => captured };
}

describe("ConfigGenerator — Property 5: patchCommunityPlugins removes only Red plugins", () => {
  const engine = new CompatibilityEngine();
  const redSet = new Set<string>(engine.getAllRed());

  it(
    "Property 5: output contains exactly the non-Red IDs from input in original relative order",
    async () => {
      await fc.assert(
        fc.asyncProperty(mixedPluginIdArray, async (pluginIds) => {
          // Arrange
          const { adapter, getCaptured } = makeAdapterForIds(pluginIds);
          const app = { vault: { adapter } } as any;
          const generator = new ConfigGenerator(app, engine);
          const destPath = ".obsidian.mobile";

          // Act — invoke the private method
          await (generator as any).patchCommunityPlugins(destPath);

          // Assert — write must have been called exactly once
          expect(adapter.write).toHaveBeenCalledTimes(1);

          const raw = getCaptured()!;
          const output: string[] = JSON.parse(raw);

          // The expected result is the input filtered to non-Red IDs,
          // preserving original relative order.
          const expected = pluginIds.filter((id) => !redSet.has(id));

          // 1. Same length
          expect(output).toHaveLength(expected.length);

          // 2. Same elements in same order
          expect(output).toEqual(expected);

          // 3. No Red ID may appear in the output
          for (const id of output) {
            expect(engine.classify(id)).not.toBe("red");
          }

          // 4. Every non-Red input ID must appear in the output
          for (const id of pluginIds) {
            if (!redSet.has(id)) {
              expect(output).toContain(id);
            }
          }
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "Property 5 (edge): empty plugin list → output is also empty",
    async () => {
      const { adapter, getCaptured } = makeAdapterForIds([]);
      const app = { vault: { adapter } } as any;
      const generator = new ConfigGenerator(app, engine);

      await (generator as any).patchCommunityPlugins(".obsidian.mobile");

      const output: string[] = JSON.parse(getCaptured()!);
      expect(output).toEqual([]);
    }
  );

  it(
    "Property 5 (edge): all-Red list → output is empty",
    async () => {
      const allRed = [...RED_IDS];
      const { adapter, getCaptured } = makeAdapterForIds(allRed);
      const app = { vault: { adapter } } as any;
      const generator = new ConfigGenerator(app, engine);

      await (generator as any).patchCommunityPlugins(".obsidian.mobile");

      const output: string[] = JSON.parse(getCaptured()!);
      expect(output).toEqual([]);
    }
  );

  it(
    "Property 5 (edge): all-Green list → output equals input unchanged",
    async () => {
      const allGreen = [...GREEN_IDS];
      const { adapter, getCaptured } = makeAdapterForIds(allGreen);
      const app = { vault: { adapter } } as any;
      const generator = new ConfigGenerator(app, engine);

      await (generator as any).patchCommunityPlugins(".obsidian.mobile");

      const output: string[] = JSON.parse(getCaptured()!);
      expect(output).toEqual(allGreen);
    }
  );

  it(
    "Property 5 (missing file): writes [] when community-plugins.json is absent",
    async () => {
      let captured: string | undefined;
      const adapter = {
        exists: jest.fn().mockResolvedValue(false),
        read: jest.fn(),
        write: jest.fn().mockImplementation((_p: string, c: string) => {
          captured = c;
          return Promise.resolve();
        }),
      };
      const app = { vault: { adapter } } as any;
      const generator = new ConfigGenerator(app, engine);

      await (generator as any).patchCommunityPlugins(".obsidian.mobile");

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect(JSON.parse(captured!)).toEqual([]);
    }
  );
});
