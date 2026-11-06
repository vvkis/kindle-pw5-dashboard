"""Render local demonstration data to a Kindle PW5 grayscale PNG. No network calls."""
from __future__ import annotations

import argparse
import json
import math
import os
import tempfile
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SIZE = (1236, 1648)
INK, MUTED = 0, 80


def load_data(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("Dashboard data must be a JSON object")
    if not isinstance(data.get("location"), str) or not data["location"].strip():
        raise ValueError("location must be a nonempty string")
    weather = data.get("weather")
    if not isinstance(weather, dict):
        raise ValueError("weather must be an object")
    for key in ("condition", "wind", "note"):
        if not isinstance(weather.get(key), str):
            raise ValueError(f"weather.{key} must be a string")
    for key in ("temperature", "low", "high", "humidity"):
        value = weather.get(key)
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
            raise ValueError(f"weather.{key} must be a finite number")
    if not 0 <= weather["humidity"] <= 100 or weather["low"] > weather["high"]:
        raise ValueError("Invalid humidity or temperature range")
    for group, fields in (("events", ("time", "title", "detail")), ("todos", ("text",))):
        rows = data.get(group)
        if not isinstance(rows, list):
            raise ValueError(f"{group} must be a list")
        for row in rows:
            if not isinstance(row, dict) or any(not isinstance(row.get(k), str) for k in fields):
                raise ValueError(f"Invalid {group} entry; required strings: {fields}")
            if group == "todos" and not isinstance(row.get("done"), bool):
                raise ValueError("todos.done must be a boolean")
    return data


def find_font(explicit: Path | None = None) -> Path:
    if explicit is not None:
        if not explicit.is_file():
            raise ValueError(f"Font not found: {explicit}")
        return explicit
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("/System/Library/Fonts/PingFang.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise ValueError("No Chinese font found. Pass --font /path/to/a/CJK-font.ttf")


def validate_png(path: Path) -> None:
    with Image.open(path) as image:
        if image.format != "PNG" or image.size != SIZE or image.mode != "L":
            raise ValueError(f"Expected PNG {SIZE} mode L, got {image.format} {image.size} {image.mode}")
        image.load()  # Decode the complete file before accepting it.


def render(data: dict, out: Path, at: datetime, font_path: Path) -> None:
    image = Image.new("L", SIZE, 255)
    draw = ImageDraw.Draw(image)
    fonts = {size: ImageFont.truetype(str(font_path), size) for size in (26, 30, 34, 38, 44, 60, 116)}

    def text(x: int, y: int, value: str, size: int = 34, fill: int = INK, width: int = 1124):
        value = " ".join(str(value).split())
        font = fonts[size]
        if draw.textlength(value, font=font) > width:
            while value and draw.textlength(value + "…", font=font) > width:
                value = value[:-1]
            value += "…"
        draw.text((x, y), value, font=font, fill=fill, anchor="lt")

    def line(y: int):
        draw.line((56, y, 1180, y), fill=INK, width=3)

    text(56, 48, "每日一览", 44)
    draw.rounded_rectangle((928, 46, 1180, 98), radius=8, outline=INK, width=2)
    text(949, 57, "测试数据 · DEMO", 26, width=215)
    weekday = "一二三四五六日"[at.weekday()]
    text(56, 126, f"{at:%Y 年 %m 月 %d 日}  星期{weekday}", 38)
    text(56, 196, at.strftime("%H:%M"), 116)
    text(784, 245, data["location"], 38, width=396)
    line(340)

    weather = data["weather"]
    text(56, 380, "天气", 30, MUTED)
    text(56, 442, f'{weather["temperature"]:g}°', 116, width=460)
    text(570, 455, weather["condition"], 60, width=610)
    text(570, 540, f'{weather["low"]:g}° / {weather["high"]:g}°  ·  湿度 {weather["humidity"]:g}%', 34, width=610)
    text(56, 603, weather["wind"], 34)
    text(56, 663, weather["note"], 30, MUTED)
    line(735)

    text(56, 775, "今日日程", 38)
    events = data["events"]
    if not events:
        text(56, 848, "今天没有安排", 34, MUTED)
    for index, event in enumerate(events[:3]):
        y = 850 + index * 105
        text(56, y, event["time"], 38, width=175)
        text(260, y, event["title"], 38, width=920)
        text(260, y + 49, event["detail"], 26, MUTED, width=920)
    if len(events) > 3:
        text(56, 1178, f"另有 {len(events) - 3} 项日程", 26, MUTED)
    line(1220)

    text(56, 1254, "待办事项", 38)
    todos = data["todos"]
    if not todos:
        text(56, 1325, "所有事项已清空", 34, MUTED)
    for index, todo in enumerate(todos[:3]):
        y = 1324 + index * 67
        draw.rectangle((58, y + 3, 88, y + 33), outline=INK, width=3)
        if todo["done"]:
            draw.line((63, y + 18, 71, y + 27, 84, y + 9), fill=INK, width=4)
        text(113, y, todo["text"], 34, MUTED if todo["done"] else INK, width=1067)
    if len(todos) > 3:
        text(56, 1522, f"另有 {len(todos) - 3} 项待办", 26, MUTED)
    line(1563)
    text(56, 1588, f"DEMO · 渲染时间 {at:%m-%d %H:%M} · 非实时信息", 26, MUTED, width=920)
    text(1020, 1588, "PW5", 26, MUTED, width=160)

    out.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".dashboard-", suffix=".png", dir=out.parent)
    os.close(fd)
    temp = Path(name)
    try:
        image.save(temp, format="PNG", optimize=True)
        validate_png(temp)
        os.replace(temp, out)
    finally:
        temp.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "data/demo.json")
    parser.add_argument("--out", type=Path, default=ROOT / "out/dashboard.png")
    parser.add_argument("--font", type=Path, help="Chinese TTF/OTF/TTC font")
    parser.add_argument("--at", help="ISO local datetime override, e.g. 2026-11-06T09:00:00")
    parser.add_argument("--validate-only", action="store_true", help="Validate --out without rendering")
    args = parser.parse_args()
    try:
        if args.validate_only:
            validate_png(args.out)
        else:
            at = datetime.fromisoformat(args.at) if args.at else datetime.now().astimezone()
            render(load_data(args.data), args.out, at, find_font(args.font))
        print(f"OK: {args.out.resolve()} (1236x1648, grayscale L PNG)")
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
