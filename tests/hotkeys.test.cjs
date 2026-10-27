"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHotkeys } = require("../electron/hotkeys.cjs");
const { defaults } = require("../electron/preferences.cjs");

function fixture() {
  const calls = [];
  const keys = new Set();
  const callback = () => {};
  const os = {
    fail: false,
    throwError: false,
    register(key, handler) {
      calls.push(["register", key]);
      assert.equal(handler, callback);
      if (this.throwError) throw new Error("OS unavailable");
      if (this.fail || keys.has(key)) return false;
      keys.add(key);
      return true;
    },
    unregister(key) {
      calls.push(["unregister", key]);
      keys.delete(key);
    },
  };
  const manager = createHotkeys(os, callback, "darwin");
  const first = defaults("darwin").shortcuts.toggle;
  const next = { ...first, code: "Space" };
  return { calls, keys, os, manager, first, next };
}

test("install registers the startup binding and exposes only its successful OS key", () => {
  const { manager, first, keys, calls } = fixture();
  assert.equal(manager.current, "");
  assert.deepEqual(manager.install(first), { ok: true, error: "" });
  assert.equal(manager.current, "Control+Command+Tab");
  assert.deepEqual([...keys], ["Control+Command+Tab"]);
  assert.deepEqual(calls, [["register", "Control+Command+Tab"]]);
});

test("startup registration false can retry the identical binding later", () => {
  const { manager, first, os, calls } = fixture();
  os.fail = true;
  assert.equal(manager.install(first).ok, false);
  assert.equal(manager.current, "");
  os.fail = false;
  let saved = false;
  assert.equal(
    manager.apply(first, () => {
      saved = true;
    }).ok,
    true,
  );
  assert.equal(saved, true);
  assert.equal(manager.current, "Control+Command+Tab");
  assert.deepEqual(calls, [
    ["register", "Control+Command+Tab"],
    ["register", "Control+Command+Tab"],
  ]);
});

test("registration false or exception leaves the old shortcut and disk untouched", () => {
  for (const failure of ["fail", "throwError"]) {
    const { manager, first, next, os, keys, calls } = fixture();
    manager.install(first);
    os[failure] = true;
    assert.equal(
      manager.apply(next, () => {
        throw new Error("persist should not run");
      }).ok,
      false,
    );
    assert.equal(manager.current, "Control+Command+Tab");
    assert.deepEqual([...keys], ["Control+Command+Tab"]);
    assert.deepEqual(calls, [
      ["register", "Control+Command+Tab"],
      ["register", "Control+Command+Space"],
    ]);
  }
});

test("disk failure rolls back only the new registration and retains the working old key", () => {
  const { manager, first, next, keys, calls } = fixture();
  manager.install(first);
  const result = manager.apply(next, () => {
    calls.push(["save"]);
    throw new Error("disk full");
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /disk full/);
  assert.equal(manager.current, "Control+Command+Tab");
  assert.deepEqual([...keys], ["Control+Command+Tab"]);
  assert.deepEqual(calls, [
    ["register", "Control+Command+Tab"],
    ["register", "Control+Command+Space"],
    ["save"],
    ["unregister", "Control+Command+Space"],
  ]);
});

test("same registered key saves preferences without duplicate OS registration", () => {
  const { manager, first, calls, keys } = fixture();
  manager.install(first);
  assert.equal(
    manager.apply({ ...first }, () => {
      calls.push(["save"]);
    }).ok,
    true,
  );
  assert.deepEqual(calls, [["register", "Control+Command+Tab"], ["save"]]);
  assert.equal(
    manager.apply(first, () => {
      throw new Error("disk full");
    }).ok,
    false,
  );
  assert.equal(manager.current, "Control+Command+Tab");
  assert.deepEqual([...keys], ["Control+Command+Tab"]);
  assert.equal(calls.length, 2);
});

test("replacement registers, persists, then releases the old key in that order", () => {
  const { manager, first, next, calls, keys } = fixture();
  manager.install(first);
  const result = manager.apply(next, () => {
    calls.push(["save"]);
    assert.equal(manager.current, "Control+Command+Tab");
    assert.equal(keys.size, 2);
  });
  assert.equal(result.ok, true);
  assert.equal(manager.current, "Control+Command+Space");
  assert.deepEqual([...keys], ["Control+Command+Space"]);
  assert.deepEqual(calls, [
    ["register", "Control+Command+Tab"],
    ["register", "Control+Command+Space"],
    ["save"],
    ["unregister", "Control+Command+Tab"],
  ]);
});

test("invalid key never reaches OS registration or persistence", () => {
  const { manager, calls } = fixture();
  assert.equal(manager.install({ code: "Enter", ctrl: true }).ok, false);
  assert.equal(manager.current, "");
  assert.deepEqual(calls, []);
});
