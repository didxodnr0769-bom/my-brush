"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const kinds = new Set([
  "down",
  "up",
  "mouseup",
  "lost",
  "cancel",
  "blur",
  "pending-release",
  "boundary",
  "finish",
  "capture-error",
  "focus",
  "control-down",
  "control-up",
]);
function metadata(raw = {}) {
  if (!raw || typeof raw !== "object") raw = {};
  const out = {};
  if (kinds.has(raw.kind)) out.kind = raw.kind;
  for (const key of [
    "pointer",
    "button",
    "buttons",
    "time",
    "points",
    "objects",
  ])
    if (Number.isFinite(raw[key])) out[key] = raw[key];
  for (const key of ["control", "captured", "focused", "pending"])
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  if (["pen", "rect", "delete"].includes(raw.tool)) out.tool = raw.tool;
  return out;
}
function sanitize(report = {}) {
  if (!report || typeof report !== "object") return null;
  const reasons = new Set([
    "capture-release-pending",
    "capture-lost",
    "pointer-cancel",
    "window-blur",
    "capture-unavailable",
    "control-released",
    "control-flag-lost",
  ]);
  if (!reasons.has(report.reason)) return null;
  return {
    reason: report.reason,
    events: Array.isArray(report.events)
      ? report.events.slice(-16).map(metadata)
      : [],
  };
}
function createInputDiagnostics(directory) {
  const filename = path.join(directory, "input-diagnostics.jsonl");
  let queued = Promise.resolve();
  function record(report, native = {}) {
    const safe = sanitize(report);
    if (!safe) return queued;
    const entry = {
      at: Date.now(),
      ...safe,
      native: {
        focused: !!native.focused,
        visible: !!native.visible,
        appHidden: !!native.appHidden,
        version: String(native.version || "").slice(0, 16),
        events: (Array.isArray(native.events) ? native.events : [])
          .slice(-12)
          .map(metadata),
      },
    };
    queued = queued
      .then(async () => {
        await fs.mkdir(directory, { recursive: true });
        const existing = await fs.readFile(filename, "utf8").catch(() => "");
        const lines = (existing + JSON.stringify(entry) + "\n")
          .trim()
          .split("\n")
          .slice(-32);
        await fs.writeFile(filename, lines.join("\n") + "\n", { mode: 0o600 });
      })
      .catch(() => {});
    return queued;
  }
  return { record, flush: () => queued, filename };
}
module.exports = { metadata, sanitize, createInputDiagnostics };
