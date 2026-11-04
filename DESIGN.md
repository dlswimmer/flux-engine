# Flux Engine — design & roadmap

Working title. A tiered-generator incremental with many prestige layers, challenges and
skill trees. Same genre and mechanics as the classics, with its own theme, names, numbers
and content.

## Running it

```
npm install
npm run dev             # http://localhost:5173  (add ?dev, also on github.io, for game speed and test tools: reset Shards or Rift progress, or jump to a milestone save (your save is backed up; "Restore my save" undoes it))
npm run sim             # strategy sweep: which first-run route is fastest? (flags exploits)
npm run sim -- trace    # every reset in one full-route first run
npm run playtest        # feel (longest waits), Shard upgrade values, clicking cadence
npm run playtest -- automation   # autobuyers vs holding M, Collapse 5–35
npm run sim -- run 30   # 30 Collapses, best route per run, buying Shard upgrades
npm run sim -- run 30 idle   # same, never venting Heat
npm run report                  # whole-game playthroughs per player style (milestone times) + every upgrade's worth
npm run report -- devsaves      # regenerate the dev "Jump to milestone" saves (src/dev/milestoneSaves.ts) after balance changes
npm run sim -- rift 15 order target=3 lattices=3   # play to Breach (cached in .sim-cache/), then 15 Rifts on the Order
                                       # branch, Rifting once a Rift gives 3 Essence (or: entropy, asap, push)
npm run build
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`). `node scripts/make-icons.cjs` regenerates the app icons.

Hotkeys: **R** Rift · **M** max all · **B** buy mode (1 / until ×2) · **T** max Tempo · **O** Overdrive · **L** Lattice · **V** vent Heat · **C** Collapse

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
| Shard sink after Breach         | **Overcharge**             | 1     |
| Second prestige                 | **Rift** → **Essence**, skill tree with an **Order / Entropy** branch | 2 |
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
- **Past the Horizon (after Breach)** Flux income is scaled by (Horizon / Flux)^0.5. Without it the Horizon cap had been hiding a runaway loop (Tempo bought with Flux multiplies Flux): a run hit e2,150 in a minute, worth 20 billion Shards. Now runs settle around e280-e310: Collapsing at the Horizon (~23s) gives 2 Shards, pushing to ~30s gives ~9 (the best Shards/min), and it flattens after (~12 at 5 min). Shards have no sink past Breach yet; the Rift layer is meant to be it.
- Upgrade values from `npm run playtest -- upgrades` (time saved alone at Collapse 1 / leave-one-out at Collapse 15): Momentum 56% / 24%, Kindling 45 / 24, Echo 22 / 40, Gearing 22 / 34, Cascade 21 / 25, Resonance 19 / 16, Tuning 13 / 22, Ignition 11 / 13, Exchanger — / 7, Thermostat, Foreman: QoL. Every upgrade should stay above ~5%; none should dwarf the rest.
- **Automation is a progression.** Autobuyers (Automators, 1 Shard) buy max for every Engine and Tempo, starting every 3s and 10% faster each Collapse (floor: one tick, 0.05s). *Overclock* (3) makes them 3× faster; *Foreman* (4) adds Overdrive/Lattice autobuyers. All settings live on the **Automation tab** (`ui/automationTab.ts`): one card per autobuyer, each with an on/off switch and room for extra settings (the auto-vent threshold today; bulk amounts and auto-Collapse conditions later). The tab also shows the current and next interval. When an Engine or Tempo is automated, its row on the Engines tab drops its buttons and shows an "auto" badge. Against a player holding M: 2.9× slower at Collapse 5–10, 1.8× at 20, 1.04× by 35. They start as an idle helper and end up matching active play, so late runs are about decisions, not holding a key.
- Reset autobuyers stop at a per-Collapse limit (defaults: 10 Overdrives, 1 Lattice; blank = no limit). They also **pause at the Horizon** (a visible switch, on by default): after Breach runs reach the Horizon in ~2s, and resets after that restart the run from 10 Flux. With the pause off, Shard income at Overcharge 15 fell from ~650/min to ~230/min and the first Rift came 26 min later. Shown on the cards as "paused: you can Collapse", because a silent pause looked broken. Sim, fully automated: an unlimited Lattice autobuyer without Latticeworks makes Collapse 23 runs ~70% slower (43s vs 25s), since every Lattice wipes the Overdrives; with Latticeworks the Lattice count barely matters (20-23s). ~10 Overdrives beats unlimited (24s vs 28s).
- *Momentum* is capped at ×3 (uncapped it was ×6 on a slow run, 62% alone). *Resonance* is "Overdrives ×2.25 instead of ×2" (the old unspent-Shards version was worth 0% because Shards get spent). *Latticeworks* keeps up to 4 Overdrives through a Lattice, so Engines V–VIII stay unlocked but the extra ×2s still reset. Without it, Lattice is skipped once runs are under ~2 min. With it, Lattice routes are 15–25% faster than skipping (Collapse 15–30), in line with other upgrades. Keeping every Overdrive tested about the same but removed the visible cost.
- **Next:** Collapse **Trials** (challenges whose rewards include autobuyer upgrades), autobuyer intervals/bulk, auto-Collapse, and a Shard-powered second generator family. Trials can use Heat rules (no venting, Heat never decays, …).

### The twist: Heat + branching prestige
**Heat (built, unlocks at Collapse 3).**
- Heat rises toward 100% while Engines run. It fills faster the more tiers are active. It **carries over between Collapses** and only a Rift clears it: after Breach the best runs last ~2s, and with a per-Collapse reset Heat never built at all.
- **After Breach, a Surge also multiplies Shard gain by √(Surge)** (Backdraft's bonus too). The Collapse pays the **best** Shard gain reached this run, so a Surge locks its bonus in (a Surge ending used to drop "Collapse for 9 Shards" to 5). Engine multipliers barely move Shards past the Horizon (a ×2 is ~×1.06), so without this Heat, Thermostat and Heat Exchanger were worth 0% of Shard income after Breach; now Thermostat is ~32% and Exchanger ~13%.
- Above 60%, Flux output drops gently, down to ×0.8 at 100%. This only hits Engine I, so idle play stays fully viable.
- **Vent** (V) resets Heat and starts a **Surge**: all Engines ×(1 + 3·(Heat/100)²) for 15 seconds, so ×1.75 at 50%, ×2.7 at 75%, ×4 at 100%.
- You can't vent during a Surge. Earlier tuning let tiny vents chain into a permanent boost, which made mashing V optimal. The quadratic curve keeps small vents weak for the same reason.
- **No Heat builds during a Surge** (the vent is still open). Heat then refills fast (time constant 8s with all tiers running, 0→75% in about 11s), so the cycle is roughly a 15s Surge plus 11s of heating. In the sim, venting at 75% is best, 50% and 90% are within 2%, and 30% is clearly worse (mashing doesn't pay). A steeper (cubic) Surge curve made every timing worse.
- Upgrades: *Heat Exchanger* (Surge lasts 50% longer) and *Thermostat* (auto-vent at a % you choose, default 70%).
- Sim result: active runs are about 20% faster than idle (Collapse 6: 3m08s vs 3m56s; 15 Collapses in 1h09m vs 1h15m). That's worth pressing V, and idle is still fine. More push-your-luck depth belongs in the Entropy branch.

**Branching prestige (built, Rift tree).** Each branch takes a stance on Heat:
- **Order** (idle): *Even Keel* caps Heat at 60% (never throttles, never Surges) and gives ×2 Shards; *Long Burn* gives Shards ×(1 + Rift minutes ÷ 10), up to ×3; *Self-Winding* doubles autobuyer speed and Shards. (Even Keel was "Engines ×2" and Long Burn "Momentum cap ×10": both were worth ×1.00-1.03 Shard income after Breach.)
- **Entropy** (active): *Flashpoint* Surges peak at ×8; *Backdraft* turns Heat into a bonus (up to ×4, following the draining bar during a Surge) instead of a throttle; *Chain Reaction* doubles Surge length, Heat build speed and Shards.
- Buying the first node of one branch locks the other. "Respec at next Rift" refunds every node.
- Node value (`npm run report -- rift`, Shards/min, 5-minute test): Order ×1.37 / ×1.26 (grows to ×3 in long Rifts) / ×2.00; Entropy ×1.28 / ×1.44 / ×2.52. Entropy wins short Rifts, Order catches up in long ones.

### 2 · Rift (built: v1)
- **Overcharge** (after Breach): repeatable, all Engines ×10 per level, cost 5 × 1.25^level Shards. Reset by a Rift. (At ×2 a level was worth ~2.6 orders of magnitude of depth vs ~30 for a Lattice.)
- **Rift**: needs **Overcharge 20**. Gives **Essence** = 2^((Overcharge − 20) / 4): 1 at 20, doubling every 4 levels. Resets Shards, Overcharge, Shard upgrades (except milestone keeps) and **this Rift's Collapse count**, so Echo and the autobuyer ramp start over. Lifetime Collapses (Heat unlock, stats) stay. Target: the first Collapse after Rift 1 takes about half as long as the very first one; it was 8s when the Rift kept the count, the core upgrades and full-speed autobuyers.
- *Why Overcharge, not Flux depth:* v1 gated on peak Flux ≥ e350. Depth past the Horizon reacts violently to every multiplier: one extra Lattice was ~30 orders of magnitude, so the gate was either a wall (Lattice limit 1: never opened in 6h) or trivial (unlimited: 40s after Breach). Overcharge is bought with Shards, which still come from depth, so everything feeds in smoothly.
- **Tempo past the Horizon** costs ×4096 per level instead of ×8. A Tempo level boosts all 8 tiers, so at ~1.35/level (6 Lattices) it out-grew its ×8 price and paid for itself forever: Flux hit e(2.6 trillion) in a minute and Essence went "infinite". Lattice requirements are also quadratic now (40 + 20L + 10L² Engine VIII), so a run tops out around 3.
- **Milestones** (staged, so each Rift replays faster than the last): 1 Rift keeps automation (Automators, Foreman, Self-Collapse, Overclock, Thermostat); 2 keeps Kindling/Momentum/Echo/Ignition/Tuning/Gearing; 3 keeps Cascade/Exchanger/Resonance/Latticeworks; 4 keeps Prism/Breach.
- **Tree**: Rift Lens (1, all Engines ×(total Essence + 1)^0.5), Head Start (2, start each Collapse with 2 Overdrives), Shard Focus (3, Shards ×2), then a branch at 5 / 10 / 20. 41 Essence for everything.
- **Self-Collapse** (Shard upgrade, 6, needs Foreman) unlocks auto-Collapse ("when it gives at least N Shards"). Before it existed, the sim needed ~280 manual Collapses before the first Rift.
- **Milestones** (`npm run report -- milestones`, fresh save, Rifting at 4 Essence):

  | Player | Collapse 1 | Automators | Breach | Rift 1 | 1st Collapse after Rift 1 | Rift 2 | Rift 5 |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Active (acts every 1s, vents at 75%) | 21m | 43m | 1h17m | 1h29m | 3m50s | 2h00m | 2h30m |
  | Active, no manual venting | 21m | 43m | 1h28m | 1h39m | 3m50s | 2h10m | 2h40m |
  | Casual (acts every 10s, auto-Collapse) | 40m | 1h50m | 2h57m | 3h31m | 4m40s | 4h26m | 5h21m |
  | Rift ASAP (1 Essence, Lens only) | | | 1h17m | 1h22m | 9m21s (43%) | 2h05m | 2h47m |
  | Rift at 8 Essence | | | 1h17m | 1h36m | 3m04s | 1h58m | 2h27m (tree done) |

  Buying Automators first (instead of cheapest-first) helps casual players ~10 min but costs active ones ~20 (early autobuyers are slower than a clicking player). Soft spot: casual players are 2× slower before Automators.
- **Pacing** (sim, earlier tuning run): Breach ~1h21m. Rifting at 1 / 2 / 4 / 8 Essence gives ~15 / 25 / 37 / 64 Essence per hour, first Rift 5 / 7 / 13 / 25 min after Breach; the 41-Essence tree takes ~1-1.5h. Lattice limit 1 vs 3 differs by ~10-20%. Order and Entropy finish 15 Rifts within ~1 minute of each other. (Rift Lens at ^2 made every Rift after the first take ~10s.)
- **Next**: Rift Trials stacking Collapse Trial rules; an Essence sink beyond the tree; the next layer (Ascension).

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
