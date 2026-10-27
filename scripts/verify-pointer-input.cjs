"use strict";
// macOS Electron input regression: native Chromium events plus controlled delivery
// faults. This does not claim reproduction of a physical mouse/driver failure.
const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/electron");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "my-brush-pointer-"));
const executable = process.env.MY_BRUSH_EXECUTABLE;
let app, page, win;
const checks = [];
const errors = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log("PASS", name);
}
async function observe() {
  await page.evaluate(() => {
    window.inputStats = { lost: 0, up: 0 };
    window.addEventListener(
      "lostpointercapture",
      () => window.inputStats.lost++,
      true,
    );
    window.addEventListener("mouseup", () => window.inputStats.up++, true);
  });
}
async function resetStats() {
  await page.evaluate(() => (window.inputStats = { lost: 0, up: 0 }));
}
async function processed(count) {
  await page.waitForFunction((n) => window.inputStats.lost >= n, count);
  await page.waitForFunction(() => !window.myBrushDebug.getState().gesture);
}
async function penBatch(count) {
  await win.evaluate((w, n) => {
    w.focus();
    const wc = w.webContents;
    for (let i = 0; i < n; i++) {
      const y = 230 + (i % 10) * 30;
      wc.sendInputEvent({ type: "mouseMove", x: 300, y });
      wc.sendInputEvent({
        type: "mouseDown",
        button: "left",
        x: 300,
        y,
        clickCount: 1,
      });
      wc.sendInputEvent({
        type: "mouseMove",
        button: "left",
        modifiers: ["leftButtonDown"],
        x: 420,
        y: y + 10,
      });
      wc.sendInputEvent({
        type: "mouseUp",
        button: "left",
        x: 420,
        y: y + 10,
        clickCount: 1,
      });
    }
  }, count);
}
async function removeBatch(dropModifiers = false) {
  await win.evaluate((w, drop) => {
    const wc = w.webContents;
    wc.sendInputEvent({
      type: "keyDown",
      keyCode: "Control",
      modifiers: ["control"],
    });
    wc.sendInputEvent({
      type: "mouseDown",
      button: "left",
      x: 280,
      y: 200,
      clickCount: 1,
      modifiers: ["control"],
    });
    wc.sendInputEvent({
      type: "mouseMove",
      button: "left",
      x: 450,
      y: 550,
      modifiers: drop ? ["leftButtonDown"] : ["control", "leftButtonDown"],
    });
    wc.sendInputEvent({
      type: "mouseUp",
      button: "left",
      x: 450,
      y: 550,
      clickCount: 1,
      modifiers: drop ? [] : ["control"],
    });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Control" });
  }, dropModifiers);
}
async function objects() {
  return page.evaluate(() => window.myBrushDebug.getState().objects.length);
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
    args: executable ? [] : [root],
    ...(executable ? { executablePath: executable } : {}),
    cwd: root,
    env: { ...process.env, MY_BRUSH_USER_DATA: profile },
    timeout: 20000,
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => window.myBrushDebug);
  for (const candidate of app.windows()) {
    await candidate.waitForFunction(() => window.myBrushDebug);
    if (await candidate.locator("#toolbar").isVisible()) {
      page = candidate;
      break;
    }
  }
  page.on("pageerror", (e) => errors.push(e.message));
  // Keep the test overlays away from the user's physical pointer. Native event
  // injection still targets their webContents; no test input lands in other apps.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const b = w.getBounds();
      w.setBounds({ ...b, x: b.x + 12000, y: b.y + 12000 });
    }
  });
  await page.reload();
  await page.waitForFunction(() => window.myBrushDebug);
  win = await app.browserWindow(page);
  await observe();
  await check(
    "100 rapid native mouse strokes survive release and Ctrl-drag deletes them",
    async () => {
      await penBatch(100);
      await processed(100);
      assert.equal(await objects(), 100);
      assert.equal(await page.evaluate(() => window.inputStats.up), 100);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const bytes = await win.evaluate(async (w) => {
        const [width, height] = w.getContentSize();
        return (await w.capturePage()).resize({ width, height }).toPNG();
      });
      fs.writeFileSync(
        path.join(output, "pointer-after-release.png"),
        Buffer.from(bytes),
      );
      await removeBatch();
      await processed(101);
      assert.equal(await objects(), 0);
    },
  );
  if (process.platform === "darwin")
    await check(
      "Control key remains held while macOS pointer modifier flags disappear",
      async () => {
        await resetStats();
        await penBatch(1);
        await processed(1);
        assert.equal(await objects(), 1);
        await removeBatch(true);
        await processed(2);
        assert.equal(await objects(), 0);
      },
    );
  await check(
    "100 strokes and Ctrl deletion recover when pointerup handler delivery is suppressed",
    async () => {
      // Deliberate delivery fault; normal mouseup remains a trusted Chromium event.
      await page.addInitScript(() =>
        window.addEventListener(
          "pointerup",
          (e) => e.stopImmediatePropagation(),
          true,
        ),
      );
      await page.reload();
      await page.waitForFunction(() => window.myBrushDebug);
      await observe();
      await penBatch(100);
      await processed(100);
      assert.equal(await objects(), 100);
      assert.equal(await page.evaluate(() => window.inputStats.up), 100);
      await removeBatch();
      await processed(101);
      assert.equal(await objects(), 0);
    },
  );
  await check(
    "delayed release across frames and 100 rapid next presses keep strokes separate",
    async () => {
      await page.addInitScript(() => {
        window.delayedRelease = { hold: true, last: null };
        window.addEventListener(
          "mouseup",
          (event) => {
            if (!window.delayedRelease.hold) return;
            window.delayedRelease.last = event;
            event.stopImmediatePropagation();
          },
          true,
        );
      });
      await page.reload();
      await page.waitForFunction(() => window.myBrushDebug);
      await observe();
      await penBatch(100);
      await page.waitForFunction(() => window.inputStats.lost >= 100);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(await objects(), 99);
      assert.equal(
        await page.evaluate(
          () => window.myBrushDebug.getState().gesture?.awaitingRelease,
        ),
        true,
      );
      await page.evaluate(() => {
        window.delayedRelease.hold = false;
        window.dispatchEvent(window.delayedRelease.last);
      });
      await page.waitForFunction(() => !window.myBrushDebug.getState().gesture);
      assert.equal(await objects(), 100);
      const points = await page.evaluate(() =>
        window.myBrushDebug.getState().objects.map((o) => o.points),
      );
      for (const stroke of points) {
        assert.equal(stroke[0].x, 300);
        assert.equal(stroke.at(-1).x, 420);
        assert.ok(
          stroke.every((p) => p.y >= stroke[0].y && p.y <= stroke[0].y + 10),
        );
      }
      await removeBatch();
      await processed(101);
      assert.equal(await objects(), 0);
    },
  );
  assert.deepEqual(errors, []);
  const result = {
    date: "2026-10-27",
    platform: process.platform,
    arch: process.arch,
    packaged: !!executable,
    passed: checks.length,
    checks,
    errors,
    physicalMouseRootCause:
      "not reproduced; native input and controlled delivery faults verified",
  };
  fs.writeFileSync(
    path.join(
      output,
      executable
        ? "pointer-bundle-verification.json"
        : "pointer-verification.json",
    ),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  });
