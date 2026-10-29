import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunState } from "../../domain/run-state.js";
import { AtomicJsonStore } from "./atomic-json-store.js";

describe("AtomicJsonStore", () => {
  // @covers bus:BEH-004
  it("writes the snapshot as parseable JSON and leaves no temporary file behind", async () => {
    const directory = await mkdtemp(join(tmpdir(), "state-"));
    const store = new AtomicJsonStore(join(directory, "run", "state.json"));
    const state = createRunState({ runId: "todo-cli-20261029-120000", slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });

    await store.write(state);
    await store.write({ ...state, status: "workspace" });

    const written: unknown = JSON.parse(await readFile(join(directory, "run", "state.json"), "utf8"));
    expect([written, await readdir(join(directory, "run"))]).toEqual([{ ...state, status: "workspace" }, ["state.json"]]);
  });
});
