"""Drawing objects and geometry, independent of the desktop toolkit.

All coordinates are logical display units. Strokes and rectangle borders use
round caps/joins, matching the overlay renderer's QPen configuration.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from math import hypot


Point = tuple[float, float]
Rect = tuple[float, float, float, float]


@dataclass
class Stroke:
    id: str
    points: list[Point]
    color: str
    width: float


@dataclass
class Rectangle:
    id: str
    x: float
    y: float
    width: float
    height: float
    color: str
    line_width: float


@dataclass
class Text:
    id: str
    x: float
    y: float
    text: str
    color: str
    font_size: int


DrawingObject = Stroke | Rectangle | Text
TextBounds = Callable[[Text], Rect]


def normalized_rect(a: Point, b: Point) -> Rect:
    """Return an axis-aligned rectangle regardless of drag direction."""
    return min(a[0], b[0]), min(a[1], b[1]), abs(b[0] - a[0]), abs(b[1] - a[1])


def valid_delete_drag(a: Point, b: Point) -> bool:
    """A click/zero-area drag is excluded; long, thin areas remain usable."""
    return a[0] != b[0] and a[1] != b[1] and hypot(b[0] - a[0], b[1] - a[1]) > 2


def _normalized_bounds(rect: Rect) -> Rect:
    x, y, width, height = rect
    return normalized_rect((x, y), (x + width, y + height))


def _point_in_rect(point: Point, rect: Rect) -> bool:
    x, y, width, height = rect
    return x <= point[0] <= x + width and y <= point[1] <= y + height


def _rects_intersect(first: Rect, second: Rect) -> bool:
    ax, ay, aw, ah = first
    bx, by, bw, bh = second
    return ax <= bx + bw and bx <= ax + aw and ay <= by + bh and by <= ay + ah


def _point_segment_distance_squared(point: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return (point[0] - a[0]) ** 2 + (point[1] - a[1]) ** 2
    t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length_squared
    t = min(1.0, max(0.0, t))
    return (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2


def _point_rect_distance_squared(point: Point, rect: Rect) -> float:
    x, y, width, height = rect
    dx = max(x - point[0], 0.0, point[0] - x - width)
    dy = max(y - point[1], 0.0, point[1] - y - height)
    return dx * dx + dy * dy


def _segment_crosses_rect(a: Point, b: Point, rect: Rect) -> bool:
    """Clip a segment to a closed box, including exact boundary contact."""
    x, y, width, height = rect
    low, high = 0.0, 1.0
    for start, end, minimum, maximum in (
        (a[0], b[0], x, x + width),
        (a[1], b[1], y, y + height),
    ):
        delta = end - start
        if delta == 0:
            if start < minimum or start > maximum:
                return False
            continue
        near, far = (minimum - start) / delta, (maximum - start) / delta
        if near > far:
            near, far = far, near
        low, high = max(low, near), min(high, far)
        if low > high:
            return False
    return True


def _round_segment_intersects(a: Point, b: Point, radius: float, rect: Rect) -> bool:
    if _segment_crosses_rect(a, b, rect):
        return True
    x, y, width, height = rect
    corners = ((x, y), (x + width, y), (x + width, y + height), (x, y + height))
    # For two disjoint line segments the minimum distance is attained by at
    # least one endpoint. Box corners plus the stroke endpoints therefore
    # cover both side contact and circular cap/join contact without the false
    # positives caused by merely expanding a bounding rectangle.
    distance_squared = min(
        _point_rect_distance_squared(a, rect),
        _point_rect_distance_squared(b, rect),
        *(_point_segment_distance_squared(corner, a, b) for corner in corners),
    )
    return distance_squared <= radius * radius


def _fallback_text_bounds(obj: Text) -> Rect:
    """Approximate layout for headless use; the UI supplies actual font metrics."""
    lines = obj.text.split("\n")
    size = max(1, obj.font_size)
    return obj.x, obj.y, max(map(len, lines), default=0) * size * 0.6, len(lines) * size * 1.2


def intersects(obj: DrawingObject, rect: Rect, text_bounds: TextBounds | None = None) -> bool:
    """Whether the object's rendered region touches the closed selection box.

    A rectangle's empty interior is excluded. Text intentionally uses a full
    layout box, including the spaces between glyphs, rather than glyph pixels.
    """
    rect = _normalized_bounds(rect)
    if isinstance(obj, Stroke):
        if not obj.points:
            return False
        radius = max(0.0, obj.width / 2)
        if len(obj.points) == 1:
            return _round_segment_intersects(obj.points[0], obj.points[0], radius, rect)
        return any(
            _round_segment_intersects(a, b, radius, rect)
            for a, b in zip(obj.points, obj.points[1:])
        )
    if isinstance(obj, Rectangle):
        x, y, width, height = _normalized_bounds((obj.x, obj.y, obj.width, obj.height))
        corners = ((x, y), (x + width, y), (x + width, y + height), (x, y + height))
        radius = max(0.0, obj.line_width / 2)
        return any(
            _round_segment_intersects(corners[index], corners[(index + 1) % 4], radius, rect)
            for index in range(4)
        )
    if isinstance(obj, Text):
        if not obj.text:
            return False
        bounds = (text_bounds or _fallback_text_bounds)(obj)
        return _rects_intersect(_normalized_bounds(bounds), rect)
    raise TypeError(f"Unsupported drawing object: {type(obj).__name__}")


@dataclass
class Scene:
    objects: list[DrawingObject] = field(default_factory=list)

    def add(self, obj: DrawingObject) -> None:
        self.objects.append(obj)

    def remove_intersecting(self, rect: Rect, text_bounds: TextBounds | None = None) -> list[str]:
        removed_ids = []
        remaining = []
        for obj in self.objects:
            if intersects(obj, rect, text_bounds):
                removed_ids.append(obj.id)
            else:
                remaining.append(obj)
        self.objects[:] = remaining
        return removed_ids

    def find_text(self, point: Point, text_bounds: TextBounds | None = None) -> Text | None:
        """Return the topmost text whose layout box contains the point."""
        for obj in reversed(self.objects):
            if isinstance(obj, Text) and obj.text:
                bounds = (text_bounds or _fallback_text_bounds)(obj)
                if _point_in_rect(point, _normalized_bounds(bounds)):
                    return obj
        return None
