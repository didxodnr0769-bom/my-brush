/* Drawing geometry in logical display units. Keep independent of Electron/DOM. */
(function exposeGeometry(root, factory) {
  const geometry = Object.freeze(factory());
  if (typeof module === "object" && module.exports) module.exports = geometry;
  else root.MyBrushGeometry = geometry;
})(globalThis, function createGeometry() {
  "use strict";

  const normalizeRect = (a, b) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  });
  const normalizedBounds = (rect) =>
    normalizeRect(
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    );
  const validDeleteDrag = (a, b) =>
    a.x !== b.x && a.y !== b.y && Math.hypot(b.x - a.x, b.y - a.y) > 2;

  function rectsOverlap(first, second) {
    const a = normalizedBounds(first),
      b = normalizedBounds(second);
    return (
      a.x <= b.x + b.width &&
      b.x <= a.x + a.width &&
      a.y <= b.y + b.height &&
      b.y <= a.y + a.height
    );
  }

  function pointSegmentDistanceSquared(point, a, b) {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
      ),
    );
    return (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
  }

  function pointRectDistanceSquared(point, inputRect) {
    const rect = normalizedBounds(inputRect);
    const dx = Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width);
    const dy = Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height);
    return dx * dx + dy * dy;
  }

  function segmentIntersectsRect(a, b, inputRect) {
    const rect = normalizedBounds(inputRect);
    let low = 0,
      high = 1;
    for (const [start, end, minimum, maximum] of [
      [a.x, b.x, rect.x, rect.x + rect.width],
      [a.y, b.y, rect.y, rect.y + rect.height],
    ]) {
      const delta = end - start;
      if (!delta) {
        if (start < minimum || start > maximum) return false;
        continue;
      }
      let near = (minimum - start) / delta,
        far = (maximum - start) / delta;
      if (near > far) [near, far] = [far, near];
      low = Math.max(low, near);
      high = Math.min(high, far);
      if (low > high) return false;
    }
    return true;
  }

  function capsuleIntersectsRect(a, b, radius, inputRect) {
    const rect = normalizedBounds(inputRect);
    if (segmentIntersectsRect(a, b, rect)) return true;
    const corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ];
    // Endpoint-to-box and corner-to-segment distances cover the exact capsule,
    // including round caps/joins. Expanding the box would add square corners.
    const distanceSquared = Math.min(
      pointRectDistanceSquared(a, rect),
      pointRectDistanceSquared(b, rect),
      ...corners.map((point) => pointSegmentDistanceSquared(point, a, b)),
    );
    return distanceSquared <= Math.max(0, radius) ** 2;
  }

  function fallbackTextLayout(object) {
    const lines = object.text.split("\n"),
      size = Math.max(1, object.fontSize);
    return {
      x: object.x,
      y: object.y,
      width: Math.max(0, ...lines.map((line) => [...line].length)) * size * 0.6,
      height: lines.length * size * 1.2,
    };
  }

  function hitTestObject(object, inputRect, textLayout = fallbackTextLayout) {
    const rect = normalizedBounds(inputRect);
    if (object.type === "stroke") {
      if (!object.points.length) return false;
      const radius = Math.max(0, object.width / 2);
      if (object.points.length === 1) {
        return capsuleIntersectsRect(
          object.points[0],
          object.points[0],
          radius,
          rect,
        );
      }
      return object.points
        .slice(1)
        .some((point, index) =>
          capsuleIntersectsRect(object.points[index], point, radius, rect),
        );
    }
    if (object.type === "rect") {
      const bounds = normalizedBounds(object);
      const corners = [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
      ];
      return corners.some((point, index) =>
        capsuleIntersectsRect(
          point,
          corners[(index + 1) % 4],
          object.lineWidth / 2,
          rect,
        ),
      );
    }
    if (object.type === "text") {
      return Boolean(object.text) && rectsOverlap(textLayout(object), rect);
    }
    throw new TypeError(`Unsupported drawing object: ${object.type}`);
  }

  function removeIntersecting(objects, rect, textLayout) {
    const removedIds = [],
      remaining = [];
    for (const object of objects) {
      if (hitTestObject(object, rect, textLayout)) removedIds.push(object.id);
      else remaining.push(object);
    }
    objects.splice(0, objects.length, ...remaining);
    return removedIds;
  }

  function findText(objects, point, textLayout = fallbackTextLayout) {
    for (let index = objects.length - 1; index >= 0; index--) {
      const object = objects[index];
      if (
        object.type === "text" &&
        object.text &&
        rectsOverlap(textLayout(object), {
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
        })
      )
        return object;
    }
    return null;
  }

  return {
    normalizeRect,
    validDeleteDrag,
    rectsOverlap,
    pointSegmentDistanceSquared,
    pointRectDistanceSquared,
    segmentIntersectsRect,
    capsuleIntersectsRect,
    fallbackTextLayout,
    hitTestObject,
    removeIntersecting,
    findText,
  };
});
