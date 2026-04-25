import { FileSystemAdapter } from "obsidian";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { debounce } from "lodash-es";
import type { TerminalPlugin } from "../main.js";

const WRITE_DEBOUNCE_MS = 100;
const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]+/gu;

// Resolve a path template by substituting ${tmpdir} with the current OS
// temp directory and ${vault} with a sanitized vault name. Returns null
// for empty/whitespace-only templates so callers can disable tracking
// without a separate flag.
export function resolveActiveNoteTrackingPath(
  template: string,
  vaultName: string,
  tmpDir: string,
): string | null {
  const trimmed = template.trim();
  if (!trimmed) {
    return null;
  }
  const sanitizedVault = vaultName.replace(UNSAFE_FILENAME_CHARS, "_");
  return trimmed
    .replace(/\$\{tmpdir\}/gu, tmpDir)
    .replace(/\$\{vault\}/gu, sanitizedVault);
}

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

    // Workspace state isn't reliable until layout-ready, so defer the
    // initial refresh. #reconfigure() also re-runs after this fires so
    // the tracker file picks up the real active note as soon as it's
    // available.
    workspace.onLayoutReady(() => {
      this.#refreshCurrentFile();
      this.#reconfigure();
    });
    this.#reconfigure();
  }

  // Pulls the active file from the workspace. Intentionally does not
  // clear #currentFilePath when getActiveFile() returns null: when the
  // user moves focus into a terminal leaf, settings dialog, or empty
  // pane the active file is null but the "note the user is currently
  // working on" hasn't really changed.
  #refreshCurrentFile(): void {
    const {
      app: { workspace, vault },
    } = this.plugin;
    const active = workspace.getActiveFile();
    if (!active || !(vault.adapter instanceof FileSystemAdapter)) {
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
    return resolveActiveNoteTrackingPath(
      this.plugin.settings.value.activeNoteTrackingPath,
      this.plugin.app.vault.getName(),
      tmpdir(),
    );
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
