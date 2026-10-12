#!/usr/bin/env python3
"""Checks a Word report's structure: the package is a valid zip, every part is well-formed XML, and every picture keeps its own shape
(the size it is drawn at has the same width : height as the image file) and fits the text column.  Prints one JSON object.

    python3 docx_audit.py report.docx
"""
import json
import struct
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
TEXT_WIDTH_EMU = int((21 - 2 * 2.2) / 2.54 * 914400)  # A4 less the 22 mm side margins


def image_size(data: bytes):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[i + 5 : i + 9])
                return w, h
            i += 2 + struct.unpack(">H", data[i + 2 : i + 4])[0]
    return None


out = {"ok": True, "problems": [], "pictures": 0, "stretched": 0, "tooWide": 0}
try:
    z = zipfile.ZipFile(sys.argv[1])
    bad = z.testzip()
    if bad:
        out["problems"].append(f"corrupt zip member {bad}")
    for name in z.namelist():
        if name.endswith(".xml") or name.endswith(".rels"):
            try:
                ET.fromstring(z.read(name))
            except ET.ParseError as e:
                out["problems"].append(f"{name} is not well-formed XML: {e}")
    doc = ET.fromstring(z.read("word/document.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("word/_rels/document.xml.rels"))}
    for d in doc.iter("{%s}drawing" % NS["w"]):
        ext = d.find(".//wp:extent", NS)
        blip = d.find(".//a:blip", NS)
        if ext is None or blip is None:
            out["problems"].append("a picture has no size or no image")
            continue
        out["pictures"] += 1
        cx, cy = int(ext.get("cx")), int(ext.get("cy"))
        target = rels.get(blip.get("{%s}embed" % NS["r"]))
        data = z.read("word/" + target) if target else b""
        size = image_size(data)
        if not size:
            out["problems"].append(f"picture {target} is not a PNG or JPEG Word can hold")
            continue
        drawn, real = cx / cy, size[0] / size[1]
        if abs(drawn - real) / real > 0.03:
            out["stretched"] += 1
            out["problems"].append(f"picture {target} is drawn {drawn:.3f}:1 but the file is {real:.3f}:1")
        if cx > TEXT_WIDTH_EMU * 1.01:
            out["tooWide"] += 1
            out["problems"].append(f"picture {target} is wider than the text column")
    for part in ("word/header1.xml", "word/footer1.xml"):
        if part not in z.namelist():
            out["problems"].append(f"{part} is missing")
except Exception as e:  # noqa: BLE001
    out["problems"].append(f"could not read the file: {e}")
out["ok"] = not out["problems"]
print(json.dumps(out))
