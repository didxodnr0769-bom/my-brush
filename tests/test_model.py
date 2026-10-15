"""Behavioral coverage for deletion geometry and scene object ownership."""

import unittest

from my_brush.model import Rectangle, Scene, Stroke, Text, intersects, normalized_rect, valid_delete_drag


COLOR = "#ff5c5c"


class DragGeometryTests(unittest.TestCase):
    def test_all_drag_directions_produce_same_region(self):
        for a, b in (
            ((1, 2), (9, 12)),
            ((9, 12), (1, 2)),
            ((1, 12), (9, 2)),
            ((9, 2), (1, 12)),
        ):
            with self.subTest(a=a, b=b):
                self.assertEqual(normalized_rect(a, b), (1, 2, 8, 10))

    def test_click_and_zero_area_drag_do_not_delete(self):
        for end in ((0, 0), (0, 100), (100, 0), (1, 1), (1.2, 1.6)):
            with self.subTest(end=end):
                self.assertFalse(valid_delete_drag((0, 0), end))

    def test_long_thin_and_reverse_drag_are_valid(self):
        self.assertTrue(valid_delete_drag((0, 0), (0.1, 50)))
        self.assertTrue(valid_delete_drag((0.1, 50), (0, 0)))


class StrokeIntersectionTests(unittest.TestCase):
    def test_crossing_with_both_endpoints_outside_is_detected(self):
        stroke = Stroke("s", [(0, 0), (100, 100)], COLOR, 1)
        self.assertTrue(intersects(stroke, (49, 49, 2, 2)))

    def test_empty_area_inside_stroke_bounding_box_is_excluded(self):
        stroke = Stroke("s", [(0, 0), (0, 100), (100, 100)], COLOR, 4)
        self.assertFalse(intersects(stroke, (40, 40, 10, 10)))

    def test_round_cap_does_not_use_square_expanded_box(self):
        stroke = Stroke("s", [(0, 0), (10, 0)], COLOR, 4)
        self.assertFalse(intersects(stroke, (11.5, 1.5, 0.2, 0.2)))
        self.assertTrue(intersects(stroke, (12, -0.1, 1, 0.2)))

    def test_thick_side_touch_and_just_outside(self):
        stroke = Stroke("s", [(0, 0), (20, 0)], COLOR, 8)
        self.assertTrue(intersects(stroke, (8, 4, 2, 1)))
        self.assertFalse(intersects(stroke, (8, 4.001, 2, 1)))

    def test_single_point_and_repeated_points_are_round_dots(self):
        for points in ([(0, 0)], [(0, 0), (0, 0)]):
            with self.subTest(points=points):
                stroke = Stroke("s", points, COLOR, 2)
                self.assertTrue(intersects(stroke, (0.6, 0.8, 1, 1)))
                self.assertFalse(intersects(stroke, (0.8, 0.8, 1, 1)))

    def test_round_join_keeps_outside_corner_empty(self):
        stroke = Stroke("s", [(0, 10), (0, 0), (10, 0)], COLOR, 4)
        self.assertFalse(intersects(stroke, (-1.6, -1.6, 0.1, 0.1)))
        self.assertTrue(intersects(stroke, (-1.2, -1.6, 0.1, 0.1)))

    def test_empty_stroke_has_no_rendered_region(self):
        self.assertFalse(intersects(Stroke("s", [], COLOR, 20), (-100, -100, 200, 200)))


class RectangleIntersectionTests(unittest.TestCase):
    def setUp(self):
        self.rectangle = Rectangle("r", 10, 10, 100, 60, COLOR, 8)

    def test_hollow_interior_is_not_a_target(self):
        self.assertFalse(intersects(self.rectangle, (30, 25, 50, 20)))

    def test_partial_border_overlap_is_a_target(self):
        self.assertTrue(intersects(self.rectangle, (7, 30, 1, 5)))
        self.assertTrue(intersects(self.rectangle, (106, 30, 1, 5)))

    def test_border_touch_is_inclusive_on_both_sides(self):
        self.assertTrue(intersects(self.rectangle, (30, 6, 5, 1)))
        self.assertTrue(intersects(self.rectangle, (30, 14, 5, 1)))
        self.assertFalse(intersects(self.rectangle, (30, 14.01, 5, 1)))

    def test_round_corner_rejects_square_expansion_false_positive(self):
        self.assertFalse(intersects(self.rectangle, (6, 6, 0.5, 0.5)))
        self.assertTrue(intersects(self.rectangle, (7.5, 7.5, 0.5, 0.5)))

    def test_negative_selection_dimensions_are_normalized(self):
        positive = intersects(self.rectangle, (7, 30, 1, 5))
        reverse = intersects(self.rectangle, (8, 35, -1, -5))
        self.assertTrue(positive)
        self.assertEqual(reverse, positive)


class TextAndSceneTests(unittest.TestCase):
    @staticmethod
    def text_bounds(obj):
        # A test font's layout contract, including blank space between glyphs.
        return obj.x, obj.y, 100, 40

    def test_text_uses_layout_box_and_includes_boundary(self):
        text = Text("t", 10, 20, "가 나\nABC", COLOR, 28)
        self.assertTrue(intersects(text, (60, 30, 1, 1), self.text_bounds))
        self.assertTrue(intersects(text, (110, 60, 5, 5), self.text_bounds))
        self.assertFalse(intersects(text, (110.1, 60.1, 5, 5), self.text_bounds))

    def test_fallback_handles_multiline_without_qt(self):
        single = Text("one", 0, 0, "가", COLOR, 20)
        multi = Text("two", 0, 0, "가\n나", COLOR, 20)
        self.assertFalse(intersects(single, (0, 30, 1, 1)))
        self.assertTrue(intersects(multi, (0, 30, 1, 1)))

    def test_one_region_removes_entire_mixed_objects(self):
        stroke = Stroke("s", [(0, 0), (100, 0)], COLOR, 4)
        rectangle = Rectangle("r", 40, -20, 40, 40, COLOR, 2)
        text = Text("t", 45, -5, "텍스트", COLOR, 28)
        survivor = Stroke("safe", [(300, 300)], COLOR, 4)
        scene = Scene([stroke, rectangle, text, survivor])
        shared_objects = scene.objects
        removed = scene.remove_intersecting((39, -1, 10, 2), self.text_bounds)
        self.assertEqual(removed, ["s", "r", "t"])
        self.assertEqual(scene.objects, [survivor])
        self.assertIs(scene.objects, shared_objects)
        self.assertEqual(stroke.points, [(0, 0), (100, 0)])

    def test_non_targets_keep_order_and_separate_scenes_do_not_share_lists(self):
        first, second = Scene(), Scene()
        before = Stroke("before", [(500, 500)], COLOR, 2)
        target = Stroke("target", [(0, 0)], COLOR, 2)
        after = Rectangle("after", 400, 400, 10, 10, COLOR, 2)
        for obj in (before, target, after):
            first.add(obj)
        self.assertEqual(first.remove_intersecting((-1, -1, 2, 2)), ["target"])
        self.assertEqual(first.objects, [before, after])
        self.assertEqual(second.objects, [])

    def test_find_text_returns_topmost_text_only(self):
        lower = Text("lower", 0, 0, "아래", COLOR, 20)
        upper = Text("upper", 50, 20, "위", COLOR, 40)
        covering_stroke = Stroke("s", [(60, 30)], COLOR, 100)
        scene = Scene([lower, upper, covering_stroke])
        self.assertIs(scene.find_text((60, 30), self.text_bounds), upper)
        self.assertIs(scene.find_text((10, 10), self.text_bounds), lower)
        self.assertIs(scene.find_text((150, 60), self.text_bounds), upper)
        self.assertIsNone(scene.find_text((1000, 1000), self.text_bounds))


if __name__ == "__main__":
    unittest.main()
