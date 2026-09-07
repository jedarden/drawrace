//! Validate seed ghost blobs with full re-simulation.
//!
//! The earlier `scripts/validate-track3-seeds*.rs` checked blob structure only
//! (the track-2 equivalent even carries a `TODO: Add actual re-simulation
//! validation here`). This binary closes that gap by driving the same layers
//! the production validator (`crates/validator/src/main.rs::validate_ghost`)
//! applies to a live submission, offline:
//!
//!   1. LOAD      — file readable, DRGH magic, header + wheel table parse.
//!   2. STRUCTURE — track_id, physics version, wheel vertex bounds, swap_tick
//!                  monotonicity + cooldown, final swap before finish,
//!                  monotonic checkpoint splits.
//!   3. RESIM     — full race re-simulated through the WASM engine
//!                  (`crate::resim::ResimEngine`) with the real track data
//!                  (`crate::track::TrackStore`).
//!   4. FINISH    — re-sim crosses the finish line (not stuck, not timed out)
//!                  within tolerance of the claimed finish tick.
//!
//! Usage (from the workspace root):
//!
//! ```bash
//! cargo run --bin validate-track3-seeds -- seeds/track_3/seed-000.blob
//! cargo run --bin validate-track3-seeds -- seeds/track_3
//! cargo run --bin validate-track3-seeds -- --track-id 2 seeds/track_2
//! cargo run --bin validate-track3-seeds -- --strict seeds/track_3
//! ```
//!
//! Pass/fail semantics: the default verdict covers the four checks above —
//! a blob PASSES when it loads, is structurally valid, and its race
//! re-simulates to a clean finish. Seed blobs carry *editorial* times (the
//! generator picks times for skill buckets; it does not derive them from the
//! sim), so a re-sim/claim time difference is REPORTED on every line but is
//! not by itself a failure. `--strict` applies the production anti-cheat
//! semantics instead: the re-simulated finish must match the claimed finish
//! tick within tolerance, exactly as `main.rs::validate_ghost` requires of a
//! player submission.
//!
//! Non-destructive: failing blobs are reported, never deleted.
//!
//! Exit codes: 0 = every blob passed, 1 = at least one blob failed,
//! 2 = usage or environment error (missing track store, bad WASM, no input).

use anyhow::{Context, Result};
use drawrace_api::blob::{GhostBlob, MIN_SWAP_TICK_GAP};
use drawrace_validator::{resim::ResimEngine, track::TrackStore};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Default track: 3 (dunes-03).
const DEFAULT_TRACK_ID: u16 = 3;

/// Current physics version — mirrors PHYSICS_VERSION in
/// packages/engine-core/src/version.ts. Blobs written by a different version
/// are re-simulated with mismatched physics, so a mismatch is reported (older
/// but swaps-capable versions still simulate; see MIN).
const PHYSICS_VERSION_CURRENT: u8 = 8;
/// Version at which mid-race wheel swaps were introduced; the wheels[] table
/// this binary feeds the engine only exists from here up.
const PHYSICS_VERSION_MIN: u8 = 2;

/// Same tolerance the production validator allows between its re-simulated
/// finish tick and the client's claim.
const FINISH_TICK_TOLERANCE: u32 = 2;

/// Resim seed. Defaults to the web client's DEFAULT_MATCHMAKE_SEED
/// (apps/web/src/api.ts) — the conditions under which a player's client
/// actually simulates these ghosts. Production's validate_ghost uses 42 for
/// submitted blobs; override here with --seed when comparing against it.
const DEFAULT_RESIM_SEED: u32 = 0xcafe;

/// Seeds slower than this cannot be distinguished from a DNF.
const MAX_FINISH_MS: u32 = 120_000;

struct Args {
    track_id: u16,
    tracks_dir: Option<PathBuf>,
    resim_seed: u32,
    strict: bool,
    paths: Vec<PathBuf>,
}

fn parse_args() -> Result<Args> {
    let mut args = Args {
        track_id: DEFAULT_TRACK_ID,
        tracks_dir: None,
        resim_seed: DEFAULT_RESIM_SEED,
        strict: false,
        paths: Vec::new(),
    };

    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--track-id" => {
                let value = iter
                    .next()
                    .context("--track-id requires a value (usage: --track-id <N>)")?;
                args.track_id = value
                    .parse()
                    .context(format!("invalid --track-id '{value}'"))?;
            }
            "--tracks-dir" => {
                let value = iter.next().context("--tracks-dir requires a path")?;
                args.tracks_dir = Some(PathBuf::from(value));
            }
            "--seed" => {
                let value = iter.next().context("--seed requires a value")?;
                let parsed: u32 = value.parse().context(format!("invalid --seed '{value}'"))?;
                args.resim_seed = parsed;
            }
            "--strict" => args.strict = true,
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other => args.paths.push(PathBuf::from(other)),
        }
    }

    if args.paths.is_empty() {
        args.paths
            .push(PathBuf::from(format!("seeds/track_{}", args.track_id)));
    }

    Ok(args)
}

fn print_help() {
    eprintln!(
        "Usage: validate-track3-seeds [--track-id <N>] [--tracks-dir <dir>] [--seed <N>] [--strict] <path>...\n\
         \n\
         Validates ghost blob FILES (or directories of .blob files) by loading,\n\
         structurally checking, and fully re-simulating each race.\n\
         \n\
         Defaults: --track-id {DEFAULT_TRACK_ID}, --seed {DEFAULT_RESIM_SEED} (client matchmake\n\
         seed), paths default to seeds/track_<track-id>.\n\
         \n\
         Default verdict = load + structure + clean re-simulated finish. The\n\
         re-simulated vs claimed time difference is always printed; --strict\n\
         additionally fails blobs whose finish ticks differ from the claim by\n\
         more than {FINISH_TICK_TOLERANCE} ticks (production submission semantics)."
    );
}

/// Locate the track JSON directory: explicit flag, else the repo checkout
/// (cwd or, under `cargo run`, the workspace the crate was built from).
fn resolve_tracks_dir(explicit: Option<&Path>) -> Result<PathBuf> {
    if let Some(dir) = explicit {
        return Ok(dir.to_path_buf());
    }

    let mut candidates = vec![PathBuf::from("apps/web/public/tracks")];
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push(
            PathBuf::from(manifest_dir)
                .join("../..")
                .join("apps/web/public/tracks"),
        );
    }

    candidates
        .into_iter()
        .find(|p| p.is_dir())
        .context("track JSON directory not found (looked in apps/web/public/tracks; override with --tracks-dir)")
}

/// Expand arguments into a sorted list of .blob files.
fn collect_blob_paths(paths: &[PathBuf]) -> Result<Vec<PathBuf>> {
    let mut blobs = Vec::new();

    for path in paths {
        if path.is_dir() {
            let mut entries: Vec<PathBuf> = std::fs::read_dir(path)
                .with_context(|| format!("failed to read directory {}", path.display()))?
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("blob"))
                .collect();
            entries.sort();
            if entries.is_empty() {
                anyhow::bail!("no .blob files found in directory {}", path.display());
            }
            blobs.extend(entries);
        } else {
            blobs.push(path.clone());
        }
    }

    if blobs.is_empty() {
        anyhow::bail!("no input blobs (pass blob files or directories containing .blob files)");
    }

    Ok(blobs)
}

/// Outcome of validating one blob, with the detail line to print.
struct BlobVerdict {
    passed: bool,
    detail: String,
}

fn validate_blob(
    bytes: &[u8],
    path: &Path,
    track_id: u16,
    track: &drawrace_validator::track::TrackData,
    engine: &ResimEngine,
    resim_seed: u32,
    strict: bool,
) -> BlobVerdict {
    let name = path.display().to_string();

    // ---- Layer 1: load -------------------------------------------------
    let blob = match GhostBlob::parse(bytes) {
        Ok(b) => b,
        Err(e) => {
            return BlobVerdict {
                passed: false,
                detail: format!("{name}: FAIL load — {e}"),
            };
        }
    };

    let header = &blob.header;
    let finish_time_ms = header.finish_time_ms;
    let time_sec = f64::from(finish_time_ms) / 1000.0;

    // ---- Layer 2: structure -------------------------------------------
    let mut issues: Vec<String> = Vec::new();

    if header.track_id != track_id {
        issues.push(format!(
            "track_id {} != expected {track_id}",
            header.track_id
        ));
    }
    if header.version < PHYSICS_VERSION_MIN {
        issues.push(format!(
            "physics version {} predates wheel swaps (min {PHYSICS_VERSION_MIN})",
            header.version
        ));
    } else if header.version > PHYSICS_VERSION_CURRENT {
        issues.push(format!(
            "physics version {} is newer than this validator knows ({PHYSICS_VERSION_CURRENT})",
            header.version
        ));
    }
    if finish_time_ms == 0 {
        issues.push("finish_time_ms is zero".to_string());
    } else if finish_time_ms > MAX_FINISH_MS {
        issues.push(format!(
            "finish_time_ms {finish_time_ms} exceeds DNF timeout ({MAX_FINISH_MS} ms)"
        ));
    }

    for (i, wheel) in blob.wheels.iter().enumerate() {
        let vc = wheel.polygon_vertices.len();
        if !(8..=32).contains(&vc) {
            issues.push(format!("wheel {i} vertex count {vc} outside [8, 32]"));
        }
    }

    for window in blob.wheels.windows(2) {
        let gap = window[1].swap_tick - window[0].swap_tick;
        if gap < MIN_SWAP_TICK_GAP {
            issues.push(format!(
                "swap_tick gap {gap} < minimum {MIN_SWAP_TICK_GAP} ticks"
            ));
        }
    }

    // 1/60 s per tick, as in the production validator.
    let finish_ticks = (u64::from(finish_time_ms) * 60 / 1000) as u32;
    if let Some(last) = blob.wheels.last() {
        if last.swap_tick > finish_ticks {
            issues.push(format!(
                "final swap_tick {} exceeds finish tick {finish_ticks}",
                last.swap_tick
            ));
        }
    }

    for window in blob.checkpoint_splits.windows(2) {
        if window[0] >= window[1] {
            issues.push("checkpoint splits not monotonically increasing".to_string());
            break;
        }
    }

    if !issues.is_empty() {
        return BlobVerdict {
            passed: false,
            detail: format!("{name}: FAIL structure — {}", issues.join("; ")),
        };
    }

    // ---- Layer 3: re-simulate -----------------------------------------
    let result = match engine.resim(
        &blob.wheels,
        &track.terrain,
        &track.obstacles,
        track.finish_x,
        track.start_x,
        track.start_y,
        finish_ticks,
        resim_seed,
    ) {
        Ok(r) => r,
        Err(e) => {
            return BlobVerdict {
                passed: false,
                detail: format!("{name}: FAIL resim — {e}"),
            };
        }
    };

    // ---- Layer 4: clean finish ----------------------------------------
    let (passed, finish_detail) = match result.finish_ticks {
        None => (false, "did not finish".to_string()),
        Some(sim_ticks) if result.stuck => (
            false,
            format!("stuck before finish (last tick {sim_ticks})"),
        ),
        Some(sim_ticks) => {
            let diff = sim_ticks.abs_diff(finish_ticks);
            let claim = format!(
                "sim={:.2}s({sim_ticks} ticks) claimed={time_sec:.2}s({finish_ticks}) Δ{diff} ticks",
                f64::from(sim_ticks) / 60.0,
            );
            if diff > FINISH_TICK_TOLERANCE {
                // Editorial seed times never equal re-sim times, so by default
                // this is reported, not failed. Strict mode = production
                // submission semantics, where the claim must be reproducible.
                if strict {
                    (
                        false,
                        format!(
                            "{claim} time-claim=MISMATCH (> tolerance {FINISH_TICK_TOLERANCE})"
                        ),
                    )
                } else {
                    (true, format!("{claim} time-claim=MISMATCH"))
                }
            } else {
                (true, format!("{claim} time-claim=match"))
            }
        }
    };

    let status = if passed { "PASS" } else { "FAIL" };
    BlobVerdict {
        passed,
        detail: format!(
            "{name}: {status} v{} t={time_sec:.2}s wheels={} {finish_detail}",
            header.version,
            blob.wheels.len(),
        ),
    }
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("error: {e:#}");
            return ExitCode::from(2);
        }
    };

    let blobs = match collect_blob_paths(&args.paths) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("error: {e:#}");
            return ExitCode::from(2);
        }
    };

    let tracks_dir = match resolve_tracks_dir(args.tracks_dir.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("error: {e:#}");
            return ExitCode::from(2);
        }
    };
    let store = match TrackStore::load(tracks_dir) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: failed to load track store: {e:#}");
            return ExitCode::from(2);
        }
    };
    let track = match store.get(args.track_id) {
        Some(t) => t.clone(),
        None => {
            eprintln!("error: track {} not found in track store", args.track_id);
            return ExitCode::from(2);
        }
    };

    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            eprintln!("error: failed to load resim WASM engine: {e:#}");
            return ExitCode::from(2);
        }
    };

    println!(
        "Validating {} blob(s) for track {} (seed {:#x}{}, start {:.2},{:.2} → finish x={:.2}, {} terrain pts, {} obstacles)",
        blobs.len(),
        args.track_id,
        args.resim_seed,
        if args.strict { ", strict" } else { "" },
        track.start_x,
        track.start_y,
        track.finish_x,
        track.terrain.len(),
        track.obstacles.len(),
    );

    let mut passed = 0usize;
    let mut failed = 0usize;
    for path in &blobs {
        let verdict = match std::fs::read(path) {
            Ok(bytes) => validate_blob(
                &bytes,
                path,
                args.track_id,
                &track,
                &engine,
                args.resim_seed,
                args.strict,
            ),
            Err(e) => BlobVerdict {
                passed: false,
                detail: format!("{}: FAIL load — {e}", path.display()),
            },
        };

        if verdict.passed {
            passed += 1;
        } else {
            failed += 1;
        }
        println!("{}", verdict.detail);
    }

    println!();
    println!(
        "Summary: {passed} passed, {failed} failed, {} total",
        blobs.len()
    );

    if failed > 0 {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}
