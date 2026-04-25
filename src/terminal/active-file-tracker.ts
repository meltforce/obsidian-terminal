import { FileSystemAdapter } from "obsidian";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { debounce } from "lodash-es";
import type { TerminalPlugin } from "../main.js";

const WRITE_DEBOUNCE_MS = 100;
const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]+/gu;

export class ActiveFileTracker {
  #currentFilePath: string | null = null;
  #outputFilePath: string | null = null;

  public constructor(private readonly plugin: TerminalPlugin) {}

  // Absolute path of the note currently active in Obsidian, or null.
  public get currentFilePath(): string | null {
    return this.#currentFilePath;
  }

  // Path to the tracker file when tracking is enabled, otherwise null.
  public get outputFilePath(): string | null {
    return this.#outputFilePath;
  }

  public load(): void {
    const { plugin } = this,
      {
        app: { workspace },
        settings,
      } = plugin,
      onChange = (): void => {
        this.#refreshCurrentFile();
        this.#scheduleWrite();
      };

    plugin.registerEvent(workspace.on("active-leaf-change", onChange));
    plugin.registerEvent(workspace.on("file-open", onChange));
    plugin.register(
      settings.onMutate(
        (s) => s.activeNoteTracking,
        () => {
          this.#reconfigure();
        },
      ),
    );
    plugin.register(
      settings.onMutate(
        (s) => s.activeNoteTrackingPath,
        () => {
          this.#reconfigure();
        },
      ),
    );
    plugin.register(() => {
      void this.#cleanup();
    });

    this.#refreshCurrentFile();
    this.#reconfigure();
  }

  #refreshCurrentFile(): void {
    const {
      app: { workspace, vault },
    } = this.plugin;
    const active = workspace.getActiveFile();
    if (!active || !(vault.adapter instanceof FileSystemAdapter)) {
      this.#currentFilePath = null;
      return;
    }
    this.#currentFilePath = vault.adapter.getFullPath(active.path);
  }

  #reconfigure(): void {
    const enabled = this.plugin.settings.value.activeNoteTracking,
      previous = this.#outputFilePath,
      next = enabled ? this.#resolveOutputPath() : null;
    this.#outputFilePath = next;
    if (previous && previous !== next) {
      void fs.unlink(previous).catch(() => {
        /* best effort */
      });
    }
    if (next) {
      this.#scheduleWrite();
    }
  }

  #resolveOutputPath(): string | null {
    const template = this.plugin.settings.value.activeNoteTrackingPath.trim();
    if (!template) {
      return null;
    }
    const vaultName = this.plugin.app.vault
      .getName()
      .replace(UNSAFE_FILENAME_CHARS, "_");
    return template
      .replace(/\$\{tmpdir\}/gu, tmpdir())
      .replace(/\$\{vault\}/gu, vaultName);
  }

  #scheduleWrite = debounce(() => {
    void this.#writeNow();
  }, WRITE_DEBOUNCE_MS);

  async #writeNow(): Promise<void> {
    const out = this.#outputFilePath;
    if (!out) {
      return;
    }
    const content = `${this.#currentFilePath ?? ""}\n`;
    try {
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, content, { encoding: "utf8" });
    } catch (error) {
      self.console.warn(
        "active-file-tracker: failed to write tracker file",
        out,
        error,
      );
    }
  }

  async #cleanup(): Promise<void> {
    this.#scheduleWrite.cancel();
    const out = this.#outputFilePath;
    if (!out) {
      return;
    }
    try {
      await fs.unlink(out);
    } catch {
      /* best effort */
    }
  }
}

export function loadActiveFileTracker(
  plugin: TerminalPlugin,
): ActiveFileTracker {
  const tracker = new ActiveFileTracker(plugin);
  tracker.load();
  return tracker;
}
