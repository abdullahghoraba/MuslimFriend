"""Where each Shamarly page begins, to the word: pages break inside ayat, as in the printed mushaf.

Usage: py -I scripts/shamarly-ayat/splits.py <pages_dir> public/assets/quran/shamarly-ayat.json \
           public/assets/quran/text.json public/assets/quran/meta.json <out.json> [--show p ...]

For an ayah printed over two (or more) pages, the ink it takes on each page (columns with ink inside its areas, from
shamarly-ayat.json) is compared with the length of its words (letters, without tashkeel), and the words are shared
out in the same proportion. Output: {"v":1,"start":[[sura, aya, word], ...]}: page p starts at word `word` (0-based,
pause marks not counted as words) of that ayah.
"""
import json, os, re, sys
sys.stdout.reconfigure(encoding="utf-8")
import cv2
import numpy as np

pages_dir, areas_path, text_path, meta_path, out_path = sys.argv[1:6]
flags = [a for a in sys.argv[6:] if a.startswith('--') and a != '--show']
args = [a for a in sys.argv[6:] if a not in flags]
show = [int(x) for x in args[1:]] if args[:1] == ['--show'] else []
# Words printed before a page break tend to take more room than predicted (the last line is stretched to the margin):
# BIAS (in predicted-width units) moves the break earlier. Tuned on the page joins checked by eye.
BIAS = next((float(a.split('=')[1]) for a in flags if a.startswith('--bias=')), 0.0)
PROPORTIONAL = '--prop' in flags

areas = json.load(open(areas_path, encoding='utf-8'))['pages']
texts = json.load(open(text_path, encoding='utf-8'))
meta = json.load(open(meta_path, encoding='utf-8'))
start_of = {s['index']: s['start'] for s in meta['suras']}

TASHKEEL = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')
PAUSE = re.compile('^[ۖ-ۭ۞۩]+$')


BASMALA_WORDS = 4


def words(sura, aya):
    """The ayah's words; pause marks (ۚ ۖ ...) belong to the word before them. The basmala the text puts before
    the first ayah of a sura (except al-Fatihah, where it is the ayah, and at-Tawbah) is printed on its own line, so
    it is not counted."""
    out = []
    ws = texts[start_of[sura] + aya - 1].split()
    if aya == 1 and sura not in (1, 9) and ws[:1] and ws[0].startswith('بِسْمِ'):
        ws = ws[BASMALA_WORDS:]
    for w in ws:
        if PAUSE.match(w) and out:
            continue
        out.append(w)
    return out


def letters(w):
    return len(TASHKEEL.sub('', w))


_img = {}


MARKER = 55  # permille of the page width taken by an ayah-end marker and the space before it


def ink(p, rects, has_marker=False):
    """Columns with ink inside [rects] (permille) on page p; the ayah's end marker (in its last rect) left out."""
    if has_marker and rects:
        rects = rects[:-4] + [rects[-4] + MARKER] + rects[-3:]
    if p not in _img:
        g = cv2.imread(os.path.join(pages_dir, f'{p:03d}.png'), cv2.IMREAD_GRAYSCALE)
        _img[p] = g < 150
    m = _img[p]
    h, w = m.shape
    total = 0
    for i in range(0, len(rects), 4):
        x0, y0, x1, y1 = rects[i:i + 4]
        seg = m[y0 * h // 1000:y1 * h // 1000, x0 * w // 1000:x1 * w // 1000]
        if seg.size:
            total += int(seg.any(axis=0).sum())
    return total


# Every ayah's pieces in page order: {(sura, aya): [(page, rects), ...]}
pieces = {}
for p, page in enumerate(areas, start=1):
    for sura, aya, rects in page:
        pieces.setdefault((sura, aya), []).append((p, rects))


def width(rects, has_marker):
    """Printed width (permille of the page) of a piece: its rects, without the end marker."""
    total = sum(rects[i + 2] - rects[i] for i in range(0, len(rects), 4))
    return total - (MARKER if has_marker else 0)


# Letters are not equally wide (ا is narrow, س wide) and change shape with their place in the word: learn the printed
# width of each letter in each form (alone, first, middle, last) and of a word space, from the ayat printed whole on
# one page, then share a split ayah's words by predicted width.
NON_JOINING = set('اأإآٱدذرزوؤةءى')


def forms(word):
    """(letter, form) for each letter of [word]; form 0 alone, 1 first, 2 middle, 3 last."""
    letters_ = [c for c in TASHKEEL.sub('', word) if not c.isspace()]
    out = []
    for i, c in enumerate(letters_):
        joins_prev = i > 0 and letters_[i - 1] not in NON_JOINING
        joins_next = i < len(letters_) - 1 and c not in NON_JOINING
        out.append((c, (1 if joins_next else 0) if not joins_prev else (2 if joins_next else 3)))
    return out


KEYS = sorted({f for t in texts for w in t.split() for f in forms(w)})
COL = {k: i for i, k in enumerate(KEYS)}


def features(ws):
    f = np.zeros(len(KEYS) + 1)
    for w in ws:
        for k in forms(w):
            f[COL[k]] += 1
    f[-1] = max(0, len(ws) - 1)
    return f


rows, ys = [], []
for ref, parts in pieces.items():
    if len(parts) == 1 and ref[0] > 1:
        rows.append(features(words(*ref)))
        ys.append(width(parts[0][1], True))
weights, *_ = np.linalg.lstsq(np.array(rows), np.array(ys), rcond=None)
weights = np.maximum(weights, 0.5)
pred = np.array(rows) @ weights
print('width model: mean error %.1f%% over %d ayat' % (100 * np.mean(np.abs(pred - ys) / np.maximum(ys, 1)), len(ys)))


def word_width(w):
    return float(features([w])[:-1] @ weights[:-1]) + float(weights[-1])


start = [None] * len(areas)
for p, page in enumerate(areas, start=1):
    if page:
        start[p - 1] = [page[0][0], page[0][1], 0]

def line_widths(parts):
    """Printed width of each line piece of a split ayah, in order, with the page each is on."""
    out = []
    for k, (p, rects) in enumerate(parts):
        n = len(rects) // 4
        for i in range(n):
            w = rects[4 * i + 2] - rects[4 * i]
            if k == len(parts) - 1 and i == n - 1:
                w -= MARKER
            if w > 15:
                out.append((p, w))
    return out


def fit_lines(lens, lines):
    """Shares the words among the lines (each line whole words, in order) so each line's predicted width matches
    its printed width best (lines are justified, so a ratio near 1, the same for every line, is best)."""
    import math
    K, n = len(lens), len(lines)
    pre = [0.0]
    for x in lens:
        pre.append(pre[-1] + x)
    scale = pre[-1] / sum(w for _, w in lines)
    INF = float('inf')
    dp = [[INF] * (K + 1) for _ in range(n + 1)]
    back = [[0] * (K + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    for j in range(1, n + 1):
        meas = lines[j - 1][1] * scale
        for i in range(j, K - (n - j) + 1):
            for h in range(j - 1, i):
                if dp[j - 1][h] == INF:
                    continue
                c = dp[j - 1][h] + math.log((pre[i] - pre[h]) / meas) ** 2 * meas
                if c < dp[j][i]:
                    dp[j][i], back[j][i] = c, h
    if dp[n][K] == INF:
        return None
    cuts, i = [], K
    for j in range(n, 0, -1):
        cuts.append(i)
        i = back[j][i]
    return list(reversed(cuts))  # words up to the end of each line


margin = {}
for ref, parts in pieces.items():
    if len(parts) < 2:
        continue
    ws = words(*ref)
    lens = [word_width(w) for w in ws]
    lines = line_widths(parts)
    ends = fit_lines(lens, lines) if len(lines) <= len(ws) and not PROPORTIONAL else None
    for k, (p, _) in enumerate(parts[1:], start=1):
        if ends:
            # Words on the lines of the pages before this one.
            cut = max([e for (lp, _), e in zip(lines, ends) if lp < p] or [0])
        else:
            total_pred = sum(lens)
            widths = [width(r, j == len(parts) - 1) for j, (_, r) in enumerate(parts)]
            target = sum(widths[:k]) / (sum(widths) or 1) * total_pred - BIAS
            acc, cut, best_d = 0, 0, 1e9
            for i in range(len(ws) + 1):
                if abs(acc - target) < best_d:
                    cut, best_d = i, abs(acc - target)
                if i < len(ws):
                    acc += lens[i]
        cut = min(max(cut, 1), len(ws) - 1)
        start[p - 1] = [ref[0], ref[1], cut]
        # Confidence: how far the share printed before this page falls from the middle between two word ends
        # (0 = right in the middle, 1 = on a word end).
        total_pred = sum(lens)
        widths = [width(r, j == len(parts) - 1) for j, (_, r) in enumerate(parts)]
        target = sum(widths[:k]) / (sum(widths) or 1) * total_pred
        bounds = [sum(lens[:i]) for i in range(len(ws) + 1)]
        j = max(i for i in range(len(bounds)) if bounds[i] <= target) if target >= 0 else 0
        if j < len(ws):
            mid = (bounds[j] + bounds[j + 1]) / 2
            margin[p] = abs(target - mid) / ((bounds[j + 1] - bounds[j]) / 2)

# Every page that begins inside an ayah was checked by eye against the scans (scripts/shamarly-ayat/checked.json,
# 368 pages; the width model above had 60 of them one or two words off). The checked word wins.
checked = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'checked.json'), encoding='utf-8'))
changed = 0
for p, s3 in checked.items():
    if start[int(p) - 1] != s3:
        changed += 1
    start[int(p) - 1] = s3
print('checked pages:', len(checked), 'model differed on', changed)
json.dump({'v': 1, 'start': start}, open(out_path, 'w', encoding='utf-8'), separators=(',', ':'))
print('pages starting inside an ayah:', sum(1 for s in start if s and s[2] > 0))

for p in show:
    s = start[p - 1]
    ws = words(s[0], s[1])
    prev = start[p - 2]
    print(f'page {p}: starts {s[0]}:{s[1]} word {s[2]}  | page {p-1} ends with: ...{" ".join(ws[max(0, s[2]-3):s[2]])}  | page {p} begins: {" ".join(ws[s[2]:s[2]+3])}...')
