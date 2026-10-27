"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const {
  sanitize,
  createInputDiagnostics,
} = require("../electron/input-diagnostics.cjs");
test("input diagnostics exclude coordinates, text and arbitrary data and bound event history", () => {
  const report = sanitize({
    reason: "capture-release-pending",
    text: "private",
    events: Array.from({ length: 40 }, () => ({
      kind: "lost",
      pointer: 1,
      buttons: 0,
      control: true,
      clientX: 123,
      x: 123,
      text: "private",
      key: "secret",
    })),
  });
  assert.equal(report.events.length, 16);
  assert.deepEqual(report.events[0], {
    kind: "lost",
    pointer: 1,
    buttons: 0,
    control: true,
  });
  assert.equal(JSON.stringify(report).includes("private"), false);
  assert.equal(sanitize(null), null);
  assert.equal(sanitize({ reason: "arbitrary" }), null);
  assert.deepEqual(sanitize({ reason: "window-blur", events: [null] }).events, [
    {},
  ]);
});
test("diagnostic writes are serialized, private and limited to 32 local reports", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "brush-diagnostic-test-"),
  );
  try {
    const logger = createInputDiagnostics(directory);
    for (let i = 0; i < 40; i++)
      logger.record(
        {
          reason: "capture-release-pending",
          events: [{ kind: "lost", time: i }],
        },
        {
          focused: true,
          version: "0.2.2",
          events: [{ kind: "up", x: 123, text: "private" }],
        },
      );
    await logger.flush();
    const content = await fs.readFile(logger.filename, "utf8");
    const lines = content.trim().split("\n").map(JSON.parse);
    assert.equal(lines.length, 32);
    assert.equal(lines[0].events[0].time, 8);
    assert.equal(lines.at(-1).events[0].time, 39);
    assert.equal(content.includes("private"), false);
    assert.equal(content.includes('"x"'), false);
    if (process.platform !== "win32")
      assert.equal((await fs.stat(logger.filename)).mode & 0o777, 0o600);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
