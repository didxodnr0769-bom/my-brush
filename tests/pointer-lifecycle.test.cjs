"use strict";
// Regression checks execute the real renderer against a small DOM/IPC fixture.
// Event ordering is explicit; these checks do not reproduce native macOS input.
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

async function renderer(platform = "darwin", { deferFrames = false } = {}) {
  const frames = [];
  const elements = new Map(),
    created = [],
    windowListeners = new Map();
  let document,
    window,
    clock = 1000,
    onCommand;
  const add = (listeners, type, callback, options) => {
    const values = listeners.get(type) || [];
    values.push({ callback, capture: options === true || !!options?.capture });
    listeners.set(type, values);
  };
  function call(listeners, type, event, capture) {
    for (const listener of listeners.get(type) || [])
      if (capture === undefined || listener.capture === capture)
        listener.callback(event);
  }
  function event(type, target, data = {}) {
    return {
      type,
      target,
      currentTarget: target,
      timeStamp: ++clock,
      pointerType: "mouse",
      pointerId: 1,
      button: 0,
      buttons: type.endsWith("up") ? 0 : 1,
      clientX: 10,
      clientY: 10,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      key: "",
      code: "",
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      ...data,
    };
  }
  class Element {
    constructor(id = "") {
      Object.assign(this, {
        id,
        value: "",
        open: false,
        hidden: false,
        children: [],
        dataset: {},
        style: { setProperty() {} },
        classList: { toggle() {} },
        listeners: new Map(),
        clientWidth: 1200,
        clientHeight: 800,
        captures: new Set(),
      });
    }
    addEventListener(type, callback, options) {
      add(this.listeners, type, callback, options);
    }
    emit(type, data = {}) {
      const value = event(type, this, data);
      value.currentTarget = window;
      call(windowListeners, type, value, true);
      value.currentTarget = this;
      call(this.listeners, type, value);
      value.currentTarget = window;
      call(windowListeners, type, value, false);
      return value;
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
  const tools = ["pen", "rect", "text"].map((tool) => {
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
      const value = new Element();
      created.push(value);
      return value;
    },
    querySelectorAll(selector) {
      if (selector === "[data-tool]") return tools;
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
  window = {
    devicePixelRatio: 1,
    MyBrushPreferences: preferences,
    MyBrushGeometry: geometry,
    addEventListener(type, callback, options) {
      add(windowListeners, type, callback, options);
    },
    myBrush: {
      onState() {},
      onCommand(callback) {
        onCommand = callback;
      },
      init: async () => ({
        preferences: preferences.defaults(platform),
        revision: 0,
        platform,
        active: true,
        visible: true,
        tool: "pen",
        blocked: false,
        registrationError: "",
      }),
      save: async () => ({ ok: false, error: "not used" }),
      interaction() {},
      selectTool() {},
      hide: async () => {},
      readyToHide() {},
    },
  };
  const errors = [];
  vm.runInNewContext(source, {
    window,
    document,
    Element,
    console: { error: (e) => errors.push(e) },
    performance: { now: () => clock },
    requestAnimationFrame: (callback) => {
      if (deferFrames) frames.push(callback);
      else callback();
      return frames.length;
    },
    setTimeout,
    clearTimeout,
    queueMicrotask,
  });
  await new Promise(setImmediate);
  assert.deepEqual(errors, []);
  assert.ok(window.myBrushDebug, "renderer initialized");
  const canvas = element("drawing");
  return {
    canvas,
    command(action) {
      onCommand({ action });
    },
    flushFrame() {
      const callbacks = frames.splice(0);
      for (const callback of callbacks) callback(clock);
    },
    pendingFrames: () => frames.length,
    state: () => copy(window.myBrushDebug.getState()),
    windowEvent(type, data = {}) {
      const value = event(type, window, data);
      value.currentTarget = window;
      call(windowListeners, type, value, true);
      call(windowListeners, type, value, false);
      return value;
    },
    down(data) {
      canvas.emit("pointerdown", data);
    },
    move(data) {
      canvas.emit("pointermove", data);
    },
    up(data) {
      canvas.emit("pointerup", data);
    },
    draw() {
      canvas.emit("pointerdown", { clientX: 20, clientY: 20 });
      canvas.emit("pointermove", { clientX: 180, clientY: 100 });
      canvas.emit("pointerup", { clientX: 180, clientY: 100 });
    },
  };
}

for (const type of ["pointercancel", "lostpointercapture"]) {
  test(`an unrelated ${type} does not discard the active mouse stroke`, async () => {
    const ui = await renderer();
    ui.down({ clientX: 20, clientY: 20 });
    ui.move({ clientX: 80, clientY: 60 });
    ui.canvas.emit(type, { pointerId: 2, pointerType: "touch" });
    assert.equal(ui.state().gesture?.type, "pen");
    ui.up({ clientX: 100, clientY: 80 });
    assert.equal(ui.state().objects.length, 1);
  });
}

test("window pointerup completes a stroke even when the release target is outside the canvas", async () => {
  const ui = await renderer();
  ui.down({ clientX: 20, clientY: 20 });
  ui.move({ clientX: 80, clientY: 60 });
  ui.windowEvent("pointerup", { clientX: 130, clientY: 90 });
  assert.equal(ui.state().gesture, null);
  assert.equal(ui.state().objects.length, 1);
  assert.deepEqual(ui.state().objects[0].points.at(-1), { x: 130, y: 90 });
});

test("window mouseup fallback completes one mouse stroke without duplicate objects", async () => {
  const ui = await renderer();
  ui.down({ clientX: 20, clientY: 20 });
  ui.move({ clientX: 80, clientY: 60 });
  ui.windowEvent("mouseup", {
    pointerId: undefined,
    clientX: 110,
    clientY: 80,
  });
  assert.equal(ui.state().objects.length, 1);
  assert.equal(ui.state().gesture, null);
  ui.windowEvent("pointerup", { clientX: 110, clientY: 80 });
  ui.canvas.emit("lostpointercapture", { buttons: 0 });
  assert.equal(ui.state().objects.length, 1);
});

for (const reason of ["pointercancel", "lostpointercapture", "blur"]) {
  test(`a genuine ${reason} cancels the unfinished stroke instead of committing it`, async () => {
    const ui = await renderer();
    ui.draw();
    ui.down({ clientX: 250, clientY: 20 });
    ui.move({ clientX: 300, clientY: 90 });
    if (reason === "blur") ui.windowEvent("blur");
    else {
      ui.canvas.releasePointerCapture(1);
      ui.canvas.emit(reason, { pointerId: 1, buttons: 1 });
    }
    assert.equal(ui.state().gesture, null);
    ui.windowEvent("mouseup", {
      pointerId: undefined,
      clientX: 320,
      clientY: 90,
    });
    assert.equal(
      ui.state().objects.length,
      1,
      "only the previously completed stroke remains",
    );
  });
}

test("capture loss queued for a previous stroke cannot discard a newly captured stroke", async () => {
  const ui = await renderer();
  ui.draw();
  ui.down({ clientX: 250, clientY: 20 });
  ui.move({ clientX: 300, clientY: 90 });
  assert.equal(ui.canvas.hasPointerCapture(1), true);
  ui.canvas.emit("lostpointercapture", { pointerId: 1, buttons: 0 });
  assert.equal(ui.state().gesture?.type, "pen");
  ui.up({ clientX: 320, clientY: 90 });
  assert.equal(ui.state().objects.length, 2);
});

test("macOS physical Control latch preserves deletion when pointer modifier flags briefly disappear", async () => {
  const ui = await renderer();
  ui.draw();
  ui.windowEvent("keydown", {
    key: "Control",
    code: "ControlLeft",
    ctrlKey: true,
  });
  ui.down({ clientX: 80, clientY: 40, ctrlKey: true });
  ui.move({ clientX: 120, clientY: 90, ctrlKey: false });
  assert.equal(ui.state().gesture?.type, "delete");
  ui.windowEvent("mouseup", {
    pointerId: undefined,
    clientX: 120,
    clientY: 90,
    ctrlKey: false,
  });
  assert.equal(ui.state().objects.length, 0);
});

test("an actual Control key release cancels deletion even if mouseup arrives later", async () => {
  const ui = await renderer();
  ui.draw();
  ui.windowEvent("keydown", {
    key: "Control",
    code: "ControlLeft",
    ctrlKey: true,
  });
  ui.down({ clientX: 80, clientY: 40, ctrlKey: true });
  ui.move({ clientX: 120, clientY: 90, ctrlKey: true });
  ui.windowEvent("keyup", {
    key: "Control",
    code: "ControlLeft",
    ctrlKey: false,
  });
  assert.equal(ui.state().gesture, null);
  ui.windowEvent("mouseup", {
    pointerId: undefined,
    clientX: 120,
    clientY: 90,
    ctrlKey: false,
  });
  assert.equal(ui.state().objects.length, 1);
});

test("Windows does not inherit the macOS pointer modifier workaround", async () => {
  const ui = await renderer("win32");
  ui.draw();
  ui.windowEvent("keydown", {
    key: "Control",
    code: "ControlLeft",
    ctrlKey: true,
  });
  ui.down({ clientX: 80, clientY: 40, ctrlKey: true });
  ui.move({ clientX: 120, clientY: 90, ctrlKey: false });
  ui.up({ clientX: 120, clientY: 90, ctrlKey: false });
  assert.equal(ui.state().objects.length, 1);
});

test("mouseup from another button cannot complete a still-held primary-button stroke", async () => {
  const ui = await renderer();
  ui.down({ clientX: 20, clientY: 20 });
  ui.move({ clientX: 80, clientY: 60 });
  ui.windowEvent("mouseup", {
    pointerId: undefined,
    button: 2,
    buttons: 1,
    clientX: 100,
    clientY: 80,
  });
  assert.equal(ui.state().gesture?.type, "pen");
  assert.equal(ui.state().objects.length, 0);
  ui.up({ clientX: 110, clientY: 90 });
  assert.equal(ui.state().objects.length, 1);
});

test("the mouseup fallback never completes a pen-device pointer gesture", async () => {
  const ui = await renderer();
  ui.down({ pointerType: "pen", pointerId: 9, clientX: 20, clientY: 20 });
  ui.move({ pointerType: "pen", pointerId: 9, clientX: 80, clientY: 60 });
  ui.windowEvent("mouseup", {
    pointerId: undefined,
    clientX: 100,
    clientY: 80,
  });
  assert.equal(ui.state().gesture?.pointerId, 9);
  assert.equal(ui.state().objects.length, 0);
  ui.up({ pointerType: "pen", pointerId: 9, clientX: 110, clientY: 90 });
  assert.equal(ui.state().objects.length, 1);
});

test("blur clears a latched Control key so the next plain drag remains a pen stroke", async () => {
  const ui = await renderer();
  ui.windowEvent("keydown", {
    key: "Control",
    code: "ControlLeft",
    ctrlKey: true,
  });
  ui.down({ clientX: 20, clientY: 20, ctrlKey: true });
  ui.windowEvent("blur");
  ui.down({ clientX: 20, clientY: 20, ctrlKey: false });
  assert.equal(ui.state().gesture?.type, "pen");
  ui.up({ clientX: 100, clientY: 100, ctrlKey: false });
  assert.equal(ui.state().objects.length, 1);
});

test("mouse pointerdown leaves compatibility mouseup enabled while pen input keeps default prevention", async () => {
  const mouse = await renderer();
  const mouseDown = mouse.canvas.emit("pointerdown", {
    pointerType: "mouse",
    clientX: 20,
    clientY: 20,
  });
  assert.equal(
    mouseDown.defaultPrevented,
    false,
    "canceling pointerdown would suppress the compatibility release",
  );
  const pen = await renderer();
  const penDown = pen.canvas.emit("pointerdown", {
    pointerType: "pen",
    pointerId: 9,
    clientX: 20,
    clientY: 20,
  });
  assert.equal(penDown.defaultPrevented, true);
});

test("release capture loss accepts compatibility mouseup and commits exactly once", async () => {
  const ui = await renderer("darwin", { deferFrames: true });
  ui.down({ clientX: 20, clientY: 20 });
  ui.move({ clientX: 80, clientY: 60 });
  ui.canvas.releasePointerCapture(1);
  ui.canvas.emit("lostpointercapture", { pointerId: 1, buttons: 0 });
  assert.equal(ui.state().gesture?.type, "pen");
  ui.windowEvent("mouseup", {
    pointerId: undefined,
    clientX: 110,
    clientY: 80,
  });
  assert.equal(ui.state().objects.length, 1);
  assert.equal(ui.state().gesture, null);
  ui.flushFrame();
  ui.windowEvent("pointerup", { clientX: 110, clientY: 80 });
  assert.equal(
    ui.state().objects.length,
    1,
    "the deferred cleanup and later pointerup must not duplicate the stroke",
  );
});

test("release capture loss waits across frames without auto-committing or discarding the stroke", async () => {
  const ui = await renderer("darwin", { deferFrames: true });
  ui.down({ clientX: 20, clientY: 20 });
  ui.move({ clientX: 80, clientY: 60 });
  ui.canvas.releasePointerCapture(1);
  ui.canvas.emit("lostpointercapture", { pointerId: 1, buttons: 0 });
  ui.flushFrame();
  ui.flushFrame();
  ui.flushFrame();
  assert.equal(ui.state().gesture?.type, "pen");
  assert.equal(
    ui.state().objects.length,
    0,
    "capture loss alone cannot commit the stroke",
  );
  ui.windowEvent("mouseup", {
    pointerId: undefined,
    clientX: 110,
    clientY: 80,
  });
  assert.equal(ui.state().gesture, null);
  assert.equal(ui.state().objects.length, 1);
  assert.deepEqual(ui.state().objects[0].points.at(-1), { x: 110, y: 80 });
});

test("deferred cleanup of an old gesture never cancels the next gesture with the same mouse pointer", async () => {
  const ui = await renderer("darwin", { deferFrames: true });
  ui.down({ clientX: 20, clientY: 20 });
  ui.move({ clientX: 80, clientY: 60 });
  ui.canvas.releasePointerCapture(1);
  ui.canvas.emit("lostpointercapture", { pointerId: 1, buttons: 0 });
  ui.windowEvent("keydown", { key: "Escape", code: "Escape" });
  assert.equal(ui.state().gesture, null);
  ui.down({ clientX: 200, clientY: 20 });
  ui.move({ clientX: 280, clientY: 60 });
  ui.flushFrame();
  assert.equal(ui.state().gesture?.type, "pen");
  assert.equal(ui.state().objects.length, 0);
  ui.up({ clientX: 300, clientY: 80 });
  assert.equal(ui.state().objects.length, 1);
  assert.deepEqual(ui.state().objects[0].points[0], { x: 200, y: 20 });
});

test("the next mouse down closes the released stroke before starting a separate stroke", async () => {
  const ui = await renderer("darwin", { deferFrames: true });
  ui.down({ clientX: 20, clientY: 20 });
  ui.move({ clientX: 80, clientY: 60 });
  ui.canvas.releasePointerCapture(1);
  ui.canvas.emit("lostpointercapture", { buttons: 0 });
  ui.down({ clientX: 300, clientY: 300 });
  assert.equal(ui.state().objects.length, 1);
  assert.deepEqual(
    ui.state().objects[0].points.at(-1),
    { x: 80, y: 60 },
    "the new down is not appended to the old stroke",
  );
  assert.deepEqual(ui.state().gesture.start, { x: 300, y: 300 });
  ui.move({ clientX: 350, clientY: 350 });
  ui.up({ clientX: 400, clientY: 400 });
  assert.equal(ui.state().objects.length, 2);
  assert.deepEqual(ui.state().objects[1].points[0], { x: 300, y: 300 });
  assert.deepEqual(ui.state().objects[1].points.at(-1), { x: 400, y: 400 });
});

test("hover movement while waiting for release never extends the released stroke", async () => {
  const ui = await renderer("darwin", { deferFrames: true });
  ui.down({ clientX: 20, clientY: 20 });
  ui.move({ clientX: 80, clientY: 60 });
  ui.canvas.releasePointerCapture(1);
  ui.canvas.emit("lostpointercapture", { buttons: 0 });
  const points = ui.state().gesture.points;
  ui.move({ clientX: 500, clientY: 500, buttons: 0 });
  ui.windowEvent("pointermove", { clientX: 600, clientY: 600, buttons: 0 });
  assert.deepEqual(ui.state().gesture.points, points);
  ui.down({ clientX: 300, clientY: 300 });
  assert.deepEqual(ui.state().objects[0].points.at(-1), { x: 80, y: 60 });
});

test("Control keyup after an observed mouse release completes the deletion with its release modifiers", async () => {
  const ui = await renderer("darwin", { deferFrames: true });
  ui.draw();
  ui.windowEvent("keydown", {
    key: "Control",
    code: "ControlLeft",
    ctrlKey: true,
  });
  ui.down({ clientX: 70, clientY: 30, ctrlKey: true });
  ui.move({ clientX: 140, clientY: 100, ctrlKey: true });
  ui.canvas.releasePointerCapture(1);
  ui.canvas.emit("lostpointercapture", { buttons: 0, ctrlKey: true });
  ui.flushFrame();
  ui.windowEvent("keyup", {
    key: "Control",
    code: "ControlLeft",
    ctrlKey: false,
  });
  assert.equal(ui.state().gesture, null);
  assert.equal(
    ui.state().objects.length,
    0,
    "the physical mouse button was released before Control",
  );
  ui.windowEvent("mouseup", {
    pointerId: undefined,
    clientX: 140,
    clientY: 100,
    ctrlKey: false,
  });
  assert.equal(ui.state().objects.length, 0);
  ui.down({ clientX: 200, clientY: 200, ctrlKey: false });
  assert.equal(
    ui.state().gesture?.type,
    "pen",
    "the Control latch must still clear",
  );
});

for (const reason of ["blur", "Escape", "pointercancel", "prepare-hide"]) {
  test(`an explicit ${reason} still discards a stroke waiting for release`, async () => {
    const ui = await renderer("darwin", { deferFrames: true });
    ui.down({ clientX: 20, clientY: 20 });
    ui.move({ clientX: 80, clientY: 60 });
    ui.canvas.releasePointerCapture(1);
    ui.canvas.emit("lostpointercapture", { buttons: 0 });
    if (reason === "blur") ui.windowEvent("blur");
    else if (reason === "Escape")
      ui.windowEvent("keydown", { key: "Escape", code: "Escape" });
    else if (reason === "pointercancel")
      ui.canvas.emit("pointercancel", { pointerId: 1 });
    else ui.command(reason);
    assert.equal(ui.state().gesture, null);
    ui.flushFrame();
    ui.windowEvent("mouseup", {
      pointerId: undefined,
      clientX: 110,
      clientY: 80,
    });
    assert.equal(
      ui.state().objects.length,
      0,
      "late release cannot resurrect an explicitly canceled gesture",
    );
  });
}

test("another pointer cannot close the mouse stroke waiting for release", async () => {
  const ui = await renderer("darwin", { deferFrames: true });
  ui.down({ clientX: 20, clientY: 20 });
  ui.move({ clientX: 80, clientY: 60 });
  ui.canvas.releasePointerCapture(1);
  ui.canvas.emit("lostpointercapture", { buttons: 0 });
  ui.down({ pointerId: 9, pointerType: "pen", clientX: 300, clientY: 300 });
  assert.equal(ui.state().objects.length, 0);
  assert.equal(ui.state().gesture?.pointerId, 1);
  ui.windowEvent("mouseup", {
    pointerId: undefined,
    clientX: 100,
    clientY: 80,
  });
  assert.equal(ui.state().objects.length, 1);
});
