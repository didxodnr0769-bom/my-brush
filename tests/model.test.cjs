const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeRect,
  validDeleteDrag,
  hitTestObject,
  removeIntersecting,
  findText,
} = require("../electron/model.cjs");

const point = (x, y) => ({ x, y });
const rect = (x, y, width, height) => ({ x, y, width, height });
const stroke = (id, points, width = 4) => ({
  type: "stroke",
  id,
  points: points.map(([x, y]) => point(x, y)),
  width,
  color: "#ff5c5c",
});
const rectangle = (id, x, y, width, height, lineWidth = 8) => ({
  type: "rect",
  id,
  x,
  y,
  width,
  height,
  lineWidth,
  color: "#ff5c5c",
});
const text = (id, x, y, value, fontSize = 28) => ({
  type: "text",
  id,
  x,
  y,
  text: value,
  fontSize,
  color: "#ff5c5c",
});
const textLayout = (object) => rect(object.x, object.y, 100, 40);

test("all four drag directions select the same logical rectangle", () => {
  for (const [a, b] of [
    [point(1, 2), point(9, 12)],
    [point(9, 12), point(1, 2)],
    [point(1, 12), point(9, 2)],
    [point(9, 2), point(1, 12)],
  ])
    assert.deepEqual(normalizeRect(a, b), rect(1, 2, 8, 10));
});

test("clicks, zero-area and two-DIP drags do not delete", () => {
  for (const b of [
    point(0, 0),
    point(0, 100),
    point(100, 0),
    point(1, 1),
    point(1.2, 1.6),
  ]) {
    assert.equal(validDeleteDrag(point(0, 0), b), false);
  }
});

test("long thin delete areas remain usable in either direction", () => {
  assert.equal(validDeleteDrag(point(0, 0), point(0.1, 50)), true);
  assert.equal(validDeleteDrag(point(0.1, 50), point(0, 0)), true);
});

test("crossing is detected when both stroke endpoints are outside selection", () => {
  assert.equal(
    hitTestObject(
      stroke(
        "s",
        [
          [0, 0],
          [100, 100],
        ],
        1,
      ),
      rect(49, 49, 2, 2),
    ),
    true,
  );
});

test("empty regions inside a stroke bounding box are not deletion targets", () => {
  assert.equal(
    hitTestObject(
      stroke("s", [
        [0, 0],
        [0, 100],
        [100, 100],
      ]),
      rect(40, 40, 10, 10),
    ),
    false,
  );
});

test("round caps reject square-expansion corners but include exact cap contact", () => {
  const object = stroke("s", [
    [0, 0],
    [10, 0],
  ]);
  assert.equal(hitTestObject(object, rect(11.5, 1.5, 0.2, 0.2)), false);
  assert.equal(hitTestObject(object, rect(12, -0.1, 1, 0.2)), true);
});

test("thick stroke side contact is inclusive and just-outside contact is excluded", () => {
  const object = stroke(
    "s",
    [
      [0, 0],
      [20, 0],
    ],
    8,
  );
  assert.equal(hitTestObject(object, rect(8, 4, 2, 1)), true);
  assert.equal(hitTestObject(object, rect(8, 4.001, 2, 1)), false);
});

test("single and repeated stroke points render as round dots", () => {
  for (const points of [
    [[0, 0]],
    [
      [0, 0],
      [0, 0],
    ],
  ]) {
    assert.equal(
      hitTestObject(stroke("s", points, 2), rect(0.6, 0.8, 1, 1)),
      true,
    );
    assert.equal(
      hitTestObject(stroke("s", points, 2), rect(0.8, 0.8, 1, 1)),
      false,
    );
  }
});

test("round stroke joins preserve empty outside corners", () => {
  const object = stroke("s", [
    [0, 10],
    [0, 0],
    [10, 0],
  ]);
  assert.equal(hitTestObject(object, rect(-1.6, -1.6, 0.1, 0.1)), false);
  assert.equal(hitTestObject(object, rect(-1.2, -1.6, 0.1, 0.1)), true);
});

test("empty strokes never become deletion targets", () => {
  assert.equal(
    hitTestObject(stroke("s", [], 20), rect(-100, -100, 200, 200)),
    false,
  );
});

test("a hollow rectangle interior is not a deletion target", () => {
  assert.equal(
    hitTestObject(rectangle("r", 10, 10, 100, 60), rect(30, 25, 50, 20)),
    false,
  );
});

test("partial rectangle border contact is a deletion target", () => {
  const object = rectangle("r", 10, 10, 100, 60);
  assert.equal(hitTestObject(object, rect(7, 30, 1, 5)), true);
  assert.equal(hitTestObject(object, rect(106, 30, 1, 5)), true);
});

test("inside and outside rectangle border contact are both inclusive", () => {
  const object = rectangle("r", 10, 10, 100, 60);
  assert.equal(hitTestObject(object, rect(30, 6, 5, 1)), true);
  assert.equal(hitTestObject(object, rect(30, 14, 5, 1)), true);
  assert.equal(hitTestObject(object, rect(30, 14.01, 5, 1)), false);
});

test("round rectangle corners reject square-expansion false positives", () => {
  const object = rectangle("r", 10, 10, 100, 60);
  assert.equal(hitTestObject(object, rect(6, 6, 0.5, 0.5)), false);
  assert.equal(hitTestObject(object, rect(7.5, 7.5, 0.5, 0.5)), true);
});

test("negative selection and rectangle dimensions normalize before hit testing", () => {
  assert.equal(
    hitTestObject(rectangle("r", 10, 10, 100, 60), rect(8, 35, -1, -5)),
    true,
  );
  assert.equal(
    hitTestObject(rectangle("r", 110, 70, -100, -60), rect(7, 30, 1, 5)),
    true,
  );
});

test("text uses supplied actual layout including whitespace and inclusive boundary", () => {
  const object = text("t", 10, 20, "가 나\nABC");
  assert.equal(hitTestObject(object, rect(60, 30, 1, 1), textLayout), true);
  assert.equal(hitTestObject(object, rect(110, 60, 5, 5), textLayout), true);
  assert.equal(
    hitTestObject(object, rect(110.1, 60.1, 5, 5), textLayout),
    false,
  );
  assert.equal(
    hitTestObject(text("empty", 10, 20, ""), rect(10, 20, 1, 1), textLayout),
    false,
  );
});

test("headless text fallback respects multiple lines", () => {
  assert.equal(
    hitTestObject(text("one", 0, 0, "가", 20), rect(0, 30, 1, 1)),
    false,
  );
  assert.equal(
    hitTestObject(text("two", 0, 0, "가\n나", 20), rect(0, 30, 1, 1)),
    true,
  );
});

test("one region removes whole mixed objects without mutating their geometry", () => {
  const line = stroke("s", [
    [0, 0],
    [100, 0],
  ]);
  const border = rectangle("r", 40, -20, 40, 40, 2);
  const label = text("t", 45, -5, "텍스트");
  const safe = stroke("safe", [[300, 300]]);
  const objects = [line, border, label, safe],
    shared = objects;
  assert.deepEqual(
    removeIntersecting(objects, rect(39, -1, 10, 2), textLayout),
    ["s", "r", "t"],
  );
  assert.deepEqual(objects, [safe]);
  assert.equal(objects, shared);
  assert.deepEqual(line.points, [point(0, 0), point(100, 0)]);
});

test("deletion retains non-target order and does not touch separate scenes", () => {
  const before = stroke("before", [[500, 500]], 2);
  const target = stroke("target", [[0, 0]], 2);
  const after = rectangle("after", 400, 400, 10, 10, 2);
  const objects = [before, target, after],
    other = [];
  assert.deepEqual(removeIntersecting(objects, rect(-1, -1, 2, 2)), ["target"]);
  assert.deepEqual(objects, [before, after]);
  assert.deepEqual(other, []);
});

test("text hit lookup returns the topmost text and ignores covering strokes", () => {
  const lower = text("lower", 0, 0, "아래", 20);
  const upper = text("upper", 50, 20, "위", 40);
  const objects = [lower, upper, stroke("s", [[60, 30]], 100)];
  assert.equal(findText(objects, point(60, 30), textLayout), upper);
  assert.equal(findText(objects, point(10, 10), textLayout), lower);
  assert.equal(findText(objects, point(150, 60), textLayout), upper);
  assert.equal(findText(objects, point(1000, 1000), textLayout), null);
});

test("the same module loads as a frozen browser global without Node access", () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../electron/model.cjs"), "utf8"),
    context,
  );
  const geometry = context.MyBrushGeometry;
  assert.equal(typeof geometry.hitTestObject, "function");
  assert.equal(Object.isFrozen(geometry), true);
  assert.equal(geometry.validDeleteDrag(point(0, 0), point(1, 50)), true);
});
