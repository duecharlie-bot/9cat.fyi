# NineCat

Fantasy basketball draft intelligence for 9-category leagues.

NineCat helps you make draft decisions based on projected player value, roster construction, category strength, punt strategy, and expected player availability.


---

## Contents

- [Quick start](#quick-start)
- [The interface](#the-interface)
- [How the engine works](#how-the-engine-works)
- [The controls](#the-controls)
- [Punting](#punting)
- [Loading data](#loading-data)
- [Player photos](#player-photos)
- [Watching other teams](#watching-other-teams)
- [Saving and resuming](#saving-and-resuming)
- [Deploying it](#deploying-it)
- [Design decisions](#design-decisions)
- [Known limitations](#known-limitations)
- [Data and licensing](#data-and-licensing)

---

## Quick start

1. Open `index.html` in a browser.
2. Click **Setup**. Set your league size, your draft slot, and roster spots.
3. Click **Projections** and paste a projection table (see
   [Loading data](#loading-data)). Last season's actuals are already embedded.
4. Draft. Click a player to inspect him, click again to confirm.

Log every pick, not just your own — most of the interesting features
(scarcity, opponent ledgers, head-to-head) depend on the board knowing who's
already gone.

---

## The interface

**Top bar** — pick number, round, who's on the clock, and how many picks until
your next turn. At the snake turn it reads *Back-to-back*, because you pick
twice in a row and nothing can be taken in between.

**Left panel** — the board. Sortable by Fit, Rk, ADP, Val, or any of the nine
categories. Click a column header; click again to reverse.

| Column | What it is |
|---|---|
| **Fit** | The engine's verdict. Value, adjusted for your roster and for who'll still be there next turn. |
| **Rk** | Your projection source's own ranking. Can disagree with Val if the source weights categories differently. |
| **ADP** | Average draft position — where the market takes him, regardless of the projections. |
| **Val** | Sum of z-scores across all nine categories. Total production, before any roster adjustment. |

**Right panel** — the recommendation, the category ledger, the punt radar, your
roster, and the pick log.

### Keyboard

| Key | Action |
|---|---|
| `/` | Focus search |
| `Enter` | Select the top search result; press again to draft |
| `Esc` | Clear selection |
| `Cmd/Ctrl + Z` | Undo last pick |

### Selecting versus drafting

Clicking a row **selects** — it doesn't draft. The panel switches to that
player, the ledger shows what he'd do to every category, and a *click again to
draft* pill appears on the row. Click a second time (or hit the Draft button)
to commit. Double-click drafts directly if you prefer.

This exists so you can browse. It also means a stray click can't cost you a
pick.

---

## How the engine works

### Z-scores

Every stat is converted to a z-score — how many standard deviations above or
below the player pool. That makes categories comparable: 2.1 steals a game and
28 points a game mean nothing side by side until you know steals are scarce and
points aren't.

Turnovers are inverted, so a positive z always means good.

### Percentages are volume-weighted

The one thing most tools get wrong. A player shooting .600 on 3 attempts is not
equivalent to one shooting .480 on 20. FG% impact is computed as:

```
FGA × (player FG% − league FG%)
```

so a high-volume shooter moves your team rate far more than a low-volume one at
the same percentage. Combining a roster works the same way: total makes over
total attempts, never the average of the rates.

**This is why the importer needs makes and attempts, not just a percentage.**
A bare `.573` can't tell you whether that came on 20 shots or 4.

### Games played

`Games Played Weight` blends between two questions:

- **Per game** — how good is he when he plays?
- **Full season** — how much does he produce over a season?

At *Balanced* the two are mixed. Slide right if durability matters to you;
slide left if you'll stream around injuries. It's greyed out if your data has
no GP column.

### Leverage

Weights per category, derived from where your team currently stands. The
intuition: a category you've already locked up is worth little at the margin,
and so is one you've clearly lost. Weight concentrates where your next pick can
actually flip the outcome.

Controlled by **Punt Aggression** (0–10, default 5). Higher writes off a losing
category sooner. Note the curve is steep only at the top — at 5 the automatic
weighting stays fairly light, and the **Value → Category Fit** slider is the
bigger lever.

### Scarcity

A player certain to last until your next turn is worth less *now* than an equal
player who won't be — you can have him either way. Computed from ADP versus
picks remaining, and shown as a red dot on players likely to be gone.

The dot only appears on the top 15 of a Fit-sorted board. A "gone soon" warning
on someone ranked 40th is true but useless — it isn't a decision you face.

### Par

Several features measure against **par**: the expected standing of a rival team,
computed from the top `teams × roster spots` players by value.

This matters more than it sounds. Z-scores are measured against the whole player
pool, but only the best ~156 players get rostered. Turnovers correlate with
value — every good player commits them — so *every* team finishes underwater in
TO relative to the pool. Measured against zero, turnovers look like a punt for
everybody. Measured against par, they only look like a punt if you're genuinely
worse at them than your opponents are.

---

## The controls

**Games Played Weight** — per-game production versus full-season totals.

**Value → Category Fit** — 0% ranks purely on projected value (a plain
best-player-available list). 100% lets category fit fully override value. The
`50%` button resets to a balanced middle. Hover the row for a live explanation
of what it's currently doing, including which categories it's leaning on.

Early in a draft, keep this low. Category standings off two or three players are
mostly noise, and the tooltip will warn you when you're weighting them heavily
on a thin roster.

**Display mode** — Z-scores, Projected per game, or Last season per game.

Switching to *Last season per game* also recomputes **Fit** from what the player
actually did last year — same weights, same leverage, same scarcity, only the
production changes. It answers "what if the projection is wrong and he just
repeats himself?" The category ledger deliberately stays on projections, because
it describes the roster you're actually building.

**Category Weights** (in Setup) — match your league's scoring. `1` counts
normally, `0` isn't scored at all. There's an 8-cat preset that drops turnovers.
This is a *league setting*, distinct from punting.

---

## Punting

Conceding a category to concentrate elsewhere. Two ways in:

**Punt Radar** suggests candidates once you have a few players. It only flags a
category when best-available drafting leaves you well behind par *and* clawing
back would cost more than it's worth. Each suggestion shows how far behind
you'd finish and what chasing it would cost. Nothing applies until you click.

**Set by hand** — every category is a chip you can click through four states:

| State | Weight on that category | Meaning |
|---|---|---|
| Auto | ~1.00 | Leverage decides |
| Punt ✕ | 0.00 | Conceded, counts for nothing |
| Chase ▲ | ~1.50 | Contest it deliberately |
| Hard chase ▲▲ | ~2.57 | Win it outright |

Manual locks apply at full strength immediately — they bypass the aggression
setting and the ramp, because a deliberate decision shouldn't wait.

Every change shows what it did to the board (biggest risers and fallers) with an
**Undo**. Punt four or more and you get a warning: you need to win five of nine.

---

## Loading data

Click **Projections** and paste a table. Column headers are read automatically,
so paste whatever the site gives you.

### What parses

- Tab, comma, pipe, or multi-space separated
- Repeated header rows every N lines
- Doubled names (`NikolaJokicN.Jokic`)
- Team and position glued onto names (`NikolaJokicDEN C`)
- Combined cells: `0.573 (10.5/18.3)` and `9.5/19.0`
- Traded players with multiple rows — deduped, keeping the highest-GP row
- Accented names (`Jokić`, `Dončić`, `Şengün`, `Porziņģis`)

Recognised headers include `R#`/`RK`/`RANK`, `PLAYER`, `ADP`, `POS`, `TEAM`,
`GP`/`G`, `FG%`/`FGM`/`FGA`, `FT%`/`FTM`/`FTA`, `3PM`/`3P`, `PTS`, `REB`/`TREB`/`TRB`,
`AST`, `STL`, `BLK`, `TO`/`TOV`.

### Grabbing a whole table

Set the page to show all players, open the console (F12), and use the snippet in
the import dialog. It copies the biggest table on the page as tab-separated
text. On lazy-loading pages, scroll to the bottom first — it only sees rendered
rows.

Chrome blocks console pasting until you type `allow pasting` once.

### Sources

| Source | Free? | Notes |
|---|---|---|
| Hashtag Basketball | Top 30 free, full is paid | Set Show → All, Based On → Averages |
| ESPN | Yes | Full depth; scroll to the bottom before scraping |
| Basketball Reference | Yes | Per-game → Share & Export → Get table as CSV |
| BoxScore Lab | Yes, CC BY 4.0 | Already embedded as last season's actuals |

### Name matching

Last season's data is matched to your projections in two passes: exact folded
full name first, then surname plus first initial — but only when that key is
unambiguous on both sides, so a Keon/Kevin Johnson collision can't produce a
wrong match.

Accent folding uses NFD decomposition plus a manual map for letters that don't
decompose (`đ ø ł ß æ œ ı ð þ ħ ŋ`). The search box folds too, so typing
`jokic` finds `Jokić`.

---

## Player photos

Fetched automatically on first run from a public player index and cached in your
browser. Nothing to configure.

If it fails — offline, blocked, endpoint moved — you get initials monograms
instead and the board works exactly the same. There's a manual fallback in the
import dialog: run a snippet on `nba.com/players` and paste name/ID pairs.

The heading reports status honestly: *not set up*, *fetching…*, *24 of 30
players matched*, or *automatic fetch failed*.

Photos are cosmetic. Nothing depends on them.

---

## Watching other teams

The dropdown above the category ledger switches to any team in the league. The
roster panel follows, retitling itself (*Steve's Roster*).

Viewing an opponent gives you a **head-to-head**: a scoreline like `5–4` and a
chip per category showing the margin, green for the ones you'd take. The point
it makes explicit — category leagues count categories, not margins. Winning one
by 0.1 counts the same as winning it by 10, so a narrow deficit is worth
attacking and a huge lead is wasted surplus.

Each ledger row also shows your rank in that category among drafted teams.

**This only works if you log opponents' picks.** If you only log your own, every
other team shows empty.

---

## Saving and resuming

Everything is saved to browser storage automatically: picks, punt locks, league
setup, theme, imported projections, photo IDs. Refresh mid-draft and it resumes
where you left off.

Saved picks reference positions in the player pool, so restoring a draft onto a
*different* projection set would silently rename everyone on your roster. The
save carries a pool signature and refuses to restore picks when the data doesn't
match — your settings still carry over.

**Reset** clears picks and locks but keeps your loaded projections.

Storage keys, if you ever need to clear them by hand:

```
draftboard.v1               draft state
draftboard.projections.v1   imported projections
draftboard.photos.v2        player photo ids
```

---

## Deploying it

It's one static file. No backend, no build, no database.

**Netlify Drop** — drag `index.html` onto `app.netlify.com/drop`. Live in
seconds.

**GitHub Pages** — new repo, upload `index.html`, Settings → Pages → deploy from
`main` / root.

**Cloudflare Pages**, **Vercel** — same idea.

The file must be named `index.html` so the bare URL serves it.

⚠️ **Before publishing, check what data is embedded.** Paid projections are not
yours to redistribute. Ship a build whose default data is either free-tier or
openly licensed, and let visitors import their own.

---

## Design decisions

Things that look like bugs but aren't, and things that were.

**Positional need doesn't affect any score.** It used to, and a positional bonus
put a 36th-ranked centre above a 6th-ranked guard while sweeping six centres to
the top of the board. Positional need is a constraint you satisfy late with a
replacement-level body, not a reason to pass on a better player in round four.
It's reported in the **Roster check** notice and scored nowhere.

**Roster slots are assigned by matching, not draft order.** Filling the *n*th
slot with the *n*th player drafted will park an SF/PF at centre and tell you the
roster is legal. It's a bipartite matching, so if a legal arrangement exists it
gets found, and anyone genuinely unplaceable is flagged in red.

**Near-zero z-scores are grey, not red.** A z of −0.03 is noise. Colouring it
red made league-average FG% read as a liability.

**Per-game numbers are coloured by per-game impact.** Each dataset carries two
scorings: durability-weighted for ranking, pure per-game for display colour.
Otherwise a player who averaged 10.8 rebounds in five games shows a strong
number tinted red.

**Totals and z-scores answer different questions.** In totals a star looks like
a monster — production up almost everywhere. In z-scores the same pick can make
six of nine categories *worse*, because he dilutes your per-player rate. Totals
ask "what does my team produce"; z-scores ask "is this the best use of a roster
spot."

**Rk and Val can disagree.** The source's ranking reflects that source's
category weights. If an export was built with turnovers discounted, a
turnover-prone guard will rank far higher there than his true 9-cat value.

---

## Known limitations

- **Single user.** Browser storage is per-device. No shared league sync — two
  people on the same URL have entirely separate drafts.
- **Opponent tracking is manual.** Nothing watches your real draft room. No
  Yahoo/ESPN/Sleeper live sync (a Yahoo stub is documented in the source but
  deliberately not wired — it needs OAuth, a proxy, and an approval process).
- **Keepers aren't supported.** Pre-assign them by logging picks manually.
- **Projections are only as good as the source.** The engine can't see a role
  change or a minutes assumption the market disagrees with. When a player's ADP
  and projected rank diverge sharply, be suspicious of the projection.
- **No auction support.** Snake drafts only.

---

## Data and licensing

Last season's actuals are from [BoxScore Lab](https://boxscorelab.com/downloads/),
published under CC BY 4.0.

Projection sources belong to their publishers. If you subscribe to a paid
projection set, keep it out of any build you publish.

The code is yours to do whatever you like with.
