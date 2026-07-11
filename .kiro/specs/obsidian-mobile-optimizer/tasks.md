# Implementation Plan: Obsidian Mobile Optimizer

## Overview

Build the Obsidian Mobile Optimizer as a community plugin in TypeScript. The implementation proceeds in layers: scaffold → core engine → profiler → dashboard view → config generator → wiring and styles → tests. Each layer is independently testable before the next is added.

## Tasks

- [x] 1. Scaffold plugin project structure
  - Create `manifest.json` with `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `authorUrl`, `isDesktopOnly: false`
  - Create `package.json` with `obsidian` as the only non-dev dependency; add `fast-check` and `jest` (with `ts-jest`) as devDependencies
  - Create `tsconfig.json` targeting ES2018, `moduleResolution: "node"`, `lib: ["ES6", "DOM"]`
  - Create `esbuild.config.mjs` that bundles `src/main.ts` → `main.js` with no external framework deps
  - Create `.gitignore` excluding `node_modules`, `main.js`, `.obsidian.mobile`
  - Create `src/` directory structure: `main.ts`, `CompatibilityEngine.ts`, `Profiler.ts`, `DashboardView.ts`, `ConfigGenerator.ts`, `styles.css`
  - _Requirements: 5.1, 5.4_

- [x] 2. Implement CompatibilityEngine
  - [x] 2.1 Implement `CompatibilityEngine` class with static `COMPATIBILITY_DATABASE` map
    - Define `CompatibilityRating` type as `"red" | "yellow" | "green"`
    - Initialize the static `ReadonlyMap` with all 8 Red entries and 4 Green entries from the design
    - Implement `classify(pluginId: string): CompatibilityRating` — returns `"red"` if in Red set (even if also in Green set), `"green"` if in Green set only, `"yellow"` for any unknown ID
    - Implement `getAllRed(): string[]` — returns all IDs mapped to `"red"`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.5_

  - [x] 2.2 Write property test for Classification completeness (Property 1)
    - `// Feature: obsidian-mobile-optimizer, Property 1: classify returns red/yellow/green for any input`
    - Use `fc.string()` to generate arbitrary plugin IDs; assert result is one of the three valid ratings
    - **Property 1: Classification completeness**
    - **Validates: Requirements 3.1, 3.4**

  - [x] 2.3 Write property test for Red-beats-Green precedence (Property 2)
    - `// Feature: obsidian-mobile-optimizer, Property 2: red overrides green for same ID`
    - Inject arbitrary IDs into both sets; assert `classify()` returns `"red"`
    - **Property 2: Red takes precedence over Green**
    - **Validates: Requirements 3.3**

  - [x] 2.4 Write property test for Unknown-defaults-to-Yellow (Property 3)
    - `// Feature: obsidian-mobile-optimizer, Property 3: absent IDs classify as yellow`
    - Use `fc.string().filter(s => !knownIds.has(s))` to generate IDs absent from the database; assert `"yellow"`
    - **Property 3: Unknown plugins default to Yellow**
    - **Validates: Requirements 3.4, 1.4**

  - [x] 2.5 Write unit tests for CompatibilityEngine
    - Each Red-list ID classifies as `"red"`
    - Each Green-list ID classifies as `"green"`
    - Arbitrary unknown ID classifies as `"yellow"`
    - `getAllRed()` returns exactly the IDs from the Red list
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Implement Profiler
  - [x] 3.1 Implement `Profiler` class and `PluginMetric` interface
    - Define `PluginMetric` interface: `{ pluginId, pluginName, loadTimeMs: number | null, enabled: boolean }`
    - Enumerate plugins via `(app as any).plugins.manifests` to get all installed manifests
    - Detect enabled state via `(app as any).plugins.enabledPlugins` (`Set<string>`)
    - Attempt timing via `performance.getEntriesByName()` and `performance.getEntriesByType("resource")` for each plugin's JS bundle; set `loadTimeMs: null` if no timing entry found
    - Wrap the entire manifest enumeration in try/catch; return empty array and log warning on failure
    - Implement `collectMetrics(): PluginMetric[]` and `refresh(): PluginMetric[]` (calls `collectMetrics`)
    - _Requirements: 2.1, 2.2, 2.3, 2.6_

  - [x] 3.2 Write unit tests for Profiler
    - Mock `app.plugins.manifests` with a fixture of known plugin entries
    - Assert a `PluginMetric` is returned for every entry in the manifest
    - Assert `loadTimeMs: null` for plugins with no matching performance entry
    - Assert `enabled` flag matches the mocked `enabledPlugins` set
    - Assert empty array returned when `app.plugins` is inaccessible
    - _Requirements: 2.1, 2.3, 2.6_

- [x] 4. Implement DashboardView sorting logic
  - [x] 4.1 Implement and export `sortMetrics(metrics: PluginMetric[]): PluginMetric[]` as a pure function in `DashboardView.ts`
    - Measured plugins (`loadTimeMs !== null`) sort before unmeasured ones
    - Among measured: descending by `loadTimeMs`; ties broken by plugin name ascending
    - Among unmeasured: ascending by plugin name
    - Return a new sorted array; do not mutate the input
    - _Requirements: 2.4, 2.5_

  - [x] 4.2 Write property test for sort order invariant (Property 4)
    - `// Feature: obsidian-mobile-optimizer, Property 4: sort produces valid ordering for any plugin list`
    - Use `fc.array(fc.record({ pluginId: fc.string(), pluginName: fc.string(), loadTimeMs: fc.option(fc.float({ noNaN: true, min: 0 })), rating: fc.constantFrom("red","yellow","green"), enabled: fc.boolean() }))` to generate arbitrary metric arrays
    - Apply `sortMetrics`, assert all four ordering invariants hold
    - **Property 4: Plugin list sort order invariant**
    - **Validates: Requirements 2.4, 2.5**

  - [x] 4.3 Write unit tests for sortMetrics
    - Measured plugins always precede unmeasured ones in the output
    - Descending load-time order within measured group
    - Alphabetical tie-breaking within equal load times
    - Alphabetical ordering within unmeasured group
    - _Requirements: 2.4, 2.5_

- [x] 5. Implement load-time display formatting
  - [x] 5.1 Implement and export `formatLoadTime(ms: number | null): string` as a pure utility function
    - Returns `value.toFixed(2) + " ms"` for non-null numbers
    - Returns `"—"` for `null`
    - _Requirements: 1.6, 2.2_

  - [x] 5.2 Write property test for load time display format (Property 6)
    - `// Feature: obsidian-mobile-optimizer, Property 6: load time renders correctly for any numeric or null value`
    - For `fc.float({ noNaN: true })`: assert output ends with `" ms"` and does not equal `"—"`
    - For `null`: assert output equals `"—"`
    - **Property 6: Load time display format**
    - **Validates: Requirements 2.2, 1.6, 2.4**

- [x] 6. Implement DashboardView DOM rendering
  - [x] 6.1 Implement `DashboardView` class extending `ItemView`
    - Define `VIEW_TYPE = "mobile-optimizer-dashboard"` constant
    - Implement `getViewType()`, `getDisplayText()` (`"Mobile Optimizer"`), `getIcon()` (`"smartphone"`)
    - Implement `onOpen()`: call `Profiler.collectMetrics()`, call `CompatibilityEngine.classify()` for each metric to attach rating, sort via `sortMetrics()`, call `renderPluginList()` and `renderRecommendations()`
    - Implement `onClose()`: clear `contentEl`
    - _Requirements: 1.2, 1.7_

  - [x] 6.2 Implement `renderTrafficLight` and plugin table
    - `renderTrafficLight(container, rating)`: create `<span>` with CSS class `traffic-red / traffic-yellow / traffic-green` and `aria-label` of `"Red – high risk" / "Yellow – unknown" / "Green – safe"`
    - `renderPluginList(metrics)`: build a `<table>` with columns Name, Load Time, Rating; one row per metric; use `formatLoadTime()` for the time cell; call `renderTrafficLight()` for the rating cell
    - Add "Refresh" button above the table; on click: re-run `Profiler.refresh()`, re-classify, re-sort, clear and re-render `contentEl`
    - _Requirements: 1.3, 1.5, 3.5_

  - [x] 6.3 Implement `renderRecommendations` section
    - Below the plugin table, render a heading "Recommendations"
    - If any metrics have `rating === "red"`: list each red plugin name with a bullet recommending disabling it on mobile
    - If no red plugins: render the message "No high-risk plugins detected"
    - _Requirements: 3.6, 3.7_

  - [x] 6.4 Write property test for Recommendations section correctness (Property 7)
    - `// Feature: obsidian-mobile-optimizer, Property 7: recommendations match exactly the red-rated plugins`
    - Generate arbitrary `PluginMetric[]` with random ratings; render recommendations into a detached DOM node
    - Assert every red-rated plugin name appears in the section; assert no yellow/green names appear
    - Assert "no high-risk plugins detected" message appears when no red plugins exist
    - **Property 7: Recommendations section correctness**
    - **Validates: Requirements 3.6, 3.7**

  - [x] 6.5 Write unit tests for DashboardView rendering
    - Red plugin renders `traffic-red` span and correct `aria-label`
    - Yellow plugin renders `traffic-yellow` span
    - Green plugin renders `traffic-green` span
    - `formatLoadTime` output appears in the correct table cell
    - Refresh button triggers re-render
    - _Requirements: 1.3, 1.5, 1.6, 3.5_

- [x] 7. Checkpoint — core components
  - Ensure all tests pass for CompatibilityEngine, Profiler, sortMetrics, formatLoadTime, and DashboardView rendering. Ask the user if questions arise.

- [x] 8. Implement ConfigGenerator
  - [x] 8.1 Implement recursive copy and `generate()` entry point
    - Implement `copyRecursive(srcPath, destPath)`: `adapter.mkdir(destPath)`, `adapter.list(srcPath)`, copy each file via `adapter.copy` (or read+write fallback), recurse into sub-folders
    - Implement `confirmOverwrite(): Promise<boolean>` using Obsidian `Modal` subclass
    - Implement `generate(onProgress)`: check `.obsidian` exists (error notification + return if not); check `.obsidian.mobile` exists → call `confirmOverwrite` → abort if cancelled; call `onProgress("start")`; run `copyRecursive`; call `patchCommunityPlugins`; call `onProgress("done")` on success or `onProgress("error")` on failure
    - Surface I/O errors with `new Notice("Error copying <path>: <message>")` including the failing path
    - _Requirements: 4.1, 4.2, 4.4, 4.6, 4.7, 4.8_

  - [x] 8.2 Implement `patchCommunityPlugins`
    - Read `.obsidian.mobile/community-plugins.json`; if missing, write `[]` and return
    - Parse JSON; on parse error, show error notification and stop
    - Filter out IDs where `CompatibilityEngine.classify(id) === "red"`, preserving relative order
    - Write the filtered array back as JSON
    - _Requirements: 4.3_

  - [x] 8.3 Write property test for community-plugins.json round-trip (Property 5)
    - `// Feature: obsidian-mobile-optimizer, Property 5: patching removes only red plugins`
    - Generate random `string[]` of plugin IDs (mix of known Red, known Green, unknown); mock the filesystem adapter; run `patchCommunityPlugins`; assert output contains exactly the non-Red IDs in original relative order
    - **Property 5: community-plugins.json round-trip removes only Red plugins**
    - **Validates: Requirements 4.3**

  - [x] 8.4 Write unit tests for ConfigGenerator
    - Abort (no write) when source `.obsidian` is missing
    - Abort (no write) when user cancels overwrite confirmation modal
    - Successful copy calls `adapter.mkdir` and file write for each file in the source
    - `patchCommunityPlugins` removes Red IDs and preserves Green/Yellow IDs
    - `patchCommunityPlugins` creates `[]` when source `community-plugins.json` is absent
    - `patchCommunityPlugins` shows error notification and stops on invalid JSON
    - Error notification includes the failing file path on I/O failure
    - _Requirements: 4.2, 4.3, 4.4, 4.6, 4.8_

- [x] 9. Implement plugin styles
  - Create `styles.css` with rules for `.traffic-red` (red background/color), `.traffic-yellow` (amber), `.traffic-green` (green), and a `.mobile-optimizer-spinner` CSS animation for the loading state
  - Ensure color values meet WCAG AA contrast ratio against the Obsidian default background
  - _Requirements: 3.5, 4.7_

- [x] 10. Wire everything in `main.ts` and add "Generate Mobile Config" button
  - [x] 10.1 Implement `MobileOptimizerPlugin` class
    - `onload()`: instantiate `Profiler` and `CompatibilityEngine`; register `DashboardView` via `this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this))`; add ribbon icon `"smartphone"` that calls `activateView()`; implement `activateView()` to open the dashboard leaf in the right sidebar
    - `onunload()`: call `this.app.workspace.detachLeavesOfType(VIEW_TYPE)`
    - _Requirements: 1.1, 1.2, 5.2, 5.3_

  - [x] 10.2 Wire "Generate Mobile Config" button into DashboardView
    - Render the button in `onOpen()` below the Recommendations section
    - On click: disable button, inject spinner element; instantiate `ConfigGenerator` and call `generate(onProgress)`; on `"done"` show `new Notice("Mobile config generated. On mobile: Settings → About → Override config folder → .obsidian.mobile")`; on `"error"` the ConfigGenerator already fired the error notice; re-enable button and remove spinner in all cases
    - _Requirements: 4.1, 4.5, 4.7_

- [x] 11. Final checkpoint — full integration
  - Run the full Jest test suite (`npx jest --runInBand`). Ensure all tests pass, ask the user if questions arise.
  - Result: all 94 tests pass (8 suites), stable across repeated runs; `tsc --noEmit` clean under `strict`; production build emits `main.js` (7.1kb).

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- TypeScript is the implementation language throughout; no React/Preact/Vue permitted
- `fast-check` runs each property test with a minimum of 100 iterations
- Each property test carries a comment `// Feature: obsidian-mobile-optimizer, Property N: ...` for traceability
- Checkpoints validate incremental progress before advancing to the next layer
- The `formatLoadTime` and `sortMetrics` pure functions are intentionally extracted early (tasks 4 and 5) so property tests can cover them in isolation before the full DOM view is assembled

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1", "5.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "5.2", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3"] },
    { "id": 5, "tasks": ["6.4", "6.5", "8.1"] },
    { "id": 6, "tasks": ["8.2"] },
    { "id": 7, "tasks": ["8.3", "8.4", "10.1"] },
    { "id": 8, "tasks": ["10.2"] }
  ]
}
```
