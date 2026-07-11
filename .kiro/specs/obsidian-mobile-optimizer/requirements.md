# Requirements Document

## Introduction

The Obsidian Mobile Optimizer is an Obsidian.md community plugin that helps users diagnose which installed plugins are likely to cause performance degradation or crashes on mobile devices. It presents a sidebar dashboard with plugin-level performance metrics and mobile-compatibility ratings, then allows users to generate a mobile-safe Obsidian configuration folder they can use via the "Override config folder" setting on mobile.

The plugin is built in TypeScript using only the Obsidian Plugin API and native DOM manipulation — no React or Preact — to remain lightweight and avoid adding to the problem it solves.

## Glossary

- **Plugin**: An Obsidian community plugin installed in the current vault.
- **Dashboard**: The custom sidebar view (ItemView) opened via the ribbon icon that displays all plugin information.
- **Profiler**: The component that measures per-plugin load times using `performance.now()` around plugin registration hooks.
- **Compatibility_Engine**: The component that classifies each plugin as Red (unsafe), Yellow (caution), or Green (safe) for mobile use based on a hardcoded compatibility database.
- **Compatibility_Database**: A hardcoded map of known plugin IDs to their mobile compatibility classification.
- **Traffic_Light**: The Red/Yellow/Green visual indicator shown next to each plugin in the Dashboard.
- **Config_Generator**: The component that creates a mobile-safe configuration folder by cloning `.obsidian` and removing Red-flagged plugins.
- **Mobile_Config**: The generated configuration folder stored at `.obsidian.mobile`.
- **community-plugins.json**: The Obsidian file at `.obsidian/community-plugins.json` that lists enabled community plugins by ID.
- **Load_Time**: The elapsed time in milliseconds measured using `performance.now()` during plugin initialization.

---

## Requirements

### Requirement 1: Sidebar Dashboard

**User Story:** As an Obsidian user, I want to open a sidebar panel that lists all my installed community plugins with their compatibility status and performance data, so that I can quickly see which plugins may be causing mobile issues.

#### Acceptance Criteria

1. THE Dashboard SHALL register a ribbon icon in the Obsidian left ribbon that opens the Dashboard view when clicked.
2. WHEN the ribbon icon is clicked, THE Dashboard SHALL open as an ItemView in the right sidebar using the Obsidian `ItemView` API.
3. THE Dashboard SHALL display each installed community plugin, including both enabled and disabled plugins, as a row showing: the plugin name, a Traffic_Light indicator with one of three states (Green, Yellow, or Red), and the measured Load_Time displayed as a whole number in milliseconds.
4. WHEN a plugin is not found in the Compatibility_Database, THE Dashboard SHALL display a Yellow Traffic_Light for that plugin and SHALL NOT display a Green or Red Traffic_Light for that plugin.
5. WHEN the "Refresh" button is clicked, THE Dashboard SHALL re-run the Profiler and re-render the plugin list with updated data without triggering an Obsidian reload.
6. IF the Load_Time for a plugin cannot be measured, THEN THE Dashboard SHALL display a dash ("—") in place of the numeric Load_Time value for that plugin.
7. WHILE the Dashboard tab is open in the Obsidian sidebar, THE Dashboard SHALL remain visible as a tab icon in the sidebar and be selectable even when other sidebar panels are active.

---

### Requirement 2: Resource Profiler

**User Story:** As an Obsidian user, I want to see how long each plugin took to load, so that I can identify plugins that are slow to initialize and may degrade performance on resource-constrained mobile devices.

#### Acceptance Criteria

1. WHEN the Dashboard is opened, THE Profiler SHALL measure the Load_Time for each installed plugin using `performance.now()` timestamps captured at plugin load.
2. THE Profiler SHALL display Load_Time values in milliseconds rounded to two decimal places.
3. IF per-plugin memory data is unavailable via the Obsidian API, THEN THE Profiler SHALL omit memory metrics from the display rather than showing misleading or zero values.
4. IF a plugin's Load_Time cannot be measured (e.g., already loaded before the Profiler hook ran), THEN THE Profiler SHALL display "N/A" for both the Load_Time and any memory fields for that plugin, and those plugins SHALL be sorted to the bottom of the plugin list regardless of sort order.
5. THE Dashboard SHALL sort the plugin list by Load_Time in descending order by default each time the Dashboard is opened, with ties broken alphabetically by plugin name in ascending order.
6. THE Profiler SHALL treat "installed plugins" as all plugins registered in Obsidian's internal plugin registry, regardless of whether each plugin is currently enabled or disabled.

---

### Requirement 3: Mobile Compatibility Engine

**User Story:** As an Obsidian user, I want each plugin to be rated for mobile compatibility, so that I can immediately understand which plugins are risky to keep enabled on mobile.

#### Acceptance Criteria

1. THE Compatibility_Engine SHALL classify each installed plugin as exactly one of three states: Red (known to be resource-heavy, CPU/memory-intensive, or otherwise incompatible with mobile constraints), Yellow (classification unknown or plugin not tested on mobile), or Green (known to be lightweight and confirmed safe for mobile use).
2. THE Compatibility_Database SHALL include at minimum the following Red-classified plugins by their plugin ID: `dataview`, `omnisearch`, `obsidian-excalidraw-plugin`, `obsidian-kanban`, `obsidian-git`, `surfing`, `table-editor-obsidian`, and `obsidian-tasks-plugin`.
3. THE Compatibility_Database SHALL include at minimum the following Green-classified plugins by their plugin ID: `templater-obsidian`, `calendar`, `nldates-obsidian`, and `quickadd`. WHERE a plugin ID appears in both the Red and Green lists, THE Compatibility_Engine SHALL apply the Red classification and ignore the Green entry for that plugin ID.
4. WHEN a plugin ID is not found in the Compatibility_Database, THE Compatibility_Engine SHALL classify it as Yellow.
5. THE Dashboard SHALL render each plugin's Traffic_Light as a colored dot or badge: a red indicator for Red, an amber indicator for Yellow, and a green indicator for Green.
6. WHEN the plugin list is rendered, THE Dashboard SHALL display a Recommendations section below the plugin list that enumerates all currently installed plugins classified as Red and includes a recommendation to disable each one on mobile.
7. WHEN no installed plugins are classified as Red, THE Dashboard SHALL display the Recommendations section with a message stating that no high-risk plugins were detected, and SHALL NOT list any plugin names in that section.

---

### Requirement 4: Mobile Config Generator

**User Story:** As an Obsidian user, I want to generate a mobile-safe configuration automatically, so that I can use it on my phone without manually editing configuration files.

#### Acceptance Criteria

1. THE Dashboard SHALL display a "Generate Mobile Config" button in the Dashboard view.
2. WHEN the "Generate Mobile Config" button is clicked, THE Config_Generator SHALL copy the entire `.obsidian` folder recursively to `.obsidian.mobile` within the vault root.
3. WHEN copying to `.obsidian.mobile`, THE Config_Generator SHALL read the `community-plugins.json` file from the copied folder and write a modified version that excludes all plugin IDs classified as Red by the Compatibility_Engine. IF `community-plugins.json` does not exist in the source `.obsidian` folder, THEN THE Config_Generator SHALL create an empty array `[]` at `.obsidian.mobile/community-plugins.json`.
4. IF `.obsidian.mobile` already exists at the time the button is clicked, THEN THE Config_Generator SHALL display a confirmation prompt to the user before proceeding. IF the user cancels the confirmation prompt, THEN THE Config_Generator SHALL abort the operation and leave `.obsidian.mobile` unchanged.
5. WHEN the Mobile_Config has been successfully generated, THE Config_Generator SHALL display a notification informing the user to go to Settings → About → Override config folder on their mobile device and enter `.obsidian.mobile`.
6. IF an error occurs during folder copy or file write, THEN THE Config_Generator SHALL display an error notification that includes the name of the file or folder where the failure occurred, and SHALL leave any partially written files in place for user inspection.
7. WHEN the "Generate Mobile Config" button is clicked, THE Config_Generator SHALL disable the button and display a loading indicator within or adjacent to the button until the operation completes or fails, after which the button SHALL be re-enabled.
8. IF the source `.obsidian` folder does not exist or is not accessible at the time the button is clicked, THEN THE Config_Generator SHALL display an error notification stating that the configuration folder could not be found and SHALL NOT attempt to create `.obsidian.mobile`.

---

### Requirement 5: Plugin Architecture and Compatibility

**User Story:** As a developer maintaining this plugin, I want the plugin to be built with a lightweight, dependency-free architecture, so that the optimizer itself does not contribute to the mobile performance problems it is designed to solve.

#### Acceptance Criteria

1. THE Plugin SHALL be implemented in TypeScript using only the Obsidian Plugin API and native browser DOM APIs, with no React, Preact, or other UI framework dependencies declared in `package.json` or imported at runtime.
2. THE Plugin SHALL register all event listeners, views, and ribbon icons within the `onload` lifecycle method and SHALL deregister or destroy each of them within the `onunload` lifecycle method.
3. WHEN the plugin is unloaded, THE Plugin SHALL call `this.app.workspace.detachLeavesOfType(VIEW_TYPE)` to remove the Dashboard view from the sidebar and release all associated DOM elements.
4. THE Plugin SHALL declare a `manifest.json` with `isDesktopOnly` set to `false` so that the plugin can be installed and run on Obsidian Mobile.
5. THE Plugin SHALL store the Compatibility_Database as a static TypeScript object or `Map` initialized at module load time and SHALL NOT make any outbound network requests to fetch, update, or validate compatibility data at any point during its lifecycle.
