/**
 * Unit tests for `src/terminal/active-file-tracker.ts` —
 * pure-function path template resolution.
 */
import { describe, it, expect } from "vitest";
import { resolveActiveNoteTrackingPath } from "../../../src/terminal/active-file-tracker.js";

describe("resolveActiveNoteTrackingPath", () => {
  it("substitutes ${tmpdir} and ${vault}", () => {
    expect(
      resolveActiveNoteTrackingPath(
        "${tmpdir}/obsidian-active-${vault}",
        "myvault",
        "/tmp",
      ),
    ).toBe("/tmp/obsidian-active-myvault");
  });

  it("sanitizes vault names that contain unsafe filename chars", () => {
    expect(
      resolveActiveNoteTrackingPath(
        "${tmpdir}/${vault}",
        "My Vault: drafts/work",
        "/tmp",
      ),
    ).toBe("/tmp/My_Vault_drafts_work");
  });

  it("returns null for empty or whitespace-only templates", () => {
    expect(resolveActiveNoteTrackingPath("", "v", "/tmp")).toBe(null);
    expect(resolveActiveNoteTrackingPath("   ", "v", "/tmp")).toBe(null);
  });

  it("leaves literal path with no placeholders untouched", () => {
    expect(
      resolveActiveNoteTrackingPath("/var/run/active-note", "v", "/tmp"),
    ).toBe("/var/run/active-note");
  });

  it("substitutes multiple occurrences of the same placeholder", () => {
    expect(
      resolveActiveNoteTrackingPath("${tmpdir}/a/${tmpdir}/b", "v", "/tmp"),
    ).toBe("/tmp/a//tmp/b");
  });
});
