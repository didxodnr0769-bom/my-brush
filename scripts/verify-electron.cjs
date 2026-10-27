"use strict";
// Real Electron renderer input; OS-global physical keyboard/IME are separate checks.
const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/electron");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "my-brush-qa-"));
const checks = [];
let app, page;
const errors = [];
async function check(name, action) {
  await action();
  checks.push(name);
  console.log("PASS", name);
}
const state = () => page.evaluate(() => window.myBrushDebug.getState());
async function drag(x, y, x2, y2, modifiers = []) {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  for (const key of modifiers.reverse()) await page.keyboard.up(key);
}
async function capture(name) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const bytes = await app.evaluate(async ({ BrowserWindow }) => {
    const w =
      BrowserWindow.getAllWindows().find((w) => w.isFocused()) ||
      BrowserWindow.getAllWindows().find((w) => w.isVisible());
    const [width, height] = w.getContentSize();
    return (await w.capturePage()).resize({ width, height }).toPNG();
  });
  fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(bytes));
}
async function reopen() {
  // Explicit application menu action, not synthetic state mutation.
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items[0].submenu.items[0].click(),
  );
  await page.waitForFunction(() => window.myBrushDebug.getState().visible);
}
async function run() {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(profile, "preferences.json"),
    JSON.stringify(
      require("../electron/preferences.cjs").defaults(process.platform),
    ),
  );
  app = await _electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, MY_BRUSH_USER_DATA: profile },
    timeout: 20000,
  });
  app.process().stderr.on("data", (d) => {
    const s = String(d);
    if (/Error|failed/i.test(s)) errors.push(s.trim());
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForFunction(() => window.myBrushDebug);
  for (const candidate of app.windows()) {
    await candidate.waitForFunction(() => window.myBrushDebug);
    if (await candidate.locator("#toolbar").isVisible()) {
      page = candidate;
      break;
    }
  }
  if ((await state()).gesture) await page.keyboard.press("Escape");
  await check(
    "startup: empty scene, isolated renderer, real display bounds and transparent overlay",
    async () => {
      const current = await state();
      assert.equal(current.objects.length, 0);
      assert.equal(current.visible, true);
      const info = await app.evaluate(
        ({ BrowserWindow, screen, globalShortcut }) => {
          const w =
            BrowserWindow.getAllWindows().find((w) => w.isFocused()) ||
            BrowserWindow.getAllWindows()[0];
          return {
            bounds: w.getBounds(),
            display: screen.getDisplayMatching(w.getBounds()).bounds,
            top: w.isAlwaysOnTop(),
            visible: w.isVisible(),
            prefs: w.webContents.getLastWebPreferences(),
            registered: globalShortcut.isRegistered("Control+Command+Tab"),
          };
        },
      );
      assert.deepEqual(info.bounds, info.display);
      assert.equal(info.top, true);
      assert.equal(info.visible, true);
      assert.equal(info.prefs.nodeIntegration, false);
      assert.equal(info.prefs.contextIsolation, true);
      assert.equal(info.prefs.sandbox, true);
      assert.equal(info.registered, true);
      const layout = await page.evaluate(() => ({
        w: innerWidth,
        h: innerHeight,
        sw: document.documentElement.scrollWidth,
        sh: document.documentElement.scrollHeight,
        bar: document
          .getElementById("toolbar")
          .getBoundingClientRect()
          .toJSON(),
        background: getComputedStyle(document.getElementById("app"))
          .backgroundColor,
        node: typeof require,
      }));
      assert.equal(layout.node, "undefined");
      assert.equal(layout.sw, layout.w);
      assert.equal(layout.sh, layout.h);
      assert.ok(
        layout.bar.x >= 0 &&
          layout.bar.right <= layout.w &&
          layout.bar.y >= 0 &&
          layout.bar.bottom <= layout.h,
      );
      assert.equal(layout.background, "rgba(0, 0, 0, 0.004)");
      fs.writeFileSync(
        path.join(output, "startup.json"),
        JSON.stringify({ info, layout }, null, 2),
      );
      await capture("startup");
    },
  );
  await check(
    "pen drawing, color and width apply to subsequent objects",
    async () => {
      await drag(170, 210, 290, 245);
      assert.equal((await state()).objects.length, 1);
      await page
        .getByRole("button", { name: "빨강 #E26159", exact: true })
        .click();
      await page.locator("#widthInput").focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.locator("#drawing").focus();
      await drag(180, 285, 330, 285);
      const objects = (await state()).objects;
      assert.equal(objects[0].color, "#334A42");
      assert.equal(objects[0].width, 4);
      assert.equal(objects[1].color, "#E26159");
      assert.equal(objects[1].width, 3);
    },
  );
  await check("rectangle tool and hollow interior exclusion", async () => {
    await page.getByRole("button", { name: "사각형", exact: true }).click();
    await drag(420, 210, 650, 360);
    assert.equal((await state()).objects.at(-1).type, "rect");
    const count = (await state()).objects.length;
    await drag(460, 250, 590, 310, ["Control"]);
    assert.equal((await state()).objects.length, count);
  });
  await check(
    "multiline Korean text, Control+Enter, resize existing text and cancel edit",
    async () => {
      await page.getByRole("button", { name: "텍스트", exact: true }).click();
      await page.mouse.click(700, 230);
      await page.locator("#textInput").fill("함께 볼까요?\nElectron 화면 필기");
      await page.keyboard.press("Control+Enter");
      assert.equal(
        (await state()).objects.at(-1).text,
        "함께 볼까요?\nElectron 화면 필기",
      );
      await page.mouse.click(710, 238);
      await page.locator("#fontSizeInput").fill("42");
      await page.locator("#textInput").focus();
      await page.keyboard.press("Control+Enter");
      assert.equal((await state()).objects.at(-1).fontSize, 42);
      await page.mouse.click(710, 238);
      await page.locator("#textInput").fill("취소할 변경");
      await page.keyboard.press("Escape");
      assert.equal(
        (await state()).objects.at(-1).text,
        "함께 볼까요?\nElectron 화면 필기",
      );
      await page.waitForFunction(() => !window.myBrushDebug.getState().draft);
      await capture("drawing-and-text");
    },
  );
  await check(
    "partial border selection deletes the whole rectangle",
    async () => {
      await drag(410, 230, 430, 250, ["Control"]);
      assert.equal(
        (await state()).objects.filter((o) => o.type === "rect").length,
        0,
      );
    },
  );
  await check(
    "Control release and Escape cancel deletion gestures",
    async () => {
      const count = (await state()).objects.length;
      await page.keyboard.down("Control");
      await page.mouse.move(150, 200);
      await page.mouse.down();
      await page.mouse.move(340, 300);
      await page.keyboard.up("Control");
      await page.mouse.up();
      assert.equal((await state()).objects.length, count);
      await page.keyboard.down("Control");
      await page.mouse.move(150, 200);
      await page.mouse.down();
      await page.mouse.move(340, 300);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.keyboard.up("Control");
      assert.equal((await state()).objects.length, count);
    },
  );
  await check(
    "text input preserves tool letters, external click consumes the commit",
    async () => {
      await page.mouse.click(700, 430);
      await page.locator("#textInput").fill("brt[]");
      await page.keyboard.press("b");
      assert.equal((await state()).tool, "text");
      const count = (await state()).objects.length;
      await page.mouse.click(650, 480);
      assert.equal((await state()).objects.length, count + 1);
      assert.equal((await state()).draft, null);
    },
  );
  await check(
    "shortcut duplicate validation, record cancellation and saved tool dispatch",
    async () => {
      await page
        .getByRole("button", { name: "단축키 설정", exact: true })
        .click();
      await capture("shortcuts");
      await page.locator('[data-action="pen"]').click();
      await page.keyboard.press("r");
      assert.equal(await page.locator("#saveSettings").isDisabled(), true);
      await page.locator('[data-action="pen"]').click();
      await page.keyboard.press("Escape");
      assert.equal((await state()).settingsOpen, true);
      assert.equal((await state()).recording, null);
      await page.locator('[data-action="pen"]').click();
      await page.keyboard.press("p");
      await page.locator("#saveSettings").click();
      await page.waitForFunction(
        () => !window.myBrushDebug.getState().settingsOpen,
      );
      await page.locator("#drawing").focus();
      await page.keyboard.press("p");
      assert.equal((await state()).tool, "pen");
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(profile, "preferences.json"), "utf8"),
        ).shortcuts.pen.code,
        "KeyP",
      );
    },
  );
  if (app.windows().length > 1)
    await check(
      "a modal on one display blocks drawing and global toggle from other displays",
      async () => {
        const other = app.windows().find((w) => w !== page);
        await other.waitForFunction(() => window.myBrushDebug);
        await page.locator("#settingsButton").click();
        await page.waitForFunction(
          () => window.myBrushDebug.getState().settingsOpen,
        );
        const before = await other.evaluate(
          () => window.myBrushDebug.getState().objects.length,
        );
        await other.mouse.click(300, 400);
        assert.equal(
          await other.evaluate(
            () => window.myBrushDebug.getState().objects.length,
          ),
          before,
        );
        await app.evaluate(({ Menu }) =>
          Menu.getApplicationMenu().items[0].submenu.items[0].click(),
        );
        assert.equal((await state()).settingsOpen, true);
        assert.equal((await state()).visible, true);
        await page.locator("#cancelSettings").click();
      },
    );
  await check(
    "composition guard blocks tools and toggle (synthetic events, not an IME claim)",
    async () => {
      await page.getByRole("button", { name: "텍스트", exact: true }).click();
      await page.mouse.click(900, 550);
      await page.locator("#textInput").dispatchEvent("compositionstart");
      await page.keyboard.press("b");
      assert.equal((await state()).tool, "text");
      await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu().items[0].submenu.items[0].click(),
      );
      assert.equal((await state()).visible, true);
      await page.locator("#textInput").dispatchEvent("compositionend");
      await page.locator("#textInput").fill("");
      await page.keyboard.press("Control+Enter");
      // End any draft once the IME keyup protection interval has elapsed.
      if ((await state()).draft) {
        await page.locator("#widthInput").focus();
        await page.locator("#textInput").focus();
        await page.keyboard.press("Escape");
      }
    },
  );
  await check(
    "OS shortcut collision keeps existing binding and successful replacement persists",
    async () => {
      assert.equal(
        await app.evaluate(({ globalShortcut }) =>
          globalShortcut.register("Control+Alt+F10", () => {}),
        ),
        true,
      );
      await page.locator("#settingsButton").click();
      await page.locator('[data-action="toggle"]').click();
      await page.keyboard.press("Control+Alt+F10");
      await page.locator("#saveSettings").click();
      await page.waitForFunction(() =>
        document.getElementById("shortcutMessage").classList.contains("error"),
      );
      assert.equal((await state()).preferences.shortcuts.toggle.code, "Tab");
      assert.equal(
        await app.evaluate(({ globalShortcut }) =>
          globalShortcut.isRegistered("Control+Command+Tab"),
        ),
        true,
      );
      await capture("shortcut-conflict");
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.unregister("Control+Alt+F10"),
      );
      await page.locator('[data-action="toggle"]').click();
      await page.keyboard.press("Control+Alt+F9");
      await page.locator("#saveSettings").click();
      await page.waitForFunction(
        () => !window.myBrushDebug.getState().settingsOpen,
      );
      assert.equal(
        await app.evaluate(({ globalShortcut }) =>
          globalShortcut.isRegistered("Control+Alt+F9"),
        ),
        true,
      );
      assert.equal(
        await app.evaluate(({ globalShortcut }) =>
          globalShortcut.isRegistered("Control+Command+Tab"),
        ),
        false,
      );
    },
  );
  await check(
    "hide/show retains completed objects and OFF survives app activation",
    async () => {
      const count = (await state()).objects.length;
      await page.locator("#returnButton").click();
      await page.waitForFunction(() => !window.myBrushDebug.getState().visible);
      await app.evaluate(({ app }) => {
        app.emit("activate", {}, false);
        app.focus();
      });
      assert.equal(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((w) => w.isVisible()),
        ),
        false,
      );
      await reopen();
      assert.equal((await state()).objects.length, count);
    },
  );
  await check(
    "hide mid-drag cancels unfinished pen before pointer release",
    async () => {
      const count = (await state()).objects.length;
      await page.mouse.move(180, 530);
      await page.mouse.down();
      await page.mouse.move(340, 550);
      await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu().items[0].submenu.items[0].click(),
      );
      await page.waitForFunction(() => !window.myBrushDebug.getState().visible);
      await page.mouse.up();
      await reopen();
      assert.equal((await state()).objects.length, count);
      assert.equal((await state()).gesture, null);
    },
  );
  await check("mixed-object selection removes each whole object", async () => {
    await drag(120, 160, 1100, 600, ["Control"]);
    assert.equal((await state()).objects.length, 0);
  });
  await check(
    "restart restores preferences and starts with an empty session",
    async () => {
      await app.close();
      app = await _electron.launch({
        args: [root, "--start-hidden"],
        cwd: root,
        env: { ...process.env, MY_BRUSH_USER_DATA: profile },
        timeout: 20000,
      });
      page = await app.firstWindow();
      await page.waitForFunction(() => window.myBrushDebug);
      assert.equal(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((w) => w.isVisible()),
        ),
        false,
      );
      assert.equal((await state()).preferences.shortcuts.pen.code, "KeyP");
      assert.equal((await state()).preferences.shortcuts.toggle.code, "F9");
      assert.equal((await state()).objects.length, 0);
      await reopen();
      for (const candidate of app.windows()) {
        await candidate.waitForFunction(() => window.myBrushDebug);
        if (await candidate.locator("#toolbar").isVisible()) {
          page = candidate;
          break;
        }
      }
      await page.locator("#settingsButton").click();
      await page.waitForFunction(
        () => window.myBrushDebug.getState().settingsOpen,
      );
      await capture("shortcuts");
      await page.locator("#cancelSettings").click();
    },
  );
  assert.deepEqual(errors, []);
  const result = {
    date: "2026-10-27",
    platform: process.platform,
    arch: process.arch,
    electron: require("electron/package.json").version,
    passed: checks.length,
    checks,
    errors,
    physicalGlobalKeyboard: "not verified",
    realIME: "not verified",
    windows: "not verified",
  };
  fs.writeFileSync(
    path.join(output, "verification.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  });
