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
npm run report -- profiles      # whole game in real time for 12 player types (hardcore … casual check-ins … AFK), offline catch-up included
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
- **Bulk claims:** one press (or autobuyer action, up to its Stop-at limit) claims every Overdrive past the unlock phase and every Lattice your Engine VIII covers, with one reset. Whole game ~9% faster (Rift 5: 3h52m → 3h32m for the 1s bot), nothing changes before Automators.
- **Fixed by Overload (sim, 2026-11-10):** with Overload won, Stop-at OD 4 and OD 10 tie (43s / 43s per Collapse after Rift 2, 20s / 20s after Rift 4), and right after Rift 1 OD 10 is faster (13m vs 20m without Overload), so the default stays 10. The old note: **Watch (sim, after Rift 2 and Rift 4, everything automated, no Trials):** Overdrives past the 4th cost more time than their ×2 gives back. Each one resets a run that is ~8s from rebuilt, while ×2 saves a fraction of a second once Flux grows that fast. First Collapse after Rift 2: Stop-at OD 4 / Lattice 1 = 1m29s, OD 10 / Lattice 1 = 2m27s, OD 10 / Lattice 3 = 3m25s. If Overdrives past the 4th did not reset, more would always be better (59s after Rift 2, 46s after Rift 4).
- **Auto-reset wait** (Automation → Resets, default 0): auto Overdrive/Lattice wait N seconds into a run so one reset claims several (the first 4 Overdrives never wait; a Lattice that is only waiting holds Overdrives back). Sim, average per Collapse, fully automated:

  | Save | Setting | 0s | 10s | 20s |
  | --- | --- | --- | --- | --- |
  | Foreman | OD 10 / Lat 1 | 34s | 39s | 48s |
  | Rift 2 | OD 10 / Lat 1 | 2m07s | 1m42s | 1m24s |
  | Rift 2 | OD ∞ / Lat 3 | 3m29s | 1m47s | 1m32s |
  | Rift 4 | OD ∞ / Lat 3 | 2m10s | 1m05s | 53s |

  No single default fits (short runs lose time, long ones gain), so it is a setting. OD 4 / Lat 1 is still the best plain setting late (1m17s / 47s): the real fix is Trial rewards that make Overdrive and Lattice reset nothing.
- Engines II–IV are cheap (30 / 400 / 1e4) so the opening, and every rebuild after a Lattice, moves fast: Engine II at ~20s, first Overdrive at ~2m15s.

### 1 · Collapse (built: core loop + 15 upgrades)
- Collapsing (and Shard gain) uses the **most Flux reached this Collapse**, not current Flux, so spending, autobuyers and Overdrive/Lattice resets can never take a Collapse away or shrink it. Once a Collapse is ready, auto Overdrive/Lattice pause.
- Flux stops at the Horizon (1e200). Collapsing gives 1 Shard (×2 with *Prism*, cost 3). *Breach* (12) lets Flux pass the Horizon and makes Shard gain scale with Flux.
- **Past the Horizon (after Breach)** Flux income is scaled by (Horizon / Flux)^0.5. Without it the Horizon cap had been hiding a runaway loop (Tempo bought with Flux multiplies Flux): a run hit e2,150 in a minute, worth 20 billion Shards. Now runs settle around e280-e310: Collapsing at the Horizon (~23s) gives 2 Shards, pushing to ~30s gives ~9 (the best Shards/min), and it flattens after (~12 at 5 min). Shards have no sink past Breach yet; the Rift layer is meant to be it.
- Upgrade values from `npm run playtest -- upgrades` (time saved alone at Collapse 1 / leave-one-out at Collapse 15): Momentum 56% / 24%, Kindling 45 / 24, Echo 22 / 40, Gearing 22 / 34, Cascade 21 / 25, Resonance 19 / 16, Tuning 13 / 22, Ignition 11 / 13, Exchanger — / 7, Thermostat, Foreman: QoL. Every upgrade should stay above ~5%; none should dwarf the rest.
- **Automation is a progression.** Autobuyers (Automators, 1 Shard) buy max for every Engine and Tempo, starting every 3s and 10% faster each Collapse (floor: one tick, 0.05s). *Overclock* (3) makes them 3× faster; *Foreman* (4) adds Overdrive/Lattice autobuyers. All settings live on the **Automation tab** (`ui/automationTab.ts`): one card per autobuyer, each with an on/off switch and room for extra settings (the auto-vent threshold today; bulk amounts and auto-Collapse conditions later). The tab also shows the current and next interval. When an Engine or Tempo is automated, its row on the Engines tab drops its buttons and shows an "auto" badge. Against a player holding M: 2.9× slower at Collapse 5–10, 1.8× at 20, 1.04× by 35. They start as an idle helper and end up matching active play, so late runs are about decisions, not holding a key.
- Reset autobuyers stop at a per-Collapse limit (defaults: 10 Overdrives, 1 Lattice; blank = no limit). They also **pause at the Horizon** (a visible switch, on by default): after Breach runs reach the Horizon in ~2s, and resets after that restart the run from 10 Flux. With the pause off, Shard income at Overcharge 15 fell from ~650/min to ~230/min and the first Rift came 26 min later. Shown on the cards as "paused: you can Collapse", because a silent pause looked broken. Sim, fully automated: an unlimited Lattice autobuyer without Latticeworks makes Collapse 23 runs ~70% slower (43s vs 25s), since every Lattice wipes the Overdrives; with Latticeworks the Lattice count barely matters (20-23s). ~10 Overdrives beats unlimited (24s vs 28s).
- *Momentum* is capped at ×3 (uncapped it was ×6 on a slow run, 62% alone). *Resonance* is "Overdrives ×2.25 instead of ×2" (the old unspent-Shards version was worth 0% because Shards get spent). *Latticeworks* keeps up to 4 Overdrives through a Lattice, so Engines V–VIII stay unlocked but the extra ×2s still reset. Without it, Lattice is skipped once runs are under ~2 min. With it, Lattice routes are 15–25% faster than skipping (Collapse 15–30), in line with other upgrades. Keeping every Overdrive tested about the same but removed the visible cost.
- **Collapse Trials** (built: `game/trials.ts`, tuned with `npm run report -- trials`): open at 15 lifetime Collapses. Start one (Collapses first if you can, else restarts the run), reach the Horizon under its rule, Collapse to win. Wins are permanent, kept through Rifts, and none is needed for the Rift. A Rift ends an active Trial.
  - **A Trial is a raw Collapse:** Shard upgrades and Overcharge are off during one, except automation (Automators, Foreman, Self-Collapse, Overclock, Thermostat). Rift nodes and earlier Trial rewards still work, which is what makes the later ones possible. Like AD's challenges, each takes much longer than a normal run at that point. (v1 kept every upgrade, and Trials took ~1 min, Overload faster than a normal run.)
  - Escalating, in this order (1s bot, each with the earlier ones won):

  | Trial | Rule | Reward | Time (1s bot) |
  | --- | --- | --- | --- |
  | Rigid Frame | at most 1 Lattice (0 was impossible even after Rift 3) | Lattices keep all Overdrives | ~10 min |
  | Overload | at most 6 Overdrives | Overdrives 5-10 reset nothing | ~12 min |
  | Cold Running | Heat 3× faster, no venting, overheating slows every Engine to ×0.6 | Surges 50% longer | ~17 min |
  | Fixed Tempo | Tempo stops at 170 (150 never; 185 ~7 min) | Tempo ×7/level instead of ×8 (×4096 past the Horizon unchanged) | ~15 min (43 min before Foreman) |
  | Sprint | Horizon within 3 min or the run restarts (raw runs take ~5 min before Rift 2) | autobuyers start each Rift as if 10 Collapses in | out of reach until after Rift 2, then 3-6 min |
  | Hollow Core (needs Rigid + Overload) | Overdrives ×1.15 instead of ×2 | first 3 Lattices each Collapse reset nothing | ~33 min before Rift 2, ~18 min after |

  - *Hollow Core retune (2026-11-10):* at Overdrives ×1 it took ~40 min after Rift 2 (43m / 39m after Rifts 2 / 3) and the 20-min-give-up bot never won it. Its Tempo cap of 300 never bound (same times with no cap), so it was dropped. Overdrives ×1.1 / 1.15 / 1.2 take 24 / 18 / 14 min after Rift 2; ×1.2 was won after Rift 1, before Sprint's tier, so ×1.15.
  - *Even Keel vs Trials:* Even Keel (Order) never Surges, and Surges carry Sprint and Hollow Core: after Rift 4 (with Even Keel) Sprint goes from ~2½ min to over 90, Hollow Core roughly doubles. A Respec at the next Rift fixes it; worth a hint in the UI, or letting Trials ignore Even Keel.
  - *Why capped rewards:* unlimited free Overdrives/Lattices blew up depth past the Horizon (Rift 3 to Rift 5 in 2½ min). Free claims now cover what a well-played run reaches anyway (OD 10, Lattice 3): they remove the reset time, not the ceiling. Free claims skip Stop-at, the wait and the Horizon pause.
  - Whole game with raw-Collapse Trials (`GIVEUP=20 npm run report -- trials game`: the bot starts each Trial as it opens, gives up after 20 min and retries after the next Rift): Rigid Frame 1h15m, Overload 1h24m, Cold Running 1h43m, Fixed Tempo 3h24m (failed before Rift 1), Sprint 3h27m, Hollow Core 4h31m (just after Rift 2). Breach 1h15m → 2h48m, Rift 1 1h48m → 3h14m, Rift 2 2h44m → 4h13m, Rift 5 3h32m → 4h44m (5h43m when Hollow Core was ×1 and never won), much of it failed attempts a player would skip.
  - v1 (Trials with every upgrade on), baseline vs + Trials: Rift 1 1h47m / 1h50m; 1st Collapse after Rift 1 **7m05s / 2m37s**; Rift 5 3h32m / 2h20m. Not Sprint (without its reward: 3m00s): it is free Overdrives/Lattices removing the staircase, which hits hardest right after a Rift. Breaks the "half the very first Collapse" target, on purpose (decided 2026-11-05): the Trials themselves are the cost, so earning them buys the faster Rifts. The half-time target applies to a player without the Trials.
  - Fixed along the way: auto-Collapse tracked Shards/sec with the whole-number gain, whose plateaus (3, 3, 3...) read as the rate falling and Collapsed at 0.65s for 3 Shards; it uses the unrounded gain now.
- **Next:** Rift Trials stacking Collapse Trial rules, and a Shard-powered second generator family.

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
- **Overcharge** (after Breach): repeatable, all Engines ×10 per level, cost 5 × 1.35^level Shards (at ×1.25 income kept pace with cost and Overcharge 20 came 3 minutes after Breach). Reset by a Rift. (At ×2 a level was worth ~2.6 orders of magnitude of depth vs ~30 for a Lattice.)
- **Rift**: needs **Overcharge 24**. Gives **Essence** = 2^((Overcharge − 24) / 2): 1 at 24, doubling every 2 levels. (At 20, a player holding Max All opened it ~5 min after Breach; it is ~10 min now, ~19 min for the 1s bot.) Resets Shards, Overcharge, Shard upgrades (except milestone keeps) and **this Rift's Collapse count**, so Echo and the autobuyer ramp start over. Lifetime Collapses (Heat unlock, stats) stay. Target: the first Collapse after Rift 1 takes about half as long as the very first one; it was 8s when the Rift kept the count, the core upgrades and full-speed autobuyers.
- *Why Overcharge, not Flux depth:* v1 gated on peak Flux ≥ e350. Depth past the Horizon reacts violently to every multiplier: one extra Lattice was ~30 orders of magnitude, so the gate was either a wall (Lattice limit 1: never opened in 6h) or trivial (unlimited: 40s after Breach). Overcharge is bought with Shards, which still come from depth, so everything feeds in smoothly.
- **Tempo past the Horizon** costs ×4096 per level instead of ×8. A Tempo level boosts all 8 tiers, so at ~1.35/level (6 Lattices) it out-grew its ×8 price and paid for itself forever: Flux hit e(2.6 trillion) in a minute and Essence went "infinite". Lattice requirements are also quadratic now (40 + 20L + 10L² Engine VIII), so a run tops out around 3.
- **Milestones** (staged, so each Rift replays faster than the last): 1 Rift keeps automation (Automators, Foreman, Self-Collapse, Overclock, Thermostat); 2 keeps Kindling/Momentum/Echo/Ignition/Tuning/Gearing; 3 keeps Cascade/Exchanger/Resonance/Latticeworks; 4 keeps Prism/Breach.
- **Tree**: Rift Lens (1, all Engines ×(total Essence + 1)^0.25), Head Start (2, +1 Overdrive at the start of every Collapse, stacking with Ignition), Shard Focus (3, Shards ×2), then a branch at 5 / 10 / 20. 41 Essence for everything.
- **Self-Collapse** (Shard upgrade, 6, needs Foreman) unlocks auto-Collapse: blank = when this run's Shards/min peaks (checked every tick), or "when it gives at least N Shards". The old blank ("as soon as you reach the Horizon") earned 2-4× less after Breach. Reaction speed matters ~2.5× after Breach (runs last ~2s), so the report bot uses this smart auto-Collapse once it owns Self-Collapse. Before it existed, the sim needed ~280 manual Collapses before the first Rift.
- **Milestones** (`npm run report -- milestones`, fresh save, Rifting at 4 Essence):

  | Player | Collapse 1 | Automators | Breach | Rift 1 | 1st Collapse after Rift 1 | Rift 2 | Rift 5 |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Active, Rift at 4 Essence (Lens + Head Start) | 21m | 43m | 1h17m | 1h42m | 7m05s (33%) | 2h35m | 3h23m |
  | Rift ASAP (1 Essence, Lens only) | | | 1h17m | 1h30m | 11m04s (51%) | 2h25m | 3h33m |
  | Rift at 8 Essence | | | 1h17m | 2h02m | 9m05s | 2h38m | 3h14m (tree done 3h06m) |

  A player holding Max All runs ~15% faster than this 1s-cadence bot (3m20s vs 3m50s for the same Collapse in an earlier build).

  Buying Automators first (instead of cheapest-first) helps casual players ~10 min but costs active ones ~20 (early autobuyers are slower than a clicking player). Soft spot: casual players are 2× slower before Automators.
- **Pacing** (sim, earlier tuning run): Breach ~1h21m. Rifting at 1 / 2 / 4 / 8 Essence gives ~15 / 25 / 37 / 64 Essence per hour, first Rift 5 / 7 / 13 / 25 min after Breach; the 41-Essence tree takes ~1-1.5h. Lattice limit 1 vs 3 differs by ~10-20%. Order and Entropy finish 15 Rifts within ~1 minute of each other. (Rift Lens at ^2 made every Rift after the first take ~10s.)
- **Player profiles** (`npm run report -- profiles`, 2026-11-10, main after the Hollow Core retune). Real time, offline time included; "played" = time with the game open and acted on. Session players play at the 1s cadence, then their time away runs through the game's own catch-up (closed = one catch-up of at most 1000 steps on return; tab left open = caught up once a minute).

  | Player | Collapse 1 | Automators | Breach | Rift 1 | Rift 2 | Rift 5 | Played |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Hardcore (acts every 0.2s) | 20m | 36m | 58m | 1h30m | 2h19m | 3h00m | all |
  | Hardcore + Trials | 20m | 36m | 3h32m | 3h41m | 3h56m | 4h09m | all |
  | Active 1s, Order (Entropy within 2 min) | 22m | 43m | 1h15m | 1h48m | 2h44m | 3h32m | all |
  | Active 1s + Trials | 22m | 43m | 3h49m | 3h59m | 4h15m | 4h28m | all |
  | Relaxed (every 10s, never vents) | 40m | 1h50m | 2h52m | 3h25m | 4h27m | 5h23m | all |
  | Tab open, acts every 5 min | 8h | 26h | 38h | 39h | 41h | 42h | all |
  | Casual: 5 min every 30 min, closes the app | 2h | 4h | 7h | 9h30m | 12h30m | 16h | 2h40m |
  | Casual, same but tab left open | 2h | 4h | 7h | 7h30m | 9h | 11h | 1h50m |
  | Commuter: 15 min every 4h | 4h | 8h | 16h | 24h | 36h | 44h | 2h57m |
  | AFK: 2 min every 2h | 18h | 38h | 3d4h | 3d18h | 4d10h | 5d6h | 2h07m |
  | AFK, buying automation first | 18h | 18h | 4d4h | 4d20h | 5d12h | 6d8h | 2h33m |

  - Trials (45 min give-up) cost ~1h of the whole game but make Rifts fast: Rift 1 → Rift 5 is 30 min with them, 1h44m without. Won at (1s / 0.2s): Rigid Frame 1h16m / 1h00m, Overload 1h25m / 1h08m, Cold Running 1h44m / 1h27m, Fixed Tempo 2h26m / 2h09m, Hollow Core 3h46m / 3h28m, Sprint 4h02m / 3h43m (after Rift 1).
  - **Watch: closing the app costs ~⅓ of progress after Breach.** Same casual player, Rift 5 at 16h with the app closed vs 11h with the tab left open. A catch-up is at most 1000 steps, so 25 min away = 1.5s steps, while a post-Breach run lasts ~2s. Before Breach the two are identical.
  - Session players get the most per minute played (Rift 5 in 2-3h of play vs 3h32m for the 1s bot). Acting every 5 min with the tab open is the worst way to play before Automators (8h to the first Collapse): the opening needs frequent buying.
  - Buying automation first doesn't help even an AFK player (Breach a day later): saving 11 Shards for Foreman + Self-Collapse delays the power upgrades.
- **Watch (playtest, 2026-11-04):** an active player could finish their second Rift in ~17 min (the 1s sim bot takes ~1h; a bot acting every 0.2s took 49 min Rift 1 → Rift 2, 58 with Trials, on 2026-11-10, so the sims don't reproduce it). It may feel fast only because there is nothing after the Rift tree yet. Revisit when the next layer or an Essence sink lands: if Rifts still feel rushed, raise the Overcharge requirement or slow Overcharge cost growth (×1.35 now).
- **Next**: Rift Trials stacking Collapse Trial rules; an Essence sink beyond the tree; the next layer (Ascension).

### 3 · Ascension and beyond (planned)
- Each new layer follows the same shape: a currency, an upgrade set, its own Trials, a QoL milestone track, and one new *mechanic*, not just bigger numbers.

## Engine Room (ambient view)
A tab that draws the machine from the live game state, as a screensaver/idle view (`ui/engineRoom.ts`):
- **Rings** = Engines I-VIII (inside out), spinning with each Engine's output (log scale); locked Engines are dashed. **Particles** flow inward ring to ring and into the **core** (Flux), which grows toward the Horizon and becomes a black **event horizon** with a turning accretion ring once you can Collapse (faster after Breach).
- **Heat** tints the whole scene teal → amber → red; the background turns violet as Overcharge nears the Rift.
- **Events** come from `core/events.ts` (`emit`/`on`; game logic only emits, so sims are unaffected): Overdrive = pulse ring, Lattice = triangular grid flash, Vent = steam, Collapse = implosion + flash, Rift = violet tear. Only played while you're watching.
- Tap to hide the numbers; Full screen (CSS immersive mode, so it works on iPhones too, plus the Fullscreen API where allowed); Keep screen on (Screen Wake Lock, re-taken after the page is hidden). Respects reduced motion (no particles, slow rotation). Only animates while its tab is showing.
- **Each new layer should add its own visual** here (e.g. Ascension).

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
