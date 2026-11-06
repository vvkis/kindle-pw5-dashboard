import copy
import importlib.util
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("renderer", ROOT / "host/render_dashboard.py")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class RendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / "out").mkdir(exist_ok=True)

    def test_render_is_valid_and_repeatable(self):
        data = renderer.load_data(ROOT / "data/demo.json")
        with tempfile.TemporaryDirectory(dir=ROOT / "out") as directory:
            paths = [Path(directory) / name for name in ("first.png", "second.png")]
            for path in paths:
                renderer.render(data, path, datetime(2026, 11, 6, 9), renderer.find_font())
                renderer.validate_png(path)
            self.assertEqual(paths[0].read_bytes(), paths[1].read_bytes())

    def test_rejects_wrong_size_color_and_truncated_images(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "out") as directory:
            path = Path(directory) / "bad.png"
            for size, mode in (((100, 100), "L"), (renderer.SIZE, "RGB")):
                Image.new(mode, size).save(path)
                with self.assertRaises(ValueError):
                    renderer.validate_png(path)
            path.write_bytes(b"\x89PNG\r\n\x1a\n")
            with self.assertRaises(OSError):
                renderer.validate_png(path)

    def test_invalid_input_does_not_replace_existing_output(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "out") as directory:
            path = Path(directory) / "dashboard.png"
            path.write_bytes(b"last good dashboard")
            with self.assertRaises(KeyError):
                renderer.render({}, path, datetime.now(), renderer.find_font())
            self.assertEqual(path.read_bytes(), b"last good dashboard")

    def test_empty_and_long_lists_render(self):
        data = renderer.load_data(ROOT / "data/demo.json")
        with tempfile.TemporaryDirectory(dir=ROOT / "out") as directory:
            for count in (0, 12):
                variant = copy.deepcopy(data)
                variant["events"] = [{"time": "12:00", "title": "超长日程" * 100, "detail": "备注" * 100}] * count
                variant["todos"] = [{"text": "超长待办" * 100, "done": False}] * count
                path = Path(directory) / "test.png"
                renderer.render(variant, path, datetime.now(), renderer.find_font())
                renderer.validate_png(path)

    def test_schema_rejects_bad_todo(self):
        import json
        data = renderer.load_data(ROOT / "data/demo.json")
        data["todos"][0]["done"] = "false"
        with tempfile.TemporaryDirectory(dir=ROOT / "out") as directory:
            path = Path(directory) / "bad.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(ValueError):
                renderer.load_data(path)


if __name__ == "__main__":
    (ROOT / "out").mkdir(exist_ok=True)
    unittest.main()
