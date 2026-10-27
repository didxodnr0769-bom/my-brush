"use strict";
// Exercise real renderer state transitions with delayed IPC replies. No OS UI,
// global keyboard, screen compositing or IME implementation is simulated here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const preferences = require("../electron/preferences.cjs");
const geometry = require("../electron/model.cjs");
const source = fs.readFileSync(
  require.resolve("../electron/renderer/app.js"),
  "utf8",
);
const copy = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);

async function renderer() {
  const elements = new Map(),
    created = [],
    windowListeners = new Map();
  let document,
    onState,
    onCommand,
    clock = 1000,
    hideCalls = 0;
  const saves = [],
    interactions = [],
    selectedTools = [];
  class Element {
    constructor(id = "") {
      this.id = id;
      this.value = "";
      this.open = false;
      this.hidden = false;
      this.children = [];
      this.dataset = {};
      this.style = { setProperty() {} };
      this.classList = { toggle() {} };
      this.listeners = new Map();
      this.clientWidth = 1200;
      this.clientHeight = 800;
      this.captures = new Set();
    }
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    }
    emit(type, value = {}) {
      return this.listeners.get(type)?.({
        target: this,
        preventDefault() {},
        stopPropagation() {},
        ...value,
      });
    }
    setAttribute() {}
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
    }
    focus() {
      document.activeElement = this;
    }
    closest() {
      return [
        "textInput",
        "fontSizeInput",
        "widthInput",
        "customColor",
      ].includes(this.id)
        ? this
        : null;
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
    }
    setSelectionRange() {}
    hasPointerCapture(id) {
      return this.captures.has(id);
    }
    setPointerCapture(id) {
      this.captures.add(id);
    }
    releasePointerCapture(id) {
      this.captures.delete(id);
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 1200, bottom: 800 };
    }
    getContext() {
      return new Proxy(
        {},
        {
          get: (_target, name) =>
            name === "measureText"
              ? (text) => ({ width: text.length * 10 })
              : () => {},
        },
      );
    }
  }
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const toolButtons = ["pen", "rect", "text"].map((tool) => {
    const button = new Element();
    button.dataset.tool = tool;
    button.querySelector = () => new Element();
    return button;
  });
  document = {
    body: {},
    activeElement: null,
    getElementById: element,
    createElement: () => {
      const result = new Element();
      created.push(result);
      return result;
    },
    querySelectorAll(selector) {
      if (selector === "[data-tool]") return toolButtons;
      if (selector === ".color-button")
        return created.filter((e) => e.className === "color-button");
      if (selector === ".shortcut-record")
        return created.filter((e) => e.className === "shortcut-record");
      return [];
    },
    querySelector(selector) {
      const action = selector.match(/^\[data-action="(.*)"\]$/)?.[1];
      return (
        [...created].reverse().find((e) => e.dataset.action === action) || null
      );
    },
    contains: () => true,
  };
  const initial = preferences.defaults("darwin");
  const makeState = (prefs = initial, revision = 0, extra = {}) => ({
    preferences: copy(prefs),
    revision,
    platform: "darwin",
    active: true,
    visible: true,
    tool: "pen",
    blocked: false,
    registrationError: "",
    ...extra,
  });
  const window = {
    devicePixelRatio: 1,
    MyBrushPreferences: preferences,
    MyBrushGeometry: geometry,
    addEventListener: (type, callback) => windowListeners.set(type, callback),
    myBrush: {
      onState: (callback) => {
        onState = callback;
      },
      onCommand: (callback) => {
        onCommand = callback;
      },
      init: async () => makeState(),
      save: (patch) =>
        new Promise((resolve) => saves.push({ patch: copy(patch), resolve })),
      interaction: (value) => interactions.push(copy(value)),
      selectTool: (tool) => selectedTools.push(tool),
      hide: () => {
        hideCalls++;
        return Promise.resolve();
      },
      readyToHide() {},
    },
  };
  const errors = [];
  vm.runInNewContext(source, {
    window,
    document,
    Element,
    console: { error: (error) => errors.push(error) },
    performance: { now: () => clock },
    requestAnimationFrame: (callback) => callback(),
  });
  await tick();
  assert.deepEqual(errors, [], "renderer initialization succeeds");
  assert.ok(window.myBrushDebug);
  return {
    element,
    saves,
    interactions,
    selectedTools,
    initial,
    makeState,
    state: () => copy(window.myBrushDebug.getState()),
    remote: (prefs, revision, extra) =>
      onState(makeState(prefs, revision, extra)),
    command: (action) => onCommand({ action }),
    key: (event) =>
      windowListeners.get("keydown")({
        target: element("drawing"),
        key: "",
        code: "",
        preventDefault() {},
        stopPropagation() {},
        ...event,
      }),
    setClock: (value) => {
      clock = value;
    },
    hideCalls: () => hideCalls,
    toolButton: (tool) =>
      toolButtons.find((button) => button.dataset.tool === tool),
  };
}

test("pending width save preserves a newer remote color and sends only changed fields", async () => {
  const ui = await renderer();
  ui.element("widthInput").emit("input", { target: { value: "7" } });
  await tick();
  assert.deepEqual(ui.saves[0].patch, { width: 7 });
  const first = { ...ui.initial, width: 7 };
  const newer = { ...first, color: "#E26159" };
  ui.remote(first, 1);
  ui.remote(newer, 2);
  assert.equal(ui.state().preferences.width, 7);
  assert.equal(ui.state().preferences.color, "#E26159");
  // Its older reply must not replace the newer state received from another screen.
  ui.saves[0].resolve({ ok: true, preferences: first, revision: 1 });
  await tick();
  assert.equal(ui.state().preferences.color, "#E26159");
  ui.element("widthInput").emit("input", { target: { value: "8" } });
  await tick();
  assert.deepEqual(ui.saves[1].patch, { width: 8 });
  assert.equal(ui.state().preferences.color, "#E26159");
  ui.saves[1].resolve({
    ok: true,
    preferences: { ...newer, width: 8 },
    revision: 3,
  });
  await tick();
});

test("out-of-order preference revisions cannot restore stale settings", async () => {
  const ui = await renderer();
  ui.remote({ ...ui.initial, color: "#E26159", fontSize: 44 }, 5);
  ui.remote({ ...ui.initial, color: "#628EBE", fontSize: 18 }, 4);
  assert.equal(ui.state().preferences.color, "#E26159");
  assert.equal(ui.state().preferences.fontSize, 44);
});

test("queued writes retain the latest optimistic width until its own save completes", async () => {
  const ui = await renderer();
  ui.element("widthInput").emit("input", { target: { value: "7" } });
  ui.element("widthInput").emit("input", { target: { value: "9" } });
  await tick();
  assert.equal(ui.saves.length, 1, "writes remain serialized");
  const first = { ...ui.initial, width: 7, color: "#628EBE" };
  ui.remote(first, 1);
  ui.saves[0].resolve({ ok: true, preferences: first, revision: 1 });
  await tick();
  assert.deepEqual(ui.saves[1].patch, { width: 9 });
  assert.equal(ui.state().preferences.width, 9);
  assert.equal(ui.state().preferences.color, "#628EBE");
  ui.saves[1].resolve({
    ok: true,
    preferences: { ...first, width: 9 },
    revision: 2,
  });
  await tick();
  assert.equal(ui.state().preferences.width, 9);
});

test("failed preference writes revert only the optimistic value to the latest confirmed state", async () => {
  const ui = await renderer();
  ui.element("widthInput").emit("input", { target: { value: "12" } });
  await tick();
  ui.remote({ ...ui.initial, color: "#E26159" }, 1);
  ui.saves[0].resolve({ ok: false, error: "disk full" });
  await tick();
  assert.equal(ui.state().preferences.width, 4);
  assert.equal(ui.state().preferences.color, "#E26159");
  assert.equal(ui.element("announcer").textContent, "disk full");
});

test("modal and composition transitions report their owner state and protect global toggle", async () => {
  const ui = await renderer();
  ui.element("settingsButton").emit("click");
  assert.deepEqual(ui.interactions.at(-1), { modal: true, composing: false });
  ui.command("toggle");
  assert.equal(ui.state().settingsOpen, true);
  assert.equal(ui.hideCalls(), 0);
  ui.element("closeSettings").emit("click");
  assert.deepEqual(ui.interactions.at(-1), { modal: false, composing: false });
  ui.toolButton("text").emit("click");
  ui.element("drawing").emit("pointerdown", {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 200,
  });
  ui.element("textInput").value = "한글";
  ui.element("textInput").emit("compositionstart");
  assert.deepEqual(ui.interactions.at(-1), { modal: false, composing: true });
  ui.command("toggle");
  assert.equal(ui.hideCalls(), 0);
  assert.ok(ui.state().draft);
  ui.element("textInput").emit("compositionend");
  assert.deepEqual(ui.interactions.at(-1), { modal: false, composing: false });
  ui.setClock(1050);
  ui.command("toggle");
  assert.equal(ui.hideCalls(), 1);
  assert.equal(ui.state().draft, null);
  assert.equal(ui.state().objects[0].text, "한글");
});

test("a screen blocked by another modal/IME owner ignores drawing, keyboard and toolbar tools", async () => {
  const ui = await renderer();
  ui.remote(ui.initial, 0, { blocked: true, active: false });
  ui.element("drawing").emit("pointerdown", {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 200,
  });
  ui.key({ key: "r", code: "KeyR" });
  ui.toolButton("rect").emit("click");
  assert.equal(ui.state().gesture, null);
  assert.equal(ui.state().tool, "pen");
  assert.deepEqual(ui.selectedTools, []);
});
