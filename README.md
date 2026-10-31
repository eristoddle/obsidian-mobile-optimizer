# Mobile Optimizer for Obsidian

Finds which plugins are heavy enough to crash Obsidian on mobile, and generates a lean config folder for your phone or tablet.

Obsidian runs every plugin on one JavaScript thread with one shared heap, so there's no per-plugin task manager. This plugin measures each plugin indirectly:

- **Bundle size** — the size of `main.js`, which is parsed into memory at startup.
- **Stored data** — IndexedDB databases the plugin created (search indexes, caches).
- **Load time** — the plugin is briefly disabled, then its re-enable is timed.
- **Memory** — heap growth across that re-enable (desktop only, approximate).

Plugins are rated red/yellow/green from those numbers, with a small list of known mobile-heavy plugins as a floor.

## Use

1. Open the dashboard from the ribbon (phone icon).
2. Click **Measure load times**. Every enabled plugin is toggled off and on once; nothing is saved to your plugin settings.
3. Pick what goes to mobile with the **Mobile** checkbox on each row. Red plugins start unchecked, yellow and green start checked, and sync plugins (Remotely Save, Self-hosted LiveSync, Fit) start checked whatever their rating. The total above the table shows how much your mobile config will carry versus desktop. Your choices are saved; **Reset to suggestions** clears them.
4. Click **Generate Mobile Config**. This writes `.obsidian.mobile` next to your config folder, containing only the checked plugins and only their runtime files.
5. On the mobile device: Settings → Files and links → Override config folder (at the bottom, under Advanced) → `.obsidian.mobile`, then fully restart Obsidian.

If Obsidian reload-loops on iOS before you can reach Settings, open the vault in restricted mode (a newly added vault starts that way). **Set Override config folder before leaving restricted mode.** If you leave first, Obsidian offers to restore your previously installed plugins into the desktop config folder, which is the setup that was crashing.

## Install

Via [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `eristoddle/obsidian-mobile-optimizer`.
