/**
 * Targeted interaction-lever sweep, round 4 — drawrace-8d3baef5.
 *
 * Round-3 constraint discovered: preset overrides bind per surface TYPE
 * across the whole track, so a zone gets exclusive coefficients only via a
 * type no other zone uses. Round 4 probes the exclusive-type levers:
 *   A: rock exists only in A — rock.plow (k=4) taxes r35 12x less than r65.
 *   B: steepen bTop until the ice climb is traction-limited, where the
 *      interlock grip multiplier (gears only) must decide the winner.
 *   D: torqueExponent may unstick the gears that DNF at water magnitude >1.
 *
 * Run: npx tsx packages/engine-core/scripts/sweep-interactions.ts [stage]
 */
import { runConfig, intervalTicks, DECLARED, type Config } from "./calibrate-hills01.js";

const Z = ["A", "B", "C", "D"];

function compact(cfg: Config): { pass: boolean; line: string } {
  const singles = runConfig(cfg);
  const rows = singles.map((s) => ({
    ...s,
    zoneTicks: intervalTicks(s.xs, [8, 18, 28], s.finishTicks),
  }));
  const allFinish = singles.every((s) => s.finished);
  const parts: string[] = [];
  let pass = allFinish;
  for (let i = 0; i < 4; i++) {
    const ranked = rows.filter((r) => r.finished).sort((a, b) => a.zoneTicks[i] - b.zoneTicks[i]);
    const win = ranked[0];
    const runner = ranked[1];
    if (!win) {
      pass = false;
      parts.push(`${Z[i]}=none(all DNF)`);
      continue;
    }
    const margin = runner ? ((runner.zoneTicks[i] - win.zoneTicks[i]) / win.zoneTicks[i]) * 100 : 0;
    const ok = win.name === DECLARED[Z[i]] && margin >= 5;
    if (!ok) pass = false;
    parts.push(`${Z[i]}=${win.name.slice(0, 12)}(+${margin.toFixed(1)}%)${ok ? "✓" : "✗"}`);
  }
  return { pass, line: `${allFinish ? "fin✓" : "DNF!"} ${parts.join(" ")}` };
}

function show(cfg: Config): void {
  const { pass, line } = compact(cfg);
  console.log(`${pass ? "PASS" : "fail"}  ${cfg.name.padEnd(26)} ${line}`);
}

// ── stage A4: rock exclusive to A + plow k4 — big wheels pay, r35 dashes ──
function stageA4(): void {
  for (const p of [2, 4, 8]) {
    show({
      name: `rockA-p${p}-k4`,
      terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
      surfaces: ["rock", "snow:snow", "snow", "water:normal"],
      phys: { plowExponent: 4, presets: { rock: { plow: p } } },
    });
  }
  show({
    name: "rockA-p4-k4-tq4",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["rock", "snow:snow", "snow", "water:normal"],
    phys: { plowExponent: 4, torqueExponent: 4, presets: { rock: { plow: 4 } } },
  });
}

// ── stage B4: steep ice climb — traction-limited so interlock decides ──
function stageB4(): void {
  for (const bTop of [5.0, 5.8]) {
    show({
      name: `steepIce-${bTop}-i5`,
      terrain: { aAmp: 0.15, bTop, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
      surfaces: ["normal", "ice", "snow", "water:normal"],
      phys: { presets: { ice: { interlock: 5, plow: 0.5 } } },
    });
  }
  show({
    name: "steepIce-6.5-i5",
    terrain: { aAmp: 0.15, bTop: 6.5, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "ice", "snow", "water:normal"],
    phys: { presets: { ice: { interlock: 5, plow: 0.5 } } },
  });
}

// ── stage D4: torque shaping unsticks gears so water magnitude can rise ──
function stageD4(): void {
  const ratio = (4 / 2) * Math.pow(0.478 / 0.5, 6);
  for (const m of [1.2, 1.6]) {
    show({
      name: `k4-m${m}-tq4`,
      terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
      surfaces: ["normal", "snow:snow", "snow", "water:normal"],
      phys: { plowExponent: 4, torqueExponent: 4, presets: { water: { sinkage: ratio * m, plow: m } } },
    });
  }
}

function main(): void {
  const stage = process.argv[2] ?? "all";
  if (stage === "all" || stage === "A") stageA4();
  if (stage === "all" || stage === "B") stageB4();
  if (stage === "all" || stage === "D") stageD4();
}

main();
