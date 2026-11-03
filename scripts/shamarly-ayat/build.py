"""Turn the detected ayah markers into tap areas per ayah, checked against the page map.

Usage: py -I scripts/shamarly-ayat/build.py detected.json public/assets/quran/meta.json public/assets/quran/shamarly.json
         shamerly.db public/assets/quran/shamarly-ayat.json   (shamerly.db: github.com/Mr-DDDAlKilanny/Shamarly)
The markers come from detect.py; the Shamarly app's database is only used to check them (and to fill the few the
image search misses where a marker touches a word on both sides).
Output: {"v":1,"pages":[[[sura, aya, [x0,y0,x1,y1, ...]], ...] per page]}, coordinates in permille of the page
width / height, rects in reading order (right to left, top to bottom).
"""
import json, sqlite3, sys

det = {int(k): v for k, v in json.load(open(sys.argv[1], encoding="utf-8")).items()}
meta = json.load(open(sys.argv[2], encoding="utf-8"))
smap = json.load(open(sys.argv[3], encoding="utf-8"))
db = sqlite3.connect(sys.argv[4])
out_path = sys.argv[5]

refs = [(s["index"], a) for s in meta["suras"] for a in range(1, s["ayas"] + 1)]
index_of = {r: i for i, r in enumerate(refs)}
first = smap["first"]
N = smap["pages"]


def line_of(lines, cy):
    best, d = 0, 1e9
    for k, (a, b, _) in enumerate(lines):
        dist = 0 if a <= cy <= b else min(abs(cy - a), abs(cy - b))
        if dist < d:
            best, d = k, dist
    return best


# ---- markers: detected, checked against the database ----
filled = 0
for p in range(1, N + 1):
    d = det[p]
    ms = d["markers"]
    # The opening pages have larger markers that the image search finds; the database offsets differ there.
    rows = [] if p <= 3 else list(db.execute("select x, y from mushaf where page=? and ayah>0", (p,)))
    for x, y in rows:
        cx, cy = x + 22, y + 24
        if not any(abs(m[0] - cx) < 34 and abs(m[1] - cy) < 34 for m in ms):
            ms.append([cx, cy, 44, 46, line_of(d["lines"], cy)])
            filled += 1
    ms.sort(key=lambda m: (m[4], -m[0]))
print("filled from database:", filled)

counts = [len(det[p]["markers"]) for p in range(1, N + 1)]
assert sum(counts) == len(refs), (sum(counts), len(refs))
g, assign = 0, {}
for p in range(1, N + 1):
    assign[p] = list(range(g, g + counts[p - 1]))
    f = first[p - 1]
    # The map gives the first ayah seen on each page; that ayah's marker is the page's first one.
    if counts[p - 1] and f:
        assert g == index_of[tuple(f)], (p, refs[g], f)
    g += counts[p - 1]


def pm(v, size):
    return round(v * 1000 / size)


pages = []
for p in range(1, N + 1):
    d = det[p]
    w, h, lines, ms, x0, x1 = d["w"], d["h"], d["lines"], d["markers"], d["x0"], d["x1"]
    near_left = 0.035 * w
    entries = []

    def span(start_line, start_x, end_line, end_x):
        rects = []
        for L in range(start_line, end_line + 1):
            if lines[L][2]:
                continue  # a sura header frame
            right = start_x if L == start_line else x1
            left = end_x if L == end_line else x0
            if right - left >= 4:
                rects += [pm(left, w), pm(lines[L][0], h), pm(right, w), pm(lines[L][1], h)]
        return rects

    prev = None  # (line, left edge) of the previous marker on this page
    for k, m in enumerate(ms):
        s, a = refs[assign[p][k]]
        cx, cy, mw, mh, line = m
        if prev is None:
            start_line, start_x = 0, x1
        else:
            start_line, start_x = prev
            if start_x - x0 < near_left:  # the previous ayah closed its line
                start_line, start_x = start_line + 1, x1
        if a == 1:
            # A new sura: skip its header frame and basmala (none for at-Tawbah; al-Fatihah's basmala is ayah 1).
            frames = [i for i in range(start_line, line + 1) if lines[i][2]]
            if frames:
                start_line = frames[-1] + (1 if s in (1, 9) else 2)
            elif p in (2, 3):  # the decorated opening pages: header, then basmala for al-Baqarah
                start_line = 1 if s == 1 else 2
            elif prev is None and s != 9 and det[p - 1]["lines"] and det[p - 1]["lines"][-1][2]:
                start_line = 1  # the header closed the page before; the basmala opens this one
            start_x = x1
            start_line = min(start_line, line)
        entries.append([s, a, span(start_line, start_x, line, cx - mw / 2)])
        prev = (line, cx - mw / 2)
    # The ayah that runs on to the next page, after the page's last marker.
    if p < N and assign[p] and assign[p][-1] + 1 < len(refs):
        nxt = refs[assign[p][-1] + 1]
        line, left = prev
        text_after = line < len(lines) - 1 or left - x0 >= near_left
        if text_after and tuple(first[p] or ()) == nxt and nxt[1] != 1:
            sl, sx = (line + 1, x1) if left - x0 < near_left else (line, left)
            rects = span(sl, sx, len(lines) - 1, x0) if sl < len(lines) else []
            if rects:
                entries.append([nxt[0], nxt[1], rects])
    pages.append(entries)

json.dump({"v": 1, "pages": pages}, open(out_path, "w", encoding="utf-8"), separators=(",", ":"))
print("written", out_path, sum(len(e) for e in pages), "areas")
