import { on, type GameEvent } from "../core/events";
import { format } from "../core/format";
import { ENGINE_COUNT, state } from "../core/state";
import { HORIZON, canCollapse, isBreached, shardGain } from "../game/collapse";
import { engineRate, fluxPerSecond, isEngineUnlocked } from "../game/engines";
import { displayedHeat, isHeatUnlocked, isSurging } from "../game/heat";
import { riftOvercharge, canRift, essenceGain, isRiftUnlocked } from "../game/rift";
import { h, setClass, setText, setVisible, type View } from "./dom";

// The Engine Room: an ambient view of the machine, driven by the live game state.
// Eight rings (Engines I-VIII, inside out) spin with their output; particles flow inward ring
// to ring and into the core (Flux). Heat tints the scene; venting puffs steam, a Surge flares
// the core. Overdrive pulses, Lattice flashes a grid, Collapse implodes, Rift tears the screen.
// Near the Horizon the core becomes an event horizon. Later layers add their own visuals.

type RGB = [number, number, number];
const TEAL: RGB = [79, 209, 197];
const AMBER: RGB = [246, 173, 85];
const RED: RGB = [252, 110, 110];
const VIOLET: RGB = [183, 148, 244];
const STEAM: RGB = [220, 226, 236];

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
const rgba = (c: RGB, alpha: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Cool teal → amber → red as Heat rises. */
function heatColor(heat: number): RGB {
  return heat < 50 ? mix(TEAL, AMBER, heat / 50) : mix(AMBER, RED, (heat - 50) / 50);
}

/** 0..1 "how busy" an Engine is: output spans hundreds of orders of magnitude, so use its log. */
function activity(tier: number): number {
  if (!isEngineUnlocked(tier) || state.engines[tier].amount.lte(0)) return 0;
  const log = engineRate(tier).add(1).log10().toNumber();
  return 1 - Math.exp(-log / 40);
}

interface Particle {
  r: number;
  theta: number;
  /** Radius it dies at (the next ring in, or the core). Steam flies outward instead. */
  target: number;
  speed: number;
  spin: number;
  life: number;
  color: RGB;
  size: number;
  steam?: boolean;
}

interface Effect {
  kind: GameEvent;
  t: number;
  duration: number;
}

const MAX_PARTICLES = 450;
const DURATION: Record<GameEvent, number> = { overdrive: 0.9, lattice: 1.6, vent: 1.2, collapse: 1.6, rift: 2.4, trial: 2, riftTrial: 2.4 };

export function engineRoomTab(isActive: () => boolean): View & { leave(): void } {
  const canvas = h("canvas", { class: "room-canvas" });
  const ctx = canvas.getContext("2d")!;
  const fluxLine = h("div", { class: "room-flux" });
  const rateLine = h("div", { class: "room-rate" });
  const statusLine = h("div", { class: "room-status" });
  const overlay = h("div", { class: "room-overlay" }, fluxLine, rateLine, statusLine);

  const fullButton = h("button", { class: "secondary room-btn" });
  const wakeButton = h("button", { class: "secondary room-btn" });
  const hint = h("span", { class: "room-hint" }, "Tap the room to hide the numbers");
  const controls = h("div", { class: "room-controls" }, fullButton, wakeButton, hint);

  const stage = h("div", { class: "room-stage" }, canvas, overlay);
  const root = h("section", { class: "tab room-tab" }, stage, controls);

  // ---------- Controls ----------
  let overlayOn = true;
  stage.addEventListener("click", () => {
    overlayOn = !overlayOn;
    setVisible(overlay, overlayOn);
  });

  // Immersive mode: CSS covers the whole screen (works on iPhones, where pages can't use the
  // Fullscreen API), plus real fullscreen where the browser allows it.
  const setImmersive = (on: boolean) => {
    document.body.classList.toggle("room-immersive", on);
    if (on) stage.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  fullButton.addEventListener("click", (e) => {
    e.stopPropagation();
    setImmersive(!document.body.classList.contains("room-immersive"));
  });
  const exitButton = h("button", { class: "secondary room-exit" }, "Exit");
  exitButton.addEventListener("click", (e) => {
    e.stopPropagation();
    setImmersive(false);
  });
  stage.append(exitButton);
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) document.body.classList.remove("room-immersive");
  });

  // Keep the screen awake while the room is open (Screen Wake Lock, where supported).
  type Sentinel = { release(): Promise<void> };
  const wakeLock = (navigator as unknown as { wakeLock?: { request(type: "screen"): Promise<Sentinel> } }).wakeLock;
  let sentinel: Sentinel | null = null;
  let wantAwake = false;
  const acquire = async () => {
    if (!wakeLock || !wantAwake || sentinel || document.visibilityState !== "visible") return;
    try {
      sentinel = await wakeLock.request("screen");
      (sentinel as unknown as EventTarget).addEventListener?.("release", () => (sentinel = null));
    } catch {
      sentinel = null;
    }
  };
  const release = () => {
    sentinel?.release().catch(() => {});
    sentinel = null;
  };
  wakeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    wantAwake = !wantAwake;
    if (wantAwake) acquire();
    else release();
  });
  // The OS drops the lock when the page is hidden; take it back on return.
  document.addEventListener("visibilitychange", () => acquire());

  // ---------- Simulation of the picture ----------
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const particles: Particle[] = [];
  const effects: Effect[] = [];
  const phases = Array.from({ length: ENGINE_COUNT }, () => Math.random() * Math.PI * 2);
  const emitCarry = new Array(ENGINE_COUNT).fill(0);
  let last = performance.now();
  let width = 0;
  let height = 0;
  let coreFlare = 0;

  // Only play events you're actually watching.
  for (const kind of Object.keys(DURATION) as GameEvent[])
    on(kind, () => {
      if (!isActive() || document.visibilityState !== "visible") return;
      effects.push({ kind, t: 0, duration: DURATION[kind] });
      if (kind === "vent") spawnSteam();
      if (kind === "collapse") for (const p of particles) p.speed *= 3;
    });

  const geometry = () => {
    const cx = width / 2;
    const cy = height / 2;
    const outer = Math.min(width, height) * 0.46;
    const core = outer * 0.13;
    const ring = (tier: number) => core + ((tier + 1) / (ENGINE_COUNT + 0.5)) * (outer - core);
    return { cx, cy, outer, core, ring };
  };

  function spawnSteam() {
    const { ring } = geometry();
    for (let i = 0; i < 46 && particles.length < MAX_PARTICLES; i++) {
      const tier = Math.floor(Math.random() * ENGINE_COUNT);
      const r = ring(tier);
      particles.push({
        r,
        theta: Math.random() * Math.PI * 2,
        target: r + 60 + Math.random() * 80,
        speed: 40 + Math.random() * 60,
        spin: (Math.random() - 0.5) * 0.4,
        life: 1.2,
        color: STEAM,
        size: 3 + Math.random() * 5,
        steam: true,
      });
    }
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = stage.clientWidth;
    const hgt = stage.clientHeight;
    if (w === width && hgt === height) return;
    width = w;
    height = hgt;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hgt}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function step(dt: number) {
    const calm = reducedMotion.matches;
    const { core, ring } = geometry();
    const surge = isSurging() ? 1.8 : 1;

    // Ring rotation; alternate directions.
    for (let tier = 0; tier < ENGINE_COUNT; tier++) {
      const a = activity(tier);
      const speed = (0.08 + 0.9 * a) * surge * (calm ? 0.15 : 1) * (tier % 2 ? -1 : 1) * (1 - tier * 0.05);
      phases[tier] += speed * dt;
    }

    // Particles: each running Engine sends flow to the one inside it (Engine I to the core).
    if (!calm) {
      for (let tier = 0; tier < ENGINE_COUNT; tier++) {
        const a = activity(tier);
        if (a <= 0) continue;
        emitCarry[tier] += (1.5 + 14 * a) * surge * dt;
        while (emitCarry[tier] >= 1 && particles.length < MAX_PARTICLES) {
          emitCarry[tier]--;
          const r = ring(tier);
          const target = tier === 0 ? core * 0.6 : ring(tier - 1);
          particles.push({
            r,
            theta: phases[tier] + Math.random() * Math.PI * 2,
            target,
            speed: (r - target) / (0.9 + Math.random() * 0.6),
            spin: (tier % 2 ? -1 : 1) * (0.3 + Math.random() * 0.4),
            life: 3,
            color: heatColor(isHeatUnlocked() ? displayedHeat() : 0),
            size: 1.6 + a * 2.2,
          });
        }
        emitCarry[tier] = Math.min(emitCarry[tier], 3);
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.theta += p.spin * dt;
      if (p.steam) p.r += p.speed * dt;
      else p.r -= p.speed * surge * dt;
      const done = p.steam ? p.r >= p.target : p.r <= p.target;
      if (done || p.life <= 0) {
        if (!p.steam && p.target < core) coreFlare = Math.min(1, coreFlare + 0.04);
        particles.splice(i, 1);
      }
    }

    coreFlare = Math.max(0, coreFlare - dt * 0.8);
    for (let i = effects.length - 1; i >= 0; i--) {
      effects[i].t += dt;
      if (effects[i].t >= effects[i].duration) effects.splice(i, 1);
    }
  }

  function draw(time: number) {
    const { cx, cy, outer, core, ring } = geometry();
    const heat = isHeatUnlocked() ? displayedHeat() : 0;
    const tint = heatColor(heat);
    const collapsing = effects.find((e) => e.kind === "collapse");
    const rifting = effects.find((e) => e.kind === "rift");

    // Background: dark, warming with Heat; violet as the Rift nears.
    const riftNear = isRiftUnlocked() ? clamp01(state.collapse.overcharge / riftOvercharge()) : 0;
    const bgEdge = mix([10, 12, 17], [24, 14, 30], riftNear * 0.6);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.75);
    bg.addColorStop(0, rgba(mix(bgEdge, tint, 0.12), 1));
    bg.addColorStop(1, rgba(bgEdge, 1));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Collapse: everything dims while it implodes, then a white flash.
    const collapseK = collapsing ? collapsing.t / collapsing.duration : 0;
    const dim = collapsing ? 1 - Math.sin(Math.min(1, collapseK * 1.6) * Math.PI * 0.5) * 0.85 : 1;

    // Rings
    for (let tier = 0; tier < ENGINE_COUNT; tier++) {
      const r = ring(tier) * (collapsing ? 1 - 0.5 * Math.min(1, collapseK * 1.6) : 1);
      const unlocked = isEngineUnlocked(tier);
      const a = activity(tier);
      ctx.lineWidth = 1.5;
      ctx.setLineDash(unlocked ? [] : [3, 7]);
      ctx.strokeStyle = rgba(unlocked ? tint : [80, 88, 104], (unlocked ? 0.18 + 0.45 * a : 0.25) * dim);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!unlocked) continue;
      // Nodes riding the ring
      const nodes = 3 + tier;
      for (let k = 0; k < nodes; k++) {
        const ang = phases[tier] + (k / nodes) * Math.PI * 2;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        ctx.fillStyle = rgba(tint, (0.35 + 0.65 * a) * dim);
        ctx.beginPath();
        ctx.arc(x, y, 1.8 + 2.2 * a, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Particles
    for (const p of particles) {
      const x = cx + Math.cos(p.theta) * p.r;
      const y = cy + Math.sin(p.theta) * p.r;
      const alpha = p.steam ? clamp01(p.life / 1.2) * 0.35 : 0.75 * dim;
      ctx.fillStyle = rgba(p.color, alpha);
      ctx.beginPath();
      ctx.arc(x, y, p.steam ? p.size * (1.6 - p.life / 1.2) : p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Core: a glowing star of Flux that becomes an event horizon at the Horizon.
    const progress = clamp01(state.collapse.peakFlux.max(1).log10().toNumber() / HORIZON.log10().toNumber());
    const pulse = 1 + Math.sin(time / 600) * 0.04;
    const surge = isSurging() ? 1 : 0;
    const coreR = core * (0.55 + 0.45 * progress) * pulse * (1 + 0.35 * surge + 0.25 * coreFlare);
    const atHorizon = canCollapse();
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.2);
    const glowColor = atHorizon ? mix(AMBER, VIOLET, riftNear) : tint;
    glow.addColorStop(0, rgba(glowColor, (0.55 + 0.3 * surge) * dim));
    glow.addColorStop(1, rgba(glowColor, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 3.2, 0, Math.PI * 2);
    ctx.fill();
    if (atHorizon) {
      // Event horizon: a black disk inside a bright, turning accretion ring.
      ctx.fillStyle = "#030305";
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
      const segments = 24;
      for (let k = 0; k < segments; k++) {
        const ang = time / (isBreached() ? 700 : 1400) + (k / segments) * Math.PI * 2;
        ctx.strokeStyle = rgba(glowColor, (0.35 + 0.55 * ((k % 3) / 2)) * dim);
        ctx.lineWidth = isBreached() ? 3.5 : 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 1.12, ang, ang + (Math.PI * 2) / segments / 1.6);
        ctx.stroke();
      }
    } else {
      const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      body.addColorStop(0, rgba([255, 255, 255], 0.95 * dim));
      body.addColorStop(1, rgba(tint, 0.9 * dim));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Event effects
    for (const e of effects) {
      const k = e.t / e.duration;
      if (e.kind === "overdrive") {
        ctx.strokeStyle = rgba([255, 255, 255], (1 - k) * 0.7);
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(cx, cy, core + k * (outer * 1.1 - core), 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === "lattice") {
        // A triangular grid snaps over the room and fades.
        const alpha = Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * (1 - k) * 0.5;
        ctx.strokeStyle = rgba(TEAL, alpha);
        ctx.lineWidth = 1;
        const spacing = 34;
        const diag = Math.hypot(width, height);
        for (const angle of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
          const dx = Math.cos(angle);
          const dy = Math.sin(angle);
          for (let o = -diag; o <= diag; o += spacing) {
            const ox = cx - dy * o;
            const oy = cy + dx * o;
            ctx.beginPath();
            ctx.moveTo(ox - dx * diag, oy - dy * diag);
            ctx.lineTo(ox + dx * diag, oy + dy * diag);
            ctx.stroke();
          }
        }
      } else if (e.kind === "trial" || e.kind === "riftTrial") {
        // A Trial or Rift Trial won: three gold rings ripple out from the core.
        for (let i = 0; i < 3; i++) {
          const ki = k * 1.4 - i * 0.2;
          if (ki <= 0 || ki >= 1) continue;
          ctx.strokeStyle = rgba([255, 205, 90], (1 - ki) * 0.8);
          ctx.lineWidth = 2 + 2 * (1 - ki);
          ctx.beginPath();
          ctx.arc(cx, cy, core + ki * (outer * 1.2 - core), 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (e.kind === "collapse" && k > 0.55) {
        const flash = 1 - (k - 0.55) / 0.45;
        ctx.fillStyle = rgba([255, 255, 255], flash * 0.85);
        ctx.fillRect(0, 0, width, height);
      }
    }
    if (rifting) {
      // A jagged violet tear down the room, opening then sealing.
      const k = rifting.t / rifting.duration;
      const open = Math.sin(k * Math.PI);
      ctx.fillStyle = rgba(VIOLET, open * 0.25);
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = rgba([235, 220, 255], open);
      ctx.shadowColor = rgba(VIOLET, 1);
      ctx.shadowBlur = 30 * open;
      ctx.lineWidth = 2 + 10 * open;
      ctx.beginPath();
      const seed = Math.floor(rifting.duration * 1000);
      for (let i = 0; i <= 14; i++) {
        const y = (i / 14) * height;
        const jag = Math.sin(i * 12.9898 + seed) * 43758.5453;
        const x = cx + (jag - Math.floor(jag) - 0.5) * 90 * open;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function updateOverlay() {
    setText(fluxLine, `${format(state.flux, 2, 1)} Flux`);
    setText(rateLine, `+${format(fluxPerSecond(), 2, 1)} / sec`);
    const parts: string[] = [];
    if (isHeatUnlocked()) parts.push(isSurging() ? `Surging ×${state.heat.surgeMult.toFixed(2)}` : `Heat ${state.heat.amount.toFixed(0)}%`);
    if (canRift()) parts.push(`Rift open: ${format(essenceGain(), 2, 0)} Essence`);
    else if (canCollapse()) parts.push(`Horizon reached: ${format(shardGain(), 2, 0)} Shards`);
    setText(statusLine, parts.join(" · "));
  }

  return {
    root,
    /** Called every frame while another tab is showing: drop full screen and the wake lock. */
    leave() {
      if (document.body.classList.contains("room-immersive")) setImmersive(false);
      if (sentinel) release();
      last = performance.now();
    },
    update() {
      acquire();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      resize();
      if (width === 0 || height === 0) return;
      step(dt);
      draw(now);
      updateOverlay();
      const immersive = document.body.classList.contains("room-immersive");
      setText(fullButton, immersive ? "Exit full screen" : "Full screen");
      setVisible(wakeButton, !!wakeLock);
      setText(wakeButton, wantAwake ? "Keep screen on: on" : "Keep screen on: off");
      setClass(wakeButton, "active", wantAwake);
    },
  };
}
