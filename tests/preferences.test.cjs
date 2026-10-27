const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const prefs = require("../electron/preferences.cjs");

test("OS defaults preserve physical Control and use platform-specific global toggle", () => {
  assert.equal(
    prefs.accelerator(prefs.defaults("darwin").shortcuts.toggle, "darwin"),
    "Control+Command+Tab",
  );
  assert.equal(
    prefs.accelerator(prefs.defaults("win32").shortcuts.toggle, "win32"),
    "Control+Shift+Space",
  );
  assert.equal(
    prefs.bindingLabel(prefs.defaults("darwin").shortcuts.toggle, "darwin"),
    "Ctrl+Cmd+Tab",
  );
  const first = prefs.defaults();
  first.shortcuts.pen.code = "KeyZ";
  assert.equal(prefs.defaults().shortcuts.pen.code, "KeyB");
});

test("Python preferences migrate size, physical key codes and custom bindings", () => {
  const shortcuts = Object.fromEntries(
    Object.entries(prefs.defaults("darwin").shortcuts).map(([id, value]) => {
      const { code, ...flags } = value;
      return [
        id,
        { key: code.startsWith("Key") ? code.slice(3) : code, ...flags },
      ];
    }),
  );
  shortcuts.pen = { key: "9", ctrl: true };
  const migrated = prefs.normalizePreferences(
    { color: "#aabbcc", width: 7, font_size: 44, shortcuts },
    "darwin",
  );
  assert.equal(migrated.color, "#AABBCC");
  assert.equal(migrated.width, 7);
  assert.equal(migrated.fontSize, 44);
  assert.deepEqual(migrated.shortcuts.pen, {
    code: "Digit9",
    ctrl: true,
    shift: false,
    alt: false,
    meta: false,
  });
  assert.equal(prefs.validateBindings(migrated.shortcuts, "darwin").error, "");
});

test("invalid, duplicate and fixed input bindings cannot be saved", () => {
  for (const code of [
    "Enter",
    "Escape",
    "ControlLeft",
    "F13",
    "CapsLock",
    "ArrowLeft",
  ]) {
    assert.ok(prefs.bindingError({ code }));
  }
  const shortcuts = prefs.defaults("darwin").shortcuts;
  shortcuts.rect = { ...shortcuts.pen };
  assert.equal(prefs.validateBindings(shortcuts, "darwin").id, "rect");
  shortcuts.rect.code = "KeyR";
  shortcuts.toggle = { code: "Space", shift: true };
  assert.equal(prefs.validateBindings(shortcuts, "darwin").id, "toggle");
  shortcuts.toggle = { code: "F12", ctrl: true };
  assert.equal(prefs.validateBindings(shortcuts, "win32").id, "toggle");
  assert.equal(prefs.validateBindings(shortcuts, "darwin").error, "");
  shortcuts.pen.ctrl = "true";
  assert.equal(prefs.validateBindings(shortcuts, "darwin").id, "pen");
});

test("malformed preferences fall back safely and clamp finite numeric ranges", () => {
  assert.deepEqual(
    prefs.normalizePreferences(null, "darwin"),
    prefs.defaults("darwin"),
  );
  const value = prefs.normalizePreferences(
    { color: "red", width: 100, fontSize: 1, shortcuts: {} },
    "darwin",
  );
  assert.equal(value.color, "#334A42");
  assert.equal(value.width, 32);
  assert.equal(value.fontSize, 12);
  assert.deepEqual(value.shortcuts, prefs.defaults("darwin").shortcuts);
  assert.equal(prefs.normalizePreferences({ width: Infinity }).width, 4);
  assert.equal(prefs.normalizePreferences({ fontSize: NaN }).fontSize, 28);
  const invalid = prefs.defaults("darwin");
  invalid.shortcuts.pen.ctrl = null;
  assert.deepEqual(
    prefs.normalizePreferences(invalid, "darwin").shortcuts,
    prefs.defaults("darwin").shortcuts,
  );
});

test("migration reads legacy preferences without altering them; current config wins", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-brush-prefs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, "legacy.json");
  const old = JSON.stringify({ color: "#aabbcc", width: 8, font_size: 50 });
  fs.writeFileSync(legacy, old);
  const userData = path.join(root, "new");
  const migrated = prefs.loadPreferences(
    userData,
    [path.join(root, "missing"), legacy],
    "darwin",
  );
  assert.equal(migrated.fontSize, 50);
  assert.equal(fs.existsSync(userData), false);
  prefs.savePreferences(userData, migrated);
  assert.equal(fs.readFileSync(legacy, "utf8"), old);
  assert.deepEqual(prefs.loadPreferences(userData, [], "darwin"), migrated);
  assert.deepEqual(fs.readdirSync(userData), ["preferences.json"]);
  fs.writeFileSync(legacy, '{"width":15}');
  assert.equal(prefs.loadPreferences(userData, [legacy], "darwin").width, 8);
  fs.writeFileSync(path.join(userData, "preferences.json"), "{broken");
  assert.equal(prefs.loadPreferences(userData, [legacy], "darwin").width, 4);
});

test("failed atomic replacement preserves existing configuration", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-brush-prefs-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destination = path.join(root, "preferences.json");
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, "keep"), "existing");
  assert.throws(() => prefs.savePreferences(root, prefs.defaults()));
  assert.equal(
    fs.readFileSync(path.join(destination, "keep"), "utf8"),
    "existing",
  );
  assert.deepEqual(fs.readdirSync(root), ["preferences.json"]);
});

test("same rules load in a sandboxed renderer with no Node globals", () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(require.resolve("../electron/preferences.cjs"), "utf8"),
    context,
  );
  assert.equal(
    context.MyBrushPreferences.defaults("win32").shortcuts.toggle.code,
    "Space",
  );
  assert.equal(
    context.MyBrushPreferences.validateBindings(
      context.MyBrushPreferences.defaults("darwin").shortcuts,
      "darwin",
    ).error,
    "",
  );
});
