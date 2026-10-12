#!/usr/bin/env python3
"""Page-level checks of a report PDF with poppler and PIL: pages with nothing on them, pictures drawn stretched (their horizontal and
vertical resolution differ), the footer on every page with its running 'Page N of M'.  Prints one JSON object.

    python3 pdf_audit.py report.pdf
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

pdf = sys.argv[1]
out = {"pages": 0, "problems": [], "blankPages": [], "stretched": 0, "images": 0, "orphanHeadings": [], "sparsePages": [], "warnings": []}


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, errors="ignore").stdout


info = run("pdfinfo", pdf)
m = re.search(r"Pages:\s+(\d+)", info)
pages = int(m.group(1)) if m else 0
out["pages"] = pages

# the footer: "Page N of M" on every page, in order
for p in range(1, pages + 1):
    text = run("pdftotext", "-f", str(p), "-l", str(p), "-layout", pdf, "-")
    if not re.search(rf"Page\s+{p}\s+of\s+{pages}\b", text):
        out["problems"].append(f"page {p} does not carry 'Page {p} of {pages}' in its footer")
    if "Client:" not in text:
        out["problems"].append(f"page {p} has no footer")
    body = [l.strip() for l in text.splitlines() if l.strip() and not re.search(r"Client:|Page\s+\d+\s+of|PO BOX|houspect|Acespect Pty", l)]
    if body and re.fullmatch(r"[A-Z][A-Z &/,\-]{3,}", body[-1]) and p < pages:
        out["orphanHeadings"].append(f"page {p} ends on the heading '{body[-1]}'")

# a page with only a line or two of text and no photograph (flow-over from the page before, then a forced page break)
photo_pages = set()
for line in run("pdfimages", "-list", pdf).splitlines()[2:]:
    cols = line.split()
    if len(cols) >= 5 and cols[2] == "image" and not (cols[3] == "742" and cols[4] == "276"):
        photo_pages.add(int(cols[0]))
for p in range(1, pages):
    text = run("pdftotext", "-f", str(p), "-l", str(p), "-layout", pdf, "-")
    body = [l for l in text.splitlines() if l.strip() and not re.search(r"Client:|Page\s+\d+\s+of|PO BOX|houspect|Acespect Pty", l)]
    if 0 < len(body) <= 4 and p not in photo_pages:
        out["sparsePages"].append(p)

# pictures: drawn with the same resolution both ways (not stretched)
for line in run("pdfimages", "-list", pdf).splitlines()[2:]:
    cols = line.split()
    if len(cols) >= 14 and cols[2] == "image":
        out["images"] += 1
        xppi, yppi = float(cols[12]), float(cols[13])
        if yppi and abs(xppi - yppi) / max(xppi, yppi) > 0.03:
            out["stretched"] += 1
            out["problems"].append(f"page {cols[0]}: a picture is drawn stretched ({xppi}x{yppi} ppi)")

# pages with nothing on them (apart from the header and the footer)
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(["pdftoppm", "-r", "30", "-png", pdf, f"{tmp}/p"], capture_output=True)
    for f in sorted(Path(tmp).glob("p-*.png")):
        im = Image.open(f).convert("L")
        w, h = im.size
        body = im.crop((0, int(h * 0.105), w, int(h * 0.80)))
        dark = sum(1 for px in body.tobytes() if px < 235)
        ink = dark / (body.size[0] * body.size[1])
        if ink < 0.0002:
            out["blankPages"].append(int(f.stem.split("-")[1]))
if out["blankPages"]:
    out["problems"].append(f"blank pages: {out['blankPages']}")
if out["sparsePages"]:
    out["warnings"].append(f"pages with only a few lines on them (flow-over from the page before): {out['sparsePages']}")
out["problems"] += out["orphanHeadings"]
print(json.dumps(out))
