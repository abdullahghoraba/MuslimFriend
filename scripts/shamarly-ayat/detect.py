"""Find the ayah-end markers and text lines on the scanned Shamarly pages.

Usage: py -I scripts/shamarly-ayat/detect.py <pages_dir> <out.json> [page ...]
  (pages_dir holds 001.png..522.png from https://archive.org/details/shamerly; needs opencv-python and numpy)
Output per page: {"w","h","lines":[[y0,y1,isFrame],...],"markers":[[cx,cy,w,h,line],...],"x0","x1"}
markers in reading order (line by line, right to left).
"""
import json, sys, os
import cv2
import numpy as np

LINES_PER_PAGE = 15


def find_markers(ink, w):
    contours, hier = cv2.findContours(ink, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    if hier is None:
        return out
    hier = hier[0]
    # 1) The marker's inside: a big rounded hole, larger than any letter's, even when the frame touches a word.
    for i, c in enumerate(contours):
        if hier[i][3] == -1:
            continue
        x, y, cw, ch = cv2.boundingRect(c)
        if not (0.033 * w <= cw <= 0.07 * w and 0.033 * w <= ch <= 0.075 * w and 0.75 <= cw / ch <= 1.2):
            continue
        if not 0.58 <= cv2.contourArea(c) / (cw * ch) <= 0.85:
            continue
        pad = round(0.004 * w)
        out.append([x + cw / 2, y + ch / 2, cw + 2 * pad, ch + 2 * pad])
    # 2) A free-standing frame whose hole the digits split (kept unless already found).
    for i, c in enumerate(contours):
        if hier[i][3] != -1:
            continue
        x, y, cw, ch = cv2.boundingRect(c)
        if not (0.028 * w <= cw <= 0.08 * w and 0.022 * w <= ch <= 0.08 * w):
            continue
        if not (0.75 <= cw / ch <= 1.6):
            continue
        # The marker is a closed frame: its biggest hole covers much of the box.
        child, best = hier[i][2], 0
        while child != -1:
            best = max(best, cv2.contourArea(contours[child]))
            child = hier[child][0]
        if best < 0.38 * cw * ch:
            continue
        fill = cv2.countNonZero(ink[y:y + ch, x:x + cw]) / (cw * ch)
        if fill > 0.62:
            continue
        cx, cy = x + cw / 2, y + ch / 2
        if any(abs(cx - m[0]) < cw / 2 and abs(cy - m[1]) < ch / 2 for m in out):
            continue
        out.append([cx, cy, cw, ch])
    return out


def find_lines(ink, w, h):
    """Bands of text. Dense pages have no blank rows between lines, so tall bands are split on the line grid."""
    core = ink[:, int(w * 0.06):int(w * 0.94)]
    rows = (core > 0).sum(axis=1)
    on = rows > 0.012 * w
    bands, start = [], None
    for y, v in enumerate(on):
        if v and start is None:
            start = y
        elif not v and start is not None:
            if y - start > 0.012 * h:
                bands.append([start, y])
            start = None
    if start is not None and h - start > 0.012 * h:
        bands.append([start, h])
    if not bands:
        return []
    top, bottom = bands[0][0], bands[-1][1]
    pitch = (bottom - top) / LINES_PER_PAGE
    lines = []
    for a, b in bands:
        n = max(1, round((b - a) / pitch)) if (b - a) > 1.6 * pitch else 1
        step = (b - a) / n
        for k in range(n):
            lines.append([round(a + k * step), round(a + (k + 1) * step)])
    return lines


def is_frame(colour, line, x0, x1):
    """A sura header: the coloured, ornamented frame across the line (the text itself is black)."""
    a, b = line
    seg = colour[a:b, x0:x1]
    if seg.size == 0:
        return False
    return bool(seg.any(axis=0).mean() > 0.6)


def analyse(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ink = (gray < 150).astype(np.uint8) * 255
    sat = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[:, :, 1]
    colour = sat > 70
    markers = find_markers(ink, w)
    lines = find_lines(ink, w, h)

    cols = np.where((ink > 0).sum(axis=0) > 0.01 * h)[0]
    x0, x1 = (int(cols.min()), int(cols.max())) if cols.size else (0, w)

    def line_of(cy):
        best, d = 0, 1e9
        for k, (a, b) in enumerate(lines):
            dist = 0 if a <= cy <= b else min(abs(cy - a), abs(cy - b))
            if dist < d:
                best, d = k, dist
        return best

    ms = [[round(cx, 1), round(cy, 1), cw, ch, line_of(cy)] for cx, cy, cw, ch in markers]
    ms.sort(key=lambda m: (m[4], -m[0]))
    marker_lines = {m[4] for m in ms}
    lines_out = [[a, b, (k not in marker_lines) and is_frame(colour, (a, b), x0, x1)] for k, (a, b) in enumerate(lines)]
    return {"w": w, "h": h, "x0": x0, "x1": x1, "lines": lines_out, "markers": ms}


def main():
    src, dst = sys.argv[1], sys.argv[2]
    pages = [int(p) for p in sys.argv[3:]] or list(range(1, 523))
    res = {}
    for p in pages:
        res[p] = analyse(os.path.join(src, f"{p:03d}.png"))
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(res, fh)
    if len(pages) <= 10:
        for p in pages:
            r = res[p]
            print(p, "markers", len(r["markers"]), "lines", len(r["lines"]), "frames", [k for k, l in enumerate(r["lines"]) if l[2]])


if __name__ == "__main__":
    main()
