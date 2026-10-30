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
3. Click **Generate Mobile Config**. This writes `.obsidian.mobile` next to your config folder, containing only each plugin's runtime files and without red-rated plugins.
4. On the mobile device: Settings → About → Override config folder → `.obsidian.mobile`.

## Install

Via [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `eristoddle/obsidian-mobile-optimizer`.
