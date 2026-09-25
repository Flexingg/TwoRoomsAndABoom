#!/usr/bin/env python3
"""Extract the card art from the publisher's print-and-play sheets.

    python3 tools/assets/extract_cards.py [--dpi 300] [--check]
                                          [--ocr-python /tmp/ocrvenv/bin/python]

Art source: `printable_files/*.pdf` only. Nothing is downloaded and nothing is
fetched — this tool has no network path at all.

Per sheet:
  1. render the page with `pdftoppm` at `--dpi`;
  2. find the card grid from the page's own ink (two row bands from the white
     gutter between them; four columns by quartering the ink's x-extent — the
     cards are printed edge to edge, so there is no gutter between columns);
  3. cut every cell as printed (portrait — exactly the publisher's card face,
     role title rotated down the side, team bar across the bottom) plus the
     team-colour bar on its own, which is what a colour share shows;
  4. name the card from the words the PDF puts inside that cell (or OCR for the
     six sheets that are image-only), matched against the role catalogue in
     `shared/src/roles.ts`; the two-printing pairs (Agent, Ambassador, Spy) are
     resolved by the printed colour of the bar, because a Spy card is printed in
     the opposite team's colour;
  5. write WebP faces + bars to `client/public/cards/`, the manifest to
     `shared/cards/assets.json`, and a contact sheet to `tools/assets/`.

Look at the contact sheet when this runs: it is the only real check that the
crops and the names are right. `--check` fails if an engine role has no art or
art has no engine role.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHEETS_DIR = os.path.join(ROOT, "printable_files")
CARDS_OUT = os.path.join(ROOT, "client", "public", "cards")
MANIFEST = os.path.join(ROOT, "shared", "cards", "assets.json")
CONTACT = os.path.join(ROOT, "tools", "assets", "contact-sheet.png")
WORK = "/tmp/tr_cards"

CHARACTER_SHEETS = [f"PnP{n:02d}" for n in range(1, 15)]
LEADER_FRONT = "Pnp-Leader Cards-Front"
LEADER_BACK = "Pnp-Leader Cards-Back"
CARD_BACKS = "PnPCardBacks"
ALL_SHEETS = CHARACTER_SHEETS + [LEADER_FRONT, LEADER_BACK, CARD_BACKS]

# Printed names that do not match the engine's name for the card, longest first
# ("PRESIDENT'S DAUGHTER" has to beat "PRESIDENT").
PRINTED_ALIASES: dict[str, str] = {
    "president's daughter": "President's Daughter",
    "tuesday knight": "Tuesday Knight",
    "nuclear tyrant": "Nuclear Tyrant",
    "private eye": "Private Eye",
    "dr. boom": "Dr. Boom",
    "bomb-bot": "Bomb-Bot",
    "hot potato": "Hot Potato",
    "shy guy": "Shy Guy",
    "coy boy": "Coy Boy",
    "team zombie": "Zombie",
    "red team": "Red Team",
    "blue team": "Blue Team",
}
# The bar words, which appear on every card and name nobody.
BAR_WORDS = ("grey team", "green team", "team zombie", "red team", "blue team")

# Every sheet prints its cards this way round: role title rotated down the side,
# art upright, team bar across the bottom. Rotating a cell 90° anticlockwise
# puts the title at the top-left, which is the only part of the card that names
# it — the small print below quotes other roles and would confuse the matcher.
TITLE_BOX = (0.00, 0.00, 0.72, 0.40)  # of the rotated cell: x' up to 72%, y' up to 40%


LANCZOS = Image.Resampling.LANCZOS


def sh(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def sheets() -> dict[str, str]:
    out: dict[str, str] = {}
    for fn in sorted(os.listdir(SHEETS_DIR)):
        if not fn.endswith(".pdf"):
            continue
        for name in ALL_SHEETS:
            if name.replace(" ", "_") in fn.replace(" ", "_") and name not in out:
                out[name] = os.path.join(SHEETS_DIR, fn)
    missing = [n for n in ALL_SHEETS if n not in out]
    if missing:
        print(f"!! missing sheets: {missing}")
    return out


def render(pdf: str, tag: str, dpi: int) -> str:
    os.makedirs(WORK, exist_ok=True)
    prefix = os.path.join(WORK, tag.replace(" ", "_"))
    done = sorted(f for f in os.listdir(WORK) if f.startswith(os.path.basename(prefix)))
    if done:
        return os.path.join(WORK, done[0])
    r = sh(["pdftoppm", "-png", "-r", str(dpi), pdf, prefix])
    if r.returncode != 0:
        raise RuntimeError(f"pdftoppm failed for {pdf}: {r.stderr}")
    done = sorted(f for f in os.listdir(WORK) if f.startswith(os.path.basename(prefix)))
    return os.path.join(WORK, done[0])


# ---------------------------------------------------------------- geometry ---


def ink_mask(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("RGB")).astype(int).sum(axis=2) < 730


def bands(counts: np.ndarray, thr: float, min_len: int) -> list[tuple[int, int]]:
    out, start = [], None
    for i, v in enumerate(counts):
        if v > thr and start is None:
            start = i
        elif v <= thr and start is not None:
            if i - start >= min_len:
                out.append((start, i - 1))
            start = None
    if start is not None and len(counts) - start >= min_len:
        out.append((start, len(counts) - 1))
    return out


TEAM_REF = {"red": (0, 0), "blue": (218, 0), "green": (120, 0), "grey": (0, 0)}


def classify_colour(pixels: np.ndarray) -> str:
    """Name the printed colour of a bar: red / blue / green / grey / purple."""
    rgb = np.median(pixels, axis=0)
    mx, mn = rgb.max(), rgb.min()
    if mx == 0 or (mx - mn) / mx < 0.18:
        return "grey"
    r, g, b = (v / 255 for v in rgb)
    mx_c, mn_c = max(r, g, b), min(r, g, b)
    d = mx_c - mn_c or 1e-9
    if mx_c == r:
        hue = (60 * ((g - b) / d)) % 360
    elif mx_c == g:
        hue = 60 * ((b - r) / d) + 120
    else:
        hue = 60 * ((r - g) / d) + 240
    if hue < 25 or hue >= 330:
        return "red"
    if 25 <= hue < 70:
        return "yellow"
    if 70 <= hue < 170:
        return "green"
    if 170 <= hue < 245:
        return "blue"
    # The Drunk is printed with a "????" team bar — it becomes the buried card, so
    # the card itself says no team at all.
    return "unknown"


def cut_bar(cell: np.ndarray) -> tuple[int, str]:
    """The team bar = the solid colour band along the bottom of the card.

    Most cards have a plain bar, so the band can be read straight off the
    bottom. A couple of cards (the Zombie's green bar) have art overlapping it,
    so the bar is found as the longest run of one colour near the bottom and
    then followed back up while that colour keeps dominating the row.
    """
    h = cell.shape[0]
    med = np.median(cell, axis=1)
    uniform = np.array([((np.abs(cell[y] - med[y]).max(axis=1) <= 18).mean() > 0.90) for y in range(h)])

    def ok(height: int) -> bool:
        return 0.04 * h <= height <= 0.22 * h

    # The ordinary case: the bar is the run of solid colour at the very bottom.
    y = h - 1
    while y > 0 and uniform[y]:
        y -= 1
    top = y + 1
    if not ok(h - top):
        # Art overlapping the bar (the Zombie's green one) breaks that run, so
        # fall back to the longest near-solid run in the bottom quarter of the
        # card, kept thin — this is the colour share, not the whole card.
        floor = int(h * 0.78)
        near = np.array([((np.abs(cell[y] - med[y]).max(axis=1) <= 18).mean() > 0.60) for y in range(h)])
        best_len, best_top, run = 0, 0, None
        for y in range(floor, h):
            if near[y] and run is None:
                run = y
            elif not near[y] and run is not None:
                if y - run > best_len:
                    best_len, best_top = y - run, run
                run = None
        if run is not None and h - run > best_len:
            best_len, best_top = h - run, run
        if best_len:
            top = max(best_top, int(h * 0.88))
        if not ok(h - top):
            return 0, "unknown"
    return h - top, classify_colour(cell[top:h].reshape(-1, 3))


def grid_cells(page: Image.Image) -> list[tuple[int, int, int, int] | None]:
    """The card rectangles as printed, in reading order (4 per row, 2 rows).

    The columns come from the page's own ink, not from each row: the last sheet
    prints six cards on a page with room for eight, so a row-by-row split would
    slice the two real cards in that row into quarters. A cell with no ink is a
    blank slot and comes back as None.
    """
    mask = ink_mask(page)
    rows_n, cols_n = mask.shape
    row_bands = bands(mask.sum(axis=1), cols_n * 0.05, int(rows_n * 0.05))
    if len(row_bands) != 2:
        raise RuntimeError(f"expected 2 card rows, found {len(row_bands)}: {row_bands}")
    xb = bands(mask.sum(axis=0), rows_n * 0.05, 20)
    if not xb:
        raise RuntimeError("no ink columns on the page")
    x0, x1 = xb[0][0], xb[-1][1]
    step = (x1 - x0 + 1) / 4
    boxes: list[tuple[int, int, int, int] | None] = []
    for y0, y1 in row_bands:
        for c in range(4):
            bx0, bx1 = int(x0 + c * step), int(x0 + (c + 1) * step)
            cell = mask[y0 : y1 + 1, bx0:bx1]
            boxes.append(None if cell.mean() < 0.02 else (bx0, y0, bx1, y1))
    return boxes


# -------------------------------------------------------------- pdf words ----


@dataclass
class Word:
    x: float
    y: float
    text: str
    size: float = 0.0


def pdf_words(pdf: str) -> tuple[float, float, list[Word]]:
    r = sh(["pdftotext", "-bbox", pdf, "-"])
    html = r.stdout
    page = re.search(r'<page width="([\d.]+)" height="([\d.]+)"', html)
    if not page:
        return 0.0, 0.0, []
    words = []
    for m in re.finditer(
        r'<word xMin="([\d.eE+-]+)" yMin="([\d.eE+-]+)" xMax="([\d.eE+-]+)" yMax="([\d.eE+-]+)">(.*?)</word>',
        html,
    ):
        x0, y0, x1, y1 = (float(m.group(i)) for i in range(1, 5))
        # The role title is printed rotated 90°, so for a rotated word the cap
        # height (i.e. the font size) is the box's *width*.
        w, h = x1 - x0, y1 - y0
        size = w if w < h else h
        words.append(Word((x0 + x1) / 2, (y0 + y1) / 2, m.group(5), size))
    return float(page.group(1)), float(page.group(2)), words


# ------------------------------------------------------------------ naming ---


def catalogue() -> list[dict]:
    """The engine's role catalogue, parsed out of shared/src/roles.ts.

    Roles written on one line, multi-line, and the ones the `pair()` helper
    expands are all read here, so the manifest and the engine cannot drift apart
    silently. (An earlier version of this parser matched only multi-line
    `role({...})` blocks and quietly missed a dozen roles.)
    """
    src = open(os.path.join(ROOT, "shared", "src", "roles.ts")).read()
    roles: list[dict] = []

    def fields(chunk: str, need_key: bool = True) -> dict | None:
        key = re.search(r'key:\s*"([^"]+)"', chunk)
        name = re.search(r'name:\s*"([^"]+)"', chunk)
        team = re.search(r'team:\s*"(red|blue|grey|green)"', chunk)
        colour = re.search(r'cardColor:\s*"(red|blue|grey|green)"', chunk)
        if not (name and (key or not need_key) and (team or not need_key)):
            return None
        return {
            "key": key.group(1) if key else "",
            "name": name.group(1),
            "team": team.group(1) if team else "",
            "cardColor": colour.group(1) if colour else (team.group(1) if team else ""),
        }

    for chunk in blocks(src, "role({"):
        f = fields(chunk)
        if f:
            roles.append(f)

    for chunk in blocks(src, "pair("):
        # `pair(base, {...})` states the name once and the team per variant, so
        # neither `key` nor `team` is written in the call.
        base = re.match(r'pair\(\s*"([^"]+)"', chunk)
        f = fields(chunk, need_key=False)
        if not (base and f):
            continue  # the `function pair(...)` definition itself
        for team in ("red", "blue"):
            roles.append({"key": f"{base.group(1)}_{team}", "name": f["name"], "team": team, "cardColor": team})

    seen, out = set(), []
    for r in roles:
        if r["key"] not in seen:
            seen.add(r["key"])
            out.append(r)
    return out


def blocks(src: str, opener: str) -> list[str]:
    """Every balanced `opener ... )` chunk in the source, strings respected."""
    out: list[str] = []
    i = 0
    while True:
        j = src.find(opener, i)
        if j < 0:
            return out
        k, depth, quote = j + len(opener), 1, None
        while k < len(src) and depth:
            ch = src[k]
            if quote:
                if ch == "\\":
                    k += 2
                    continue
                if ch == quote:
                    quote = None
            elif ch in "\"'`":
                quote = ch
            elif ch in "{[(":
                depth += 1
            elif ch in "}])":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        out.append(src[j:k])
        i = k + 1


def normalise(text: str) -> str:
    up = re.sub(r"[^A-Z0-9'. ]+", " ", text.upper())
    return re.sub(r"\s+", " ", up).strip()


def squash(text: str) -> str:
    """Letters and digits only — for OCR that runs words together ("BLUESPY")."""
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def name_tokens(name: str) -> list[str]:
    return [t for t in re.findall(r"[A-Z0-9]+", name.upper()) if len(t) > 1]


def match_name(text: str, roles: list[dict]) -> tuple[str | None, str]:
    """Which printed role this text names. Returns (name, how it was decided).

    Tiers, in order: a printed alias (longest first), then a catalogue name,
    then the same two against squashed text for OCR that merged words, then a
    token-overlap pass for OCR that scrambled them, and only then the plain
    "RED TEAM"/"BLUE TEAM" cards — whose title is the team name itself, which is
    also what every card's bottom bar says, so it has to come last.
    """
    up, flat = normalise(text), squash(text)
    if not flat:
        return None, ""

    def hit(needle: str) -> bool:
        n = normalise(needle)
        return bool(re.search(rf"\b{re.escape(n)}\b", up)) or squash(needle) in flat

    aliases = sorted(PRINTED_ALIASES.items(), key=lambda kv: -len(kv[0]))
    for printed, canonical in aliases:
        if printed in BAR_WORDS:
            continue
        if hit(printed):
            return canonical, f"printed as {printed!r}"

    names = sorted({r["name"] for r in roles}, key=len, reverse=True)
    for n in names:
        if n.lower() in ("red team", "blue team"):
            continue
        if hit(n):
            return n, "catalogue"

    # OCR that scrambled the order: score every role by its name tokens, and
    # take the longest name whose tokens are all there, earliest in the text.
    toks = set(re.findall(r"[A-Z0-9]+", up))
    best: list[tuple[int, int, int, str]] = []  # (-tokens, first position, -len, name)
    for n in names:
        need = name_tokens(n)
        if not need or not all(t in toks for t in need):
            continue
        pos = min(up.find(t) if up.find(t) >= 0 else 10**6 for t in need)
        best.append((-len(need), pos, -len(n), n))
    if best:
        best.sort()
        top = [b for b in best if b[:1] == best[0][:1]]  # same token count
        top.sort(key=lambda b: (b[1], b[2]))
        if len(top) == 1 or top[0][1] < top[1][1]:
            return top[0][3], "token overlap"
        return None, f"ambiguous: {[b[3] for b in top]}"

    # OCR that also dropped a letter or two ("NUCLEARTYRAN" for Nuclear Tyrant).
    close = difflib.get_close_matches(flat, [squash(n) for n in names] + [squash(a) for a in PRINTED_ALIASES], n=1, cutoff=0.86)
    if close:
        target = close[0]
        for printed, canonical in PRINTED_ALIASES.items():
            if squash(printed) == target:
                return canonical, "fuzzy match"
        for n in names:
            if squash(n) == target:
                return n, "fuzzy match"

    for printed, canonical in aliases:
        if printed in BAR_WORDS and hit(printed):
            return canonical, f"team card, printed as {printed!r}"
    return None, ""


def resolve_key(name: str | None, colour: str, roles: list[dict]) -> tuple[str | None, str]:
    if not name:
        return None, "unnamed"
    cands = [r for r in roles if r["name"].lower() == name.lower()]
    if not cands:
        return None, f"no engine role named {name!r}"
    if len(cands) == 1:
        return cands[0]["key"], ""
    for r in cands:
        if r["cardColor"] == colour:
            return r["key"], ""
    return None, f"candidates {[c['key'] for c in cands]} but the bar printed {colour}"


OCR_SCRIPT = r"""
import glob,json,sys
from rapidocr_onnxruntime import RapidOCR
e=RapidOCR()
items=[]
for png in sorted(glob.glob(sys.argv[1]+'/ocrcell_*.png')):
    res,_=e(png)
    for box,text,score in (res or []):
        ys=[p[1] for p in box]; xs=[p[0] for p in box]
        items.append({"y":min(ys),"h":max(ys)-min(ys),"x":min(xs),"t":text})
items.sort(key=lambda i:(i["y"],i["x"]))
print(json.dumps(items))
"""


class Ocr:
    """OCR for the image-only sheets, run through whatever interpreter has rapidocr."""

    CACHE = "/tmp/tr_ocr_cache.json"

    def __init__(self, python: str | None):
        self.python = python
        self.dir = os.path.join(WORK, "ocr")
        self.cache: dict[str, str] = {}
        self.raw: dict[str, str] = {}
        self.ok = False
        if os.path.exists(self.CACHE):
            try:
                self.cache = json.load(open(self.CACHE))
            except Exception:  # noqa: BLE001
                self.cache = {}
        if not python:
            return
        os.makedirs(self.dir, exist_ok=True)
        script = os.path.join(WORK, "ocr_run.py")
        open(script, "w").write(OCR_SCRIPT)
        probe = sh([python, "-c", "import rapidocr_onnxruntime"])
        self.ok = probe.returncode == 0
        if not self.ok:
            print(f"!! {python} has no rapidocr — the image-only sheets cannot be named")

    def text(self, key: tuple[str, int], region: Image.Image) -> str:
        """OCR the card's title block and keep its largest line — the role name."""
        ck = f"{key[0]}:{key[1]}"
        if ck in self.cache:
            return self.cache[ck]
        if not self.ok:
            return ""
        for old in os.listdir(self.dir):
            os.remove(os.path.join(self.dir, old))
        small = region.convert("RGB")
        if small.width > 700:
            small = small.resize((700, round(small.height * 700 / small.width)), LANCZOS)
        small = small.resize((small.width * 2, small.height * 2), LANCZOS)
        small.save(os.path.join(self.dir, "ocrcell_000.png"))
        r = sh([self.python or "python3", os.path.join(WORK, "ocr_run.py"), self.dir])
        items: list[dict] = []
        if r.stdout.strip():
            try:
                items = json.loads(r.stdout.strip().splitlines()[-1])
            except Exception as exc:  # noqa: BLE001
                print(f"!! OCR output unreadable for {key}: {exc} {r.stderr[-160:]}")
        self.raw[ck] = " ".join(i["t"] for i in items)
        out = self._largest_line(items) if items else ""
        self.cache[ck] = out
        json.dump(self.cache, open(self.CACHE, "w"))
        return out

    @staticmethod
    def _largest_line(items: list[dict]) -> str:
        """Group the boxes into lines and return the tallest one: on these cards
        "YOU ARE THE" is smaller than the role name, and the power line smaller still."""
        lines: list[list[dict]] = []
        for item in sorted(items, key=lambda i: i["y"]):
            for line in lines:
                if abs(line[0]["y"] - item["y"]) <= max(8, line[0]["h"] * 0.6):
                    line.append(item)
                    break
            else:
                lines.append([item])
        best = max(lines, key=lambda l: max(i["h"] for i in l))
        return " ".join(i["t"] for i in sorted(best, key=lambda i: i["x"]))


# ------------------------------------------------------------------- build ---


@dataclass
class Card:
    sheet: str
    index: int
    image: Image.Image
    bar: Image.Image
    printed_colour: str
    text: str = ""
    role_name: str | None = None
    how: str = ""
    key: str | None = None
    note: str = ""


def title_words(box_px: tuple[float, float, float, float], words: list[Word]) -> list[tuple[float, float, str, float]]:
    """The words in the card's title block, in reading order, in title-upright space.

    The cell is rotated 90° anticlockwise: a word at (x, y) inside the cell lands
    at (y, cell_width - x).
    """
    x0, y0, x1, y1 = box_px
    w, h = x1 - x0, y1 - y0
    tx0, ty0, tx1, ty1 = TITLE_BOX
    inside = []
    for word in words:
        if not (x0 <= word.x <= x1 and y0 <= word.y <= y1):
            continue
        rx, ry = word.y - y0, w - (word.x - x0)
        if tx0 * h <= rx <= tx1 * h and ty0 * w <= ry <= ty1 * w:
            inside.append((ry, rx, word.text, word.size))
    inside.sort()
    return inside


def name_line(words: list[tuple[float, float, str, float]]) -> str:
    """The role name is the largest type in the title block: "YOU ARE THE" is
    smaller than the name, and the power line under it is smaller still."""
    if not words:
        return ""
    biggest = max(w[3] for w in words)
    if biggest <= 0:
        return ""
    line = [w for w in words if w[3] >= biggest * 0.85]
    return " ".join(w[2] for w in line)


def title_region(img: Image.Image) -> Image.Image:
    """The card rotated so its title reads across, cropped to the title block."""
    rot = img.rotate(90, expand=True)  # the title is printed down the card's side
    tx0, ty0, tx1, ty1 = TITLE_BOX
    return rot.crop((int(tx0 * rot.width), int(ty0 * rot.height), int(tx1 * rot.width), int(ty1 * rot.height)))


def build(dpi: int, ocr: Ocr) -> tuple[list[Card], list[str], list[dict]]:
    roles = catalogue()
    print(f"role catalogue: {len(roles)} keys")
    cards: list[Card] = []
    problems: list[str] = []
    for name, pdf in sheets().items():
        if name not in CHARACTER_SHEETS:
            continue
        page = Image.open(render(pdf, name, dpi)).convert("RGB")
        _, _, words = pdf_words(pdf)
        for i, box in enumerate(grid_cells(page)):
            if box is None:
                continue  # blank slot on the sheet
            img = page.crop(box)
            bar_h, colour = cut_bar(np.asarray(img).astype(int))
            if bar_h == 0:
                problems.append(f"{name} cell {i}: no team bar found")
            bar = img.crop((0, img.height - bar_h, img.width, img.height)) if bar_h else img
            c = Card(sheet=name, index=i, image=img, bar=bar, printed_colour=colour)
            if words:
                # the word boxes are in PDF points, the cells are in pixels
                box_pt: tuple[float, float, float, float] = tuple(v * 72.0 / dpi for v in box)  # type: ignore[assignment]
                c.text = name_line(title_words(box_pt, words))
            if len(squash(c.text)) < 3:
                c.text = ocr.text((name, i), title_region(img))
            c.role_name, c.how = match_name(c.text, roles)
            c.key, c.note = resolve_key(c.role_name, colour, roles)
            cards.append(c)
    return cards, problems, roles


def write_assets(cards: list[Card], book: dict[str, str], dpi: int, roles_src: list[dict]) -> dict:
    os.makedirs(CARDS_OUT, exist_ok=True)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    os.makedirs(os.path.dirname(CONTACT), exist_ok=True)
    by_key: dict[str, Card] = {}
    dupes: list[str] = []
    for c in cards:
        if not c.key:
            continue
        if c.key in by_key:
            dupes.append(f"{c.key} also printed on {c.sheet} cell {c.index}")
            continue
        by_key[c.key] = c

    def save(im: Image.Image, dest: str, width: int = 620) -> str:
        out = im.resize((width, round(im.height * width / im.width)), LANCZOS)
        out.save(dest, "WEBP", quality=82, method=6)
        return "/" + os.path.relpath(dest, os.path.join(ROOT, "client", "public"))

    manifest_cards = {}
    for key, c in sorted(by_key.items()):
        manifest_cards[key] = {
            "face": save(c.image, os.path.join(CARDS_OUT, f"{key}.webp")),
            "bar": save(c.bar, os.path.join(CARDS_OUT, f"{key}_bar.webp")),
            "printedName": c.role_name,
            "printedColour": c.printed_colour,
            "sheet": c.sheet,
            "cell": c.index,
        }

    # One bar per printed colour, for colour shares. A colour share says "my card
    # is red", not which card it is — but a Spy card is printed in the opposite
    # team's colour, so the bar must come from a card printed in that colour.
    preferred = {"blue": ["blue_team", "spy_red"], "red": ["red_team", "spy_blue"],
                 "grey": ["gambler", "agoraphobe"], "green": ["zombie"]}
    bars: dict[str, str] = {}
    for colour, keys in preferred.items():
        for k in keys:
            if k in by_key:
                bars[colour] = save(by_key[k].bar, os.path.join(CARDS_OUT, f"bar_{colour}.webp"))
                break
        else:
            for k, c in by_key.items():
                if c.printed_colour == colour:
                    bars[colour] = save(c.bar, os.path.join(CARDS_OUT, f"bar_{colour}.webp"))
                    break

    back_page = Image.open(render(book[CARD_BACKS], CARD_BACKS, dpi)).convert("RGB")
    back_box = next(b for b in grid_cells(back_page) if b is not None)
    back = save(back_page.crop(back_box), os.path.join(CARDS_OUT, "card_back.webp"))

    def one_card(pdf: str, tag: str) -> Image.Image:
        page = Image.open(render(pdf, tag, dpi)).convert("RGB")
        mask = ink_mask(page)
        xb = bands(mask.sum(axis=0), mask.shape[0] * 0.05, 40)
        yb = bands(mask.sum(axis=1), mask.shape[1] * 0.05, 40)
        return page.crop((xb[0][0], yb[0][0], xb[0][1], yb[-1][1]))

    leader = save(one_card(book[LEADER_FRONT], LEADER_FRONT), os.path.join(CARDS_OUT, "leader.webp"))
    leader_back = save(
        one_card(book[LEADER_BACK], LEADER_BACK), os.path.join(CARDS_OUT, "leader_back.webp")
    )

    manifest = {
        "note": (
            "Card art cut from the publisher's print-and-play sheets in printable_files/ by "
            "tools/assets/extract_cards.py. Nothing here came off the internet, and nothing is "
            "served from outside this app. The repo stays private because those sheets are "
            "Tuesday Knight Games' print-and-play files, not ours."
        ),
        "source": "printable_files/*.pdf",
        "engineRoles": len(roles_src),
        "back": back,
        "leader": {"face": leader, "back": leader_back},
        "bars": bars,
        "cards": manifest_cards,
        "duplicatesIgnored": dupes,
    }
    with open(MANIFEST, "w") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")
    return manifest


def contact_sheet(cards: list[Card], path: str) -> None:
    named = sorted((c for c in cards if c.key), key=lambda c: c.key or "")
    tw, th, cols = 205, 303, 8
    rows = (len(named) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + 28)), "white")
    d = ImageDraw.Draw(sheet)
    for i, c in enumerate(named):
        x, y = (i % cols) * tw, (i // cols) * (th + 28)
        sheet.paste(c.image.resize((tw - 8, th - 8), LANCZOS), (x + 4, y + 4))
        d.text((x + 4, y + th - 2), f"{c.key}", fill="black")
        d.text((x + 4, y + th + 11), f"{c.printed_colour} {c.sheet}", fill=(120, 120, 120))
    sheet.save(path)
    print(f"contact sheet: {path} ({len(named)} cards, {rows} rows)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--ocr-python", default=os.environ.get("OCR_PYTHON", "/tmp/ocrvenv/bin/python"))
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if os.path.isdir(WORK):
        shutil.rmtree(WORK)
    book = sheets()
    cards, problems, roles = build(args.dpi, Ocr(args.ocr_python))
    manifest = write_assets(cards, book, args.dpi, roles)
    contact_sheet(cards, CONTACT)

    print(f"\nnamed {len(manifest['cards'])} cards, {len(problems)} geometry problems")
    interesting = [(c.key or c.sheet, c.printed_colour, c.how) for c in cards if c.key and c.how != "catalogue"]
    if interesting:
        print("  (named by something other than an exact catalogue name:)")
        for key, colour, how in interesting:
            print(f"    {key:22s} {colour:6s} {how}")
    for c in cards:
        if not c.key:
            print(f"  UNNAMED {c.sheet} cell {c.index}: {c.note} :: {normalise(c.text)[:80]!r}")
    for p in problems:
        print(f"  PROBLEM {p}")

    if args.check:
        roles = {r["key"] for r in catalogue()}
        missing, extra = sorted(roles - set(manifest["cards"])), sorted(set(manifest["cards"]) - roles)
        if missing or extra:
            print(f"\nFAIL: engine roles without art: {missing}\n      art without an engine role: {extra}")
            return 1
        print("\nOK: every engine role has card art, and every card has an engine role")
    return 0


if __name__ == "__main__":
    sys.exit(main())
