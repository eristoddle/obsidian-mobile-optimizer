// Obsidian Mobile Optimizer — ConfigGenerator
// Copies .obsidian → .obsidian.mobile and patches community-plugins.json.

import { App, Modal, Notice } from "obsidian";
import { CompatibilityEngine } from "./CompatibilityEngine";

/**
 * Modal subclass that asks the user whether to overwrite the existing
 * `.obsidian.mobile` folder.  Resolves `true` if the user confirms,
 * `false` if they cancel or dismiss the modal.
 */
class OverwriteConfirmModal extends Modal {
  private resolve!: (value: boolean) => void;
  readonly promise: Promise<boolean>;

  constructor(app: App) {
    super(app);
    this.promise = new Promise<boolean>((res) => {
      this.resolve = res;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Overwrite existing mobile config?" });
    contentEl.createEl("p", {
      text: ".obsidian.mobile already exists. Continuing will overwrite its contents. Do you want to proceed?",
    });

    const btnRow = contentEl.createDiv({ cls: "modal-button-container" });

    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.resolve(false);
      this.close();
    });

    const confirmBtn = btnRow.createEl("button", {
      text: "Overwrite",
      cls: "mod-warning",
    });
    confirmBtn.addEventListener("click", () => {
      this.resolve(true);
      this.close();
    });
  }

  onClose(): void {
    // If the modal is dismissed without clicking either button (e.g. Escape
    // key), treat it as a cancellation.
    this.resolve(false);
    this.contentEl.empty();
  }
}

export class ConfigGenerator {
  constructor(private app: App, private compatEngine: CompatibilityEngine) {}

  /**
   * Entry point called when "Generate Mobile Config" is clicked.
   *
   * Flow (Requirements 4.1, 4.2, 4.4, 4.6, 4.7, 4.8):
   *   1. Verify `.obsidian` exists → error notification + return if not.
   *   2. If `.obsidian.mobile` already exists → ask for confirmation; abort if cancelled.
   *   3. Signal `"start"` via onProgress.
   *   4. Run copyRecursive(.obsidian → .obsidian.mobile).
   *   5. Run patchCommunityPlugins(.obsidian.mobile).
   *   6. Signal `"done"` on success or `"error"` on failure.
   */
  async generate(
    onProgress: (state: "start" | "done" | "error") => void
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    const src = ".obsidian";
    const dest = ".obsidian.mobile";

    // Requirement 4.8 — source folder must exist.
    const srcExists = await adapter.exists(src);
    if (!srcExists) {
      new Notice(
        "Config folder `.obsidian` not found. Cannot generate mobile config."
      );
      return;
    }

    // Requirement 4.4 — ask before overwriting an existing destination.
    const destExists = await adapter.exists(dest);
    if (destExists) {
      const confirmed = await this.confirmOverwrite();
      if (!confirmed) {
        return; // Silent abort (user cancelled).
      }
    }

    onProgress("start");

    try {
      await this.copyRecursive(src, dest);
      await this.patchCommunityPlugins(dest);
      onProgress("done");
    } catch {
      // I/O error notifications are already shown inside copyRecursive /
      // patchCommunityPlugins; here we just signal the error state.
      onProgress("error");
    }
  }

  /**
   * Recursively copies the directory tree at `srcPath` into `destPath`.
   *
   * Algorithm (Requirements 4.2, 4.6):
   *   1. mkdir(destPath)
   *   2. list(srcPath) → { files, folders }
   *   3. For each file: copy via adapter.copy; fall back to read+write.
   *   4. For each sub-folder: recurse.
   *
   * On any I/O error the failing path is included in an error Notice and
   * the error is re-thrown so `generate()` can signal `"error"`.
   */
  private async copyRecursive(
    srcPath: string,
    destPath: string
  ): Promise<void> {
    const adapter = this.app.vault.adapter;

    try {
      await adapter.mkdir(destPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`Error copying ${destPath}: ${msg}`);
      throw e;
    }

    let listing: { files: string[]; folders: string[] };
    try {
      listing = await adapter.list(srcPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`Error copying ${srcPath}: ${msg}`);
      throw e;
    }

    // Copy each file.
    for (const filePath of listing.files) {
      // Derive the destination file path by replacing the srcPath prefix.
      const relativePart = filePath.slice(srcPath.length);
      const destFilePath = destPath + relativePart;

      try {
        if (typeof (adapter as any).copy === "function") {
          await (adapter as any).copy(filePath, destFilePath);
        } else {
          // Fallback: read + write.
          const content = await adapter.read(filePath);
          await adapter.write(destFilePath, content);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        new Notice(`Error copying ${filePath}: ${msg}`);
        throw e;
      }
    }

    // Recurse into each sub-folder.
    for (const folderPath of listing.folders) {
      const relativePart = folderPath.slice(srcPath.length);
      const destFolderPath = destPath + relativePart;
      await this.copyRecursive(folderPath, destFolderPath);
    }
  }

  /**
   * Patches `<destPath>/community-plugins.json` by removing any plugin
   * IDs classified as "red".  If the file does not exist, writes `[]`
   * instead (Requirement 4.3).
   *
   * Flow:
   *   1. If the file is missing → write `[]` and return.
   *   2. Read + parse JSON array of plugin ID strings.
   *   3. On parse error → show error Notice and stop (do not throw, so
   *      generate() can re-throw and signal "error" itself).
   *   4. Filter out any IDs where classify() === "red".
   *   5. Write the filtered array back as compact JSON.
   */
  private async patchCommunityPlugins(destPath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const filePath = `${destPath}/community-plugins.json`;

    // Step 1 — file missing → create empty list.
    const fileExists = await adapter.exists(filePath);
    if (!fileExists) {
      await adapter.write(filePath, "[]");
      return;
    }

    // Step 2 — read + parse.
    const raw = await adapter.read(filePath);
    let ids: string[];
    try {
      ids = JSON.parse(raw) as string[];
    } catch {
      // Step 3 — invalid JSON → error notification, stop without throwing.
      new Notice(
        `Mobile config: could not parse ${filePath}. community-plugins.json was not modified.`
      );
      return;
    }

    // Step 4 — filter out Red-classified IDs, preserving relative order.
    const filtered = ids.filter(
      (id) => this.compatEngine.classify(id) !== "red"
    );

    // Step 5 — write filtered array back.
    await adapter.write(filePath, JSON.stringify(filtered));
  }

  /**
   * Displays the overwrite-confirmation modal and returns the user's choice.
   * Returns `true` if the user confirmed, `false` if cancelled or dismissed.
   *
   * Requirement 4.4.
   */
  private async confirmOverwrite(): Promise<boolean> {
    const modal = new OverwriteConfirmModal(this.app);
    modal.open();
    return modal.promise;
  }
}
