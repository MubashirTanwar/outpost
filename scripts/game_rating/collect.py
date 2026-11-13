"""Stream a Lichess monthly PGN dump; for every evaluated game write one row per side:
time_class, rating, acpl, moves  (same ACPL rules as web/src/lib/gameRating.ts, same book rule as review.ts).

    pip install zstandard
    python scripts/game_rating/collect.py \
        https://database.lichess.org/standard/lichess_db_standard_rated_2026-10.pgn.zst \
        games.csv web/src/data/openings.json 300000

Only about one game in ten carries engine evals, so 300k evaluated games means reading ~3M.
"""
import io, json, math, re, sys, time, urllib.request
import zstandard

URL, OUT, BOOK, LIMIT = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
book = set()
for line in json.load(open(BOOK)):
    mv = line["moves"].split()
    for i in range(1, len(mv) + 1):
        book.add(" ".join(mv[:i]))

CLAMP = 1000
MOVE = re.compile(r"(?:\d+\.(?:\.\.)?\s*)?([^\s{}]+)\s*\{[^}]*?\[%eval ([^\]\s]+)\][^}]*\}")

def white_cp(tok):
    if tok.startswith("#"):
        return CLAMP if not tok.startswith("#-") else -CLAMP
    return max(-CLAMP, min(CLAMP, round(float(tok) * 100)))

def win(cp):
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)

def sides(movetext):
    pairs = MOVE.findall(movetext)
    before, sans, in_book = 20, [], True
    tot = {"white": [0.0, 0], "black": [0.0, 0]}
    for ply, (san, ev) in enumerate(pairs):
        color = "white" if ply % 2 == 0 else "black"
        after = white_cp(ev)
        sign = 1 if color == "white" else -1
        sans.append(san.rstrip("!?"))
        loss_win = win(sign * before) - win(sign * after)
        is_book = " ".join(sans) in book
        in_book = in_book and (is_book or (ply < 12 and loss_win < 3))
        if not in_book:
            tot[color][0] += max(0, sign * (before - after))
            tot[color][1] += 1
        before = after
    return tot

req = urllib.request.Request(URL, headers={"User-Agent": "outpost-game-rating-fit"})
stream = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(urllib.request.urlopen(req)), encoding="utf-8", errors="replace")
out = open(OUT, "w")
headers, seen, kept, t0 = {}, 0, 0, time.time()
for line in stream:
    if line.startswith("["):
        k, _, v = line[1:].partition(" ")
        headers[k] = v.strip().rstrip("]").strip('"')
        continue
    if not line.strip() or not headers:
        continue
    seen += 1
    h, headers = headers, {}
    if "[%eval" not in line or "BOT" in (h.get("WhiteTitle", ""), h.get("BlackTitle", "")):
        continue
    ev = h.get("Event", "").split()
    if len(ev) < 2 or ev[0] != "Rated":
        continue
    tc = ev[1].lower()
    try:
        wr, br = int(h["WhiteElo"]), int(h["BlackElo"])
    except (KeyError, ValueError):
        continue
    tot = sides(line)
    for color, r in (("white", wr), ("black", br)):
        s, n = tot[color]
        if n:
            out.write(f"{tc},{r},{s / n:.1f},{n}\n")
    kept += 1
    if kept % 20000 == 0:
        out.flush()
        print(f"{kept} evaluated / {seen} games, {time.time() - t0:.0f}s", flush=True)
    if kept >= LIMIT:
        break
print(f"done: {kept} evaluated games of {seen}", flush=True)
