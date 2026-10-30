// Obsidian Mobile Optimizer — Plugin entry point
// Requirements: 1.1, 1.2, 5.2, 5.3

import { Plugin, WorkspaceLeaf } from "obsidian";
import { CompatibilityEngine } from "./CompatibilityEngine";
import { Profiler } from "./Profiler";
import { DashboardView, VIEW_TYPE } from "./DashboardView";

/**
 * Root plugin class for the Obsidian Mobile Optimizer.
 *
 * Lifecycle:
 *  - `onload()`: instantiates Profiler and CompatibilityEngine, registers the
 *    DashboardView, and adds the ribbon icon.
 *  - `onunload()`: detaches all leaves of VIEW_TYPE so the dashboard is
 *    torn down cleanly (Requirement 5.3).
 */
export default class MobileOptimizerPlugin extends Plugin {
  /** Shared Profiler instance — exposed so DashboardView can read metrics. Assigned in onload(). */
  profiler!: Profiler;

  /** Shared CompatibilityEngine instance — exposed so DashboardView can classify plugins. Assigned in onload(). */
  compatEngine!: CompatibilityEngine;

  /** Keep-on-mobile choices that differ from the suggestion, by plugin id. */
  overrides: Record<string, boolean> = {};

  /**
   * Called by Obsidian when the plugin is loaded.
   *
   * Steps (Requirements 1.1, 1.2, 5.2):
   *  1. Instantiate Profiler and CompatibilityEngine.
   *  2. Register DashboardView so Obsidian knows how to construct it.
   *  3. Add the ribbon icon that opens the dashboard.
   */
  async onload(): Promise<void> {
    // Step 1 — instantiate core components.
    this.profiler = new Profiler(this.app);
    this.compatEngine = new CompatibilityEngine();
    this.overrides = (await this.loadData())?.mobileOverrides ?? {};

    // Step 2 — register the DashboardView with Obsidian (Requirement 1.2).
    this.registerView(
      VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new DashboardView(leaf, this)
    );

    // Step 3 — add ribbon icon that opens the dashboard (Requirement 1.1).
    this.addRibbonIcon("smartphone", "Mobile Optimizer", () => {
      this.activateView();
    });
  }

  /**
   * Called by Obsidian when the plugin is unloaded.
   *
   * Detaches all dashboard leaves so the DOM is released (Requirement 5.3).
   */
  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async saveOverrides(): Promise<void> {
    await this.saveData({ mobileOverrides: this.overrides });
  }

  /**
   * Open the dashboard in the right sidebar.
   *
   * If a leaf with VIEW_TYPE already exists, reveal it (avoid duplicates).
   * Otherwise, obtain a right-sidebar leaf and set its view state to the
   * dashboard (Requirement 1.2, 1.7).
   */
  async activateView(): Promise<void> {
    const { workspace } = this.app;

    // If the view is already open somewhere, bring it into focus.
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE);
    if (existingLeaves.length > 0) {
      workspace.revealLeaf(existingLeaves[0]);
      return;
    }

    // No existing leaf — open a new one in the right sidebar.
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      workspace.revealLeaf(leaf);
    }
  }
}
