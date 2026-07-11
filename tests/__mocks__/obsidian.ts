// Minimal mock of the Obsidian API for Jest tests.
// Expand as needed by individual test files.

export class Plugin {
  app: any;
  manifest: any;
  addRibbonIcon(..._args: any[]): any { return {}; }
  registerView(..._args: any[]): void {}
  addCommand(..._args: any[]): void {}
}

export class ItemView {
  leaf: any;
  contentEl: HTMLElement = document.createElement("div");
  constructor(leaf: any) { this.leaf = leaf; }
  getViewType(): string { return ""; }
  getDisplayText(): string { return ""; }
  getIcon(): string { return ""; }
}

/** Minimal HTMLElement extension with Obsidian-style helpers. */
function makeObsidianEl(): HTMLElement & {
  empty(): void;
  createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: { text?: string; cls?: string }
  ): HTMLElementTagNameMap[K];
  createDiv(opts?: { cls?: string }): HTMLDivElement;
} {
  const el = document.createElement("div") as any;

  el.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };

  el.createEl = function <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: { text?: string; cls?: string }
  ): HTMLElementTagNameMap[K] {
    const child = document.createElement(tag) as any;
    if (opts?.text) child.textContent = opts.text;
    if (opts?.cls) child.className = opts.cls;
    child.empty = el.empty.bind(child);
    child.createEl = el.createEl.bind(child);
    child.createDiv = el.createDiv.bind(child);
    child.addEventListener = child.addEventListener.bind(child);
    this.appendChild(child);
    return child;
  };

  el.createDiv = function (opts?: { cls?: string }): HTMLDivElement {
    return this.createEl("div", opts);
  };

  return el;
}

export class Modal {
  app: any;
  contentEl: ReturnType<typeof makeObsidianEl>;

  constructor(app: any) {
    this.app = app;
    this.contentEl = makeObsidianEl();
  }

  open(): void {
    if (typeof (this as any).onOpen === "function") {
      (this as any).onOpen();
    }
  }

  close(): void {
    if (typeof (this as any).onClose === "function") {
      (this as any).onClose();
    }
  }
}

// Implemented as a plain function (not an ES6 class) so `jest.spyOn` can wrap
// it and still be invoked with `new` — spying on an ES6 class triggers
// "Class constructor cannot be invoked without 'new'" when the spy calls through.
export function Notice(this: any, message: string) {
  this.message = message;
}

export class WorkspaceLeaf {}

export const App = class {};
