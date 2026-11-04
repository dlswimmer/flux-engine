# Flux Engine — design & roadmap

Working title. A tiered-generator incremental with many prestige layers, challenges and
skill trees. Same genre and mechanics as the classics, with its own theme, names, numbers
and content.

## Running it

```
npm install
npm run dev             # http://localhost:5173  (add ?dev for the game-speed slider)
npm run sim             # strategy sweep: which first-run route is fastest? (flags exploits)
npm run sim -- trace    # every reset in one full-route first run
npm run playtest        # feel (longest waits), Shard upgrade values, clicking cadence
npm run playtest -- automation   # autobuyers vs holding M, Collapse 5–35
npm run sim -- run 30   # 30 Collapses, best route per run, buying Shard upgrades
npm run sim -- run 30 idle   # same, never venting Heat
npm run build
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`). `node scripts/make-icons.cjs` regenerates the app icons.

Hotkeys: **M** max all · **B** buy mode (1 / until ×2) · **T** max Tempo · **O** Overdrive · **L** Lattice · **V** vent Heat · **C** Collapse

## Vocabulary

| Concept                         | Name here                  | Layer |
| ------------------------------- | -------------------------- | ----- |
| Main currency                   | **Flux**                   | 0     |
| Tiered generators (8)           | **Engines I–VIII**         | 0     |
| Global speed upgrade            | **Tempo**                  | 0     |
| Small reset: unlock tier / ×2   | **Overdrive**              | 0     |
| Bigger reset: stronger Tempo    | **Lattice**                | 0     |
| Soft cap / first prestige point | **the Horizon** (1e200)    | 1     |
| First prestige                  | **Collapse** → **Shards**  | 1     |
| Active twist                    | **Heat** → vent → **Surge**| 1+    |
| Second prestige                 | **Rift** → *TBD*, with an **Order / Entropy** branch | 2 |
| Third prestige                  | **Ascension** → *TBD*      | 3     |

## Layers

### 0 · Engines (built)
- Engine *n* produces Engine *n−1*; Engine I produces Flux.
- Each purchase raises that Engine's cost; every 10 purchases doubles its output. Cost per 10 rises from ×1.5e3 (Engine I) to ×1e15 (Engine VIII). This scaling is deliberately steep, so no single tier can snowball on its own.
- **Tempo** (×1.10 per level, cost ×8) multiplies every Engine. It's the main growth engine.
- **Overdrive** (all Engines ×2): the first four need 10 of your highest Engine and each unlock the next Engine. After that, 20 Engine VIII, then +10 each.
- **Lattice**: needs 40 (+20 each) Engine VIII. Adds +0.04 to each Tempo level. Resets Overdrives (*Latticeworks* keeps 4).
- Engines II–IV are cheap (30 / 400 / 1e4) so the opening, and every rebuild after a Lattice, moves fast: Engine II at ~20s, first Overdrive at ~2m15s.

### 1 · Collapse (built: core loop + 15 upgrades)
- Collapsing (and Shard gain) uses the **most Flux reached this Collapse**, not current Flux, so spending, autobuyers and Overdrive/Lattice resets can never take a Collapse away or shrink it. Once a Collapse is ready, auto Overdrive/Lattice pause.
- Flux stops at the Horizon (1e200). Collapsing gives 1 Shard (×2 with *Prism*, cost 3). *Breach* (12) lets Flux pass the Horizon and makes Shard gain scale with Flux.
- Upgrade values from `npm run playtest -- upgrades` (time saved alone at Collapse 1 / leave-one-out at Collapse 15): Momentum 56% / 24%, Kindling 45 / 24, Echo 22 / 40, Gearing 22 / 34, Cascade 21 / 25, Resonance 19 / 16, Tuning 13 / 22, Ignition 11 / 13, Exchanger — / 7, Thermostat, Foreman: QoL. Every upgrade should stay above ~5%; none should dwarf the rest.
- **Automation is a progression.** Autobuyers (Automators, 1 Shard) buy max for every Engine and Tempo, starting every 3s and 10% faster each Collapse (floor: one tick, 0.05s). *Overclock* (3) makes them 3× faster; *Foreman* (4) adds Overdrive/Lattice autobuyers. All settings live on the **Automation tab** (`ui/automationTab.ts`): one card per autobuyer, each with an on/off switch and room for extra settings (the auto-vent threshold today; bulk amounts and auto-Collapse conditions later). The tab also shows the current and next interval. When an Engine or Tempo is automated, its row on the Engines tab drops its buttons and shows an "auto" badge. Against a player holding M: 2.9× slower at Collapse 5–10, 1.8× at 20, 1.04× by 35. They start as an idle helper and end up matching active play, so late runs are about decisions, not holding a key.
- *Momentum* is capped at ×3 (uncapped it was ×6 on a slow run, 62% alone). *Resonance* is "Overdrives ×2.25 instead of ×2" (the old unspent-Shards version was worth 0% because Shards get spent). *Latticeworks* keeps up to 4 Overdrives through a Lattice, so Engines V–VIII stay unlocked but the extra ×2s still reset. Without it, Lattice is skipped once runs are under ~2 min. With it, Lattice routes are 15–25% faster than skipping (Collapse 15–30), in line with other upgrades. Keeping every Overdrive tested about the same but removed the visible cost.
- **Next:** Collapse **Trials** (challenges whose rewards include autobuyer upgrades), autobuyer intervals/bulk, auto-Collapse, and a Shard-powered second generator family. Trials can use Heat rules (no venting, Heat never decays, …).

### The twist: Heat + branching prestige
**Heat (built, unlocks at Collapse 3).**
- Heat rises toward 100% while Engines run. It fills faster the more tiers are active.
- Above 60%, Flux output drops gently, down to ×0.8 at 100%. This only hits Engine I, so idle play stays fully viable.
- **Vent** (V) resets Heat and starts a **Surge**: all Engines ×(1 + 3·(Heat/100)²) for 15 seconds, so ×1.75 at 50%, ×2.7 at 75%, ×4 at 100%.
- You can't vent during a Surge. Earlier tuning let tiny vents chain into a permanent boost, which made mashing V optimal. The quadratic curve keeps small vents weak for the same reason.
- **No Heat builds during a Surge** (the vent is still open). Heat then refills fast (time constant 8s with all tiers running, 0→75% in about 11s), so the cycle is roughly a 15s Surge plus 11s of heating. In the sim, venting at 75% is best, 50% and 90% are within 2%, and 30% is clearly worse (mashing doesn't pay). A steeper (cubic) Surge curve made every timing worse.
- Upgrades: *Heat Exchanger* (Surge lasts 50% longer) and *Thermostat* (auto-vent at a % you choose, default 70%).
- Sim result: active runs are about 20% faster than idle (Collapse 6: 3m08s vs 3m56s; 15 Collapses in 1h09m vs 1h15m). That's worth pressing V, and idle is still fine. More push-your-luck depth belongs in the Entropy branch.

**Branching prestige (planned, from Rift).** Each branch takes a stance on Heat:
- **Order**: a lower Heat ceiling and steady passive bonuses. Suits idle play.
- **Entropy**: bigger Surges, and Heat itself feeds bonuses. Suits active play.
- Respeccing costs a Rift reset. Later layers can add more forks.

### 2 · Rift (planned)
- Gated by Breach and a Flux target past the Horizon.
- **Skill tree** with the Order/Entropy split. Milestones that automate Collapse. Rift Trials that stack the Collapse Trial rules.

### 3 · Ascension and beyond (planned)
- Each new layer follows the same shape: a currency, an upgrade set, its own Trials, a QoL milestone track, and one new *mechanic*, not just bigger numbers.

## Mobile
Phones are a first-class target (≤640px):
- **Layout:** the header is sticky and compact, so Flux and the Horizon bar stay visible. Tabs move to a bottom bar for thumb reach. Engine rows are two short lines.
- **Action bar** (Engines tab): Max All, Vent, Overdrive and Lattice, standing in for the hotkeys. Slots never shift, so a button can't move out from under a held thumb.
- **Press-and-hold** repeats Max All and every buy button (`holdToRepeat` in `ui/dom.ts`), the touch version of holding M. Scrolling cancels it.
- **Touch details:** keyboard hints like "(M)" are hidden on touch screens (`keyHint`). Buttons are at least 42–48px tall, don't double-tap zoom, and long-press doesn't open a menu. Inputs are 16px so iOS doesn't zoom in on focus.
- **Saving:** the game saves on `visibilitychange`/`pagehide`, because mobile browsers often skip `beforeunload`. Time spent in the background is caught up when you return.
- **Installable:** it has a web manifest, a theme color and icons, so "Add to Home Screen" opens it full-screen with its own icon.

## Architecture

```
src/
  lib/decimal.ts      break_eternity.js. All big numbers go through here.
  core/state.ts       GameState type + defaults. One plain object, the whole save.
  core/save.ts        localStorage, export/import (base64), versioned migrations, merge-with-defaults
  core/loop.ts        50ms fixed tick, offline/background catch-up (≤1000 steps)
  core/format.ts      number/time formatting (1.23e45 → e1.23e45 → F5.00)
  game/*.ts           pure game logic, no DOM. Runs headless in scripts/sim.ts
    engines, tempo, overdrive, lattice   layer 0
    collapse                             layer 1 + its UpgradeSet
    heat                                 the Heat / Surge twist
    upgrades.ts                          generic one-time upgrade sets (requires, unlocked)
    reset.ts                             cascading resets, one function per layer
    automation.ts, tick.ts
  ui/*.ts             build-once DOM views with per-frame update()
scripts/sim.ts        pacing simulator / strategy sweep
```

**Adding a layer:**
1. Add its state block to `GameState` and `defaultState()`.
2. Write `game/<layer>.ts`: gain formula, `can/do` functions, and an `UpgradeSet`.
3. Add `resetFor<Layer>()` to `reset.ts`, calling the reset of the layer below.
4. Add a tab in `ui/app.ts` (`upgradeCard` from `collapseTab.ts` is reusable).
5. Add its routes to `scripts/sim.ts` and run the sweep.

**Save rules:** new fields need no migration, because loading merges the save over fresh defaults. Renames and reshapes need a `SAVE_VERSION` bump plus an entry in `MIGRATIONS`.

## Balance

**Rule 1: sweep, don't guess.** A greedy bot only finds the route you expected. `npm run sim` races every "stop at N Overdrives / M Lattices" route and warns if a route with fewer Engines, or without Lattices, wins. A playtest found exactly that exploit (4–5 Engines and no resets beat the full route), so run the sweep after every number change.

**Rule 2: keep cost scaling steep.** If log(×2 milestone) / log(cost per 10) gets large, a single tier snowballs and resets become traps.

**Rule 3: all-Engine multipliers compress runs about N-fold.** `BASE_RATE` in `engines.ts` is the global pacing dial for exactly that reason.

**Rule 4: attention is a multiplier.** Runs are short and reset-heavy, so how often the player acts matters a lot (see cadence below). Automation is balanced against *holding M*, not against clicking once a second.

**Current numbers** (bot pressing Max All once a second):
- Fastest first run: **21m52s**, using 8 Engines, ≤8 Overdrives and 1 Lattice.
- Fewer Engines never reach the Horizon (3h cap). No Lattice takes 1h+.
- Campaign: Collapse 5 at ~48m, runs ~1 min by Collapse 20, Breach at Collapse 35 (~1h30m).
- Cadence (`npm run playtest -- cadence`), Collapse 10 / 20: holding M 1m6s / 28s, Max All every 1s 2m27s / 1m3s, autobuyers only 3m8s / 1m28s. Holding M beats the 1s autobuyers 2–3×, so automation needs a progression that eventually catches up.
- Known soft spots: Lattice is skipped from ~Collapse 11 until Latticeworks; a ~1 min/run plateau from Collapse 20 to Breach (auto-Collapse and Trials should fill it); a 2nd Lattice in the first run is ~30% slower than stopping at 1.
