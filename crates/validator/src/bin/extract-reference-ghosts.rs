//! Extract real production ghosts (DB metadata + S3 blob decode) into a raw dump.
//!
//! This is the REAL Layer 6 production extraction path (bead `bf-2ji9i`, child 1
//! of the `bf-2zrt7` split). It implements the two-stage extraction the task
//! names — and corrects the wrong SQL that lived in `crates/validator/tests/README.md`:
//!
//!   1. Query the production `ghosts` table for metadata rows.
//!   2. Fetch each ghost's DRGH blob from object storage (S3/Garage) by
//!      `ghosts.s3_key` and decode it via the existing ghost-blob decoder
//!      (`drawrace_api::blob::GhostBlob` — the v2 `wheels[]` format with a
//!      physics_version header).
//!
//! ## Why a DB + S3 extractor (and not a single SQL query)
//!
//! The wheel-swap geometry is NOT in Postgres. `crates/api/migrations/001_initial.sql`
//! defines `ghosts` with metadata columns only — `time_ms` (INTEGER), `track_id`,
//! `physics_version`, `s3_key` (TEXT), `is_legacy`, `is_pb`. There is **no**
//! `wheels` column and **no** `finish_time_ms` column (the README's old SQL
//! referenced both — neither exists). The drivable polygons live as a versioned
//! BINARY blob in object storage, keyed by `ghosts.s3_key`. Extraction is
//! therefore necessarily (metadata row) × (blob fetch) × (blob decode), which is
//! exactly what this binary does.
//!
//! ## "ACCEPTED" semantics
//!
//! A row in `ghosts` only ever exists for an accepted run: `submissions.status`
//! flips to `'accepted'` and sets `submissions.ghost_id` at the same moment the
//! ghost row is inserted. So every `ghosts` row is, by construction, an accepted
//! submission — no `status` filter is needed (there is no `status` column on
//! `ghosts`). The "clean drivable runs" preference is expressed instead via
//! `is_legacy = false`, current `physics_version`, and `ORDER BY is_pb DESC,
//! time_ms ASC`.
//!
//! ## Production connectivity (verified 2026-07-26 from this box)
//!
//! Production drawrace is **not deployed**. Verified fresh:
//!   - `api-drawrace.ardenone.com` → NXDOMAIN (no public API).
//!   - `drawrace` namespace on `rs-manager` (the designated prod cluster) EXISTS
//!     but is EMPTY: no Deployments, Pods, Services, StatefulSets, Secrets, or
//!     ConfigMaps (only the auto-created `kube-root-ca.crt`). No CloudNativePG
//!     Postgres, no S3 credentials in the namespace.
//!   - `ardenone-hub` (where Garage S3 lives) kubectl-proxy is unreachable
//!     (connection timeout); and no API was ever deployed to write blobs anyway.
//!   - `BLOCKER_SUMMARY.md`: deployment is blocked on the OpenBao root token +
//!     cluster-admin grant (tracked by `nd-1fkb` / `nd-xjnv` / `nd-639` / the
//!     genesis deployment bead `bf-5ft`).
//!
//! So the literal "extract >=200 real production ghosts" criterion cannot be
//! satisfied today — there is no Postgres to query and no S3 bucket holding
//! player blobs. This binary is the ready-to-run path for the moment the backend
//! goes live; until then it exits cleanly with a documented "prod unreachable"
//! report when `DATABASE_URL` is absent, and the `--self-check` mode verifies
//! the decode pipeline against the committed real seed blobs offline.
//!
//! ## Usage
//!
//! Production extraction (once the backend is deployed):
//! ```bash
//! DATABASE_URL=postgres://user:pass@host:5432/db \
//! S3_BUCKET=drawrace-ghosts \
//! S3_ENDPOINT=https://garage.ardenone... \
//! AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//! CURRENT_PHYSICS_VERSION=8 \
//! cargo run -p drawrace-validator --bin extract-reference-ghosts -- \
//!     --out crates/validator/raw-ghost-extract.json
//! ```
//!
//! ## Prod env contract (all six variables)
//!
//! | Var | Required | Default | Purpose |
//! |-----|----------|---------|---------|
//! | `DATABASE_URL` | **yes** | — | Postgres connection string for the prod `ghosts` table. Credentials are read live from the env, never persisted — see the credential-handling note below. |
//! | `S3_BUCKET` | no | `drawrace-ghosts` | Object-storage bucket holding the DRGH blob per `ghosts.s3_key`. |
//! | `S3_ENDPOINT` | no | real AWS S3 | Garage (S3-compatible) endpoint URL. Set this for prod (Garage on ardenone-hub). |
//! | `AWS_ACCESS_KEY_ID` | **yes** (prod) | — | Garage/AWS credential, read from the env by the AWS SDK. |
//! | `AWS_SECRET_ACCESS_KEY` | **yes** (prod) | — | Garage/AWS credential, read from the env by the AWS SDK. |
//! | `CURRENT_PHYSICS_VERSION` | no | `8` (mirrors `packages/engine-core/src/version.ts`) | Only current-version ghosts are extracted; bump this in lockstep with a `PHYSICS_VERSION` bump. |
//!
//! **No credentials are persisted to git.** `AWS_ACCESS_KEY_ID` /
//! `AWS_SECRET_ACCESS_KEY` / the `DATABASE_URL` password are read from the
//! environment at runtime only. The dump's `source.database` label is run through
//! `redact_url()`, which strips the `user:pass@` segment so the raw dump never
//! contains a password. The placeholders above (`user:pass`, `...`) are example
//! shell, not committed secrets.
//!
//! Offline decode self-check (no DB / S3 required — exercises the real decoder
//! against the committed seed blobs and the dump emitter end-to-end):
//! ```bash
//! cargo run -p drawrace-validator --bin extract-reference-ghosts -- --self-check
//! ```
//! or via the wrapper: `scripts/extract-reference-ghosts.sh --self-check`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;
use chrono::Utc;
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use drawrace_api::blob::GhostBlob;

/// Current physics version. Source of truth is `packages/engine-core/src/version.ts`
/// (`PHYSICS_VERSION = 8`). Override via the `CURRENT_PHYSICS_VERSION` env var.
const DEFAULT_PHYSICS_VERSION: i16 = 8;

/// How many ghosts to pull per track. 80 × 3 = up to 240 candidates, comfortably
/// clearing the >=200 bar when prod is populated.
const PER_TRACK_LIMIT: i64 = 80;

/// The three shipped tracks (plan §Gameplay 7). `apps/web/public/tracks/`:
/// 1=hills-01, 2=canyon-02, 3=dunes-03.
const TRACK_IDS: [i16; 3] = [1, 2, 3];

/// Default output path for the raw dump.
const DEFAULT_OUT: &str = "crates/validator/raw-ghost-extract.json";

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.iter().any(|a| a == "--self-check" || a == "--offline") {
        return run_self_check(&out_path_from_args(&args)).await;
    }

    if args.iter().any(|a| a == "--help" || a == "-h") {
        print_usage();
        return Ok(());
    }

    // ── Production extraction path ──────────────────────────────────────────
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(u) if !u.is_empty() => u,
        _ => {
            report_prod_unreachable("DATABASE_URL is not set");
            return Ok(());
        }
    };

    let pool = match drawrace_api::db::create_pool(&database_url).await {
        Ok(p) => p,
        Err(e) => {
            report_prod_unreachable(&format!("DATABASE_URL is set but unreachable: {e}"));
            // A configured-but-dead DB is a real failure, not a graceful no-op.
            return Err(anyhow!("failed to connect to DATABASE_URL: {e}"));
        }
    };

    let bucket = std::env::var("S3_BUCKET").unwrap_or_else(|_| "drawrace-ghosts".to_string());
    let endpoint = std::env::var("S3_ENDPOINT").ok();
    let s3_client = build_s3_client(endpoint.as_deref()).await;

    let physics_version = std::env::var("CURRENT_PHYSICS_VERSION")
        .ok()
        .and_then(|s| s.trim().parse::<i16>().ok())
        .unwrap_or(DEFAULT_PHYSICS_VERSION);

    let out_path = out_path_from_args(&args);
    extract(
        &pool,
        &s3_client,
        &bucket,
        endpoint.as_deref(),
        physics_version,
        &out_path,
    )
    .await
}

/// The actual extraction: query → fetch → decode → validate → dump.
async fn extract(
    pool: &sqlx::PgPool,
    s3: &S3Client,
    bucket: &str,
    endpoint: Option<&str>,
    physics_version: i16,
    out_path: &PathBuf,
) -> Result<()> {
    // Correct query against the REAL schema (ghosts has NO wheels / finish_time_ms
    // columns; wheel geometry lives in the S3 blob keyed by s3_key). Windowed per
    // track so all 3 tracks are represented; prefer is_pb then fastest time.
    let rows = sqlx::query(
        r#"
        WITH ranked AS (
            SELECT ghost_id, player_uuid, track_id, physics_version, time_ms,
                   is_pb, is_legacy, s3_key, created_at,
                   ROW_NUMBER() OVER (
                       PARTITION BY track_id
                       ORDER BY is_pb DESC, time_ms ASC
                   ) AS rn
              FROM ghosts
             WHERE track_id = ANY($1)
               AND is_legacy = false
               AND physics_version = $2
        )
        SELECT ghost_id, player_uuid, track_id, physics_version, time_ms,
               is_pb, is_legacy, s3_key, created_at
          FROM ranked
         WHERE rn <= $3
         ORDER BY track_id ASC, rn ASC
        "#,
    )
    .bind(&TRACK_IDS[..])
    .bind(physics_version)
    .bind(PER_TRACK_LIMIT)
    .fetch_all(pool)
    .await
    .context("ghosts metadata query failed")?;

    eprintln!(
        "extract: {} metadata rows matched (physics_version={}, tracks={:?}, per_track_limit={})",
        rows.len(),
        physics_version,
        TRACK_IDS,
        PER_TRACK_LIMIT
    );

    let mut ghosts: Vec<ExtractedGhost> = Vec::with_capacity(rows.len());
    let mut failures: Vec<DecodeFailure> = Vec::new();

    for row in &rows {
        let ghost_id: Uuid = row.try_get("ghost_id")?;
        let track_id: i16 = row.try_get("track_id")?;
        let pv: i16 = row.try_get("physics_version")?;
        let time_ms: i32 = row.try_get("time_ms")?;
        let is_pb: bool = row.try_get("is_pb")?;
        let is_legacy: bool = row.try_get("is_legacy")?;
        let s3_key: String = row.try_get("s3_key")?;

        let blob_bytes = match s3.get_object().bucket(bucket).key(&s3_key).send().await {
            Ok(resp) => resp
                .body
                .collect()
                .await
                .context("S3 body collect failed")?
                .to_vec(),
            Err(e) => {
                failures.push(DecodeFailure {
                    ghost_id,
                    s3_key: s3_key.clone(),
                    stage: "s3_fetch".into(),
                    error: format!("{e}"),
                });
                continue;
            }
        };

        let blob = match GhostBlob::parse(&blob_bytes) {
            Ok(b) => b,
            Err(e) => {
                failures.push(DecodeFailure {
                    ghost_id,
                    s3_key: s3_key.clone(),
                    stage: "blob_decode".into(),
                    error: format!("{e}"),
                });
                continue;
            }
        };

        // Confirm the decoded wheels carry real drivable polygons (not the
        // synthetic circles / degenerate shapes the old corpus held).
        let mut polygon_notes: Vec<String> = Vec::new();
        for (i, w) in blob.wheels.iter().enumerate() {
            let area = polygon_signed_area(&w.polygon_vertices);
            if w.vertex_count < drawrace_api::blob::MIN_VERTEX_COUNT
                || w.vertex_count > drawrace_api::blob::MAX_VERTEX_COUNT
            {
                polygon_notes.push(format!(
                    "wheel[{i}] vertex_count {} out of [{},{}]",
                    w.vertex_count,
                    drawrace_api::blob::MIN_VERTEX_COUNT,
                    drawrace_api::blob::MAX_VERTEX_COUNT
                ));
            }
            if area.abs() < 1e-3 {
                polygon_notes.push(format!("wheel[{i}] degenerate (area={area:.4})"));
            }
        }

        ghosts.push(ExtractedGhost {
            ghost_id,
            track_id,
            physics_version: pv,
            time_ms,
            is_pb,
            is_legacy,
            s3_key,
            blob_version: blob.header.version,
            blob_track_id: blob.header.track_id,
            blob_finish_time_ms: blob.header.finish_time_ms,
            wheel_count: blob.wheel_count,
            wheels: blob
                .wheels
                .iter()
                .map(|w| DecodedWheel {
                    swap_tick: w.swap_tick,
                    vertex_count: w.vertex_count,
                    polygon_vertices: w.polygon_vertices.iter().map(|(x, y)| [*x, *y]).collect(),
                })
                .collect(),
            polygon_notes,
        });
    }

    let dump = RawDump {
        extracted_at: Utc::now(),
        source: DumpSource {
            kind: "production".into(),
            database: redact_url(&std::env::var("DATABASE_URL").unwrap_or_default()),
            s3_bucket: bucket.into(),
            s3_endpoint: endpoint.map(str::to_string),
        },
        filter: DumpFilter {
            physics_version,
            tracks: TRACK_IDS.to_vec(),
            is_legacy: false,
            per_track_limit: PER_TRACK_LIMIT,
        },
        count: ghosts.len() as u64,
        decode_failures: failures,
        ghosts,
    };

    let json = serde_json::to_string_pretty(&dump).context("serialize dump")?;
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    std::fs::write(out_path, json).with_context(|| format!("write {}", out_path.display()))?;

    // Per-track + verdict summary on stderr.
    let mut per_track: BTreeMap<i16, usize> = BTreeMap::new();
    for g in &dump.ghosts {
        *per_track.entry(g.track_id).or_insert(0) += 1;
    }
    eprintln!(
        "extract: wrote {} decoded ghosts to {} (failures: {})",
        dump.count,
        out_path.display(),
        dump.decode_failures.len()
    );
    for (tid, n) in &per_track {
        eprintln!("  track {tid}: {n} ghosts");
    }
    if dump.count < 200 {
        eprintln!(
            "extract: WARNING — only {} ghosts extracted (< 200 target). \
             This is expected while prod has < ~67 accepted current-version \
             ghosts per track.",
            dump.count
        );
    }

    Ok(())
}

/// Offline self-check: run the SAME decode + validate + dump-emitter pipeline
/// against the committed real seed blobs (`seeds/track_{1,2,3}/*.blob`). Proves
/// the decoder produces real drivable polygons from real DRGH bytes without
/// needing prod. Output is written to a clearly-labelled `.selfcheck.json` so it
/// can never be mistaken for a production extraction.
async fn run_self_check(out_path: &PathBuf) -> Result<()> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // crates/validator  ->  repo_root/seeds
    let seeds_root = manifest_dir.join("../../seeds");

    let mut ghosts: Vec<ExtractedGhost> = Vec::new();
    let mut failures: Vec<DecodeFailure> = Vec::new();

    for track_id in TRACK_IDS {
        let dir = seeds_root.join(format!("track_{track_id}"));
        if !dir.exists() {
            failures.push(DecodeFailure {
                ghost_id: Uuid::nil(),
                s3_key: dir.display().to_string(),
                stage: "self_check_dir".into(),
                error: "seed dir not found".into(),
            });
            continue;
        }
        let mut entries: Vec<_> = std::fs::read_dir(&dir)
            .with_context(|| format!("read {}", dir.display()))?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "blob"))
            .collect();
        entries.sort();
        for path in entries {
            let bytes = std::fs::read(&path).with_context(|| format!("read {}", path.display()))?;
            let blob = match GhostBlob::parse(&bytes) {
                Ok(b) => b,
                Err(e) => {
                    failures.push(DecodeFailure {
                        ghost_id: Uuid::nil(),
                        s3_key: path.display().to_string(),
                        stage: "blob_decode".into(),
                        error: format!("{e}"),
                    });
                    continue;
                }
            };
            let mut polygon_notes: Vec<String> = Vec::new();
            for (i, w) in blob.wheels.iter().enumerate() {
                let area = polygon_signed_area(&w.polygon_vertices);
                if w.vertex_count < drawrace_api::blob::MIN_VERTEX_COUNT
                    || w.vertex_count > drawrace_api::blob::MAX_VERTEX_COUNT
                {
                    polygon_notes.push(format!(
                        "wheel[{i}] vertex_count {} out of range",
                        w.vertex_count
                    ));
                }
                if area.abs() < 1e-3 {
                    polygon_notes.push(format!("wheel[{i}] degenerate (area={area:.4})"));
                }
            }
            ghosts.push(ExtractedGhost {
                ghost_id: Uuid::new_v4(), // self-check has no DB id; synthetic for JSON shape
                track_id,
                physics_version: blob.header.version as i16,
                time_ms: blob.header.finish_time_ms as i32,
                is_pb: false,
                is_legacy: false,
                s3_key: path.display().to_string(),
                blob_version: blob.header.version,
                blob_track_id: blob.header.track_id,
                blob_finish_time_ms: blob.header.finish_time_ms,
                wheel_count: blob.wheel_count,
                wheels: blob
                    .wheels
                    .iter()
                    .map(|w| DecodedWheel {
                        swap_tick: w.swap_tick,
                        vertex_count: w.vertex_count,
                        polygon_vertices: w
                            .polygon_vertices
                            .iter()
                            .map(|(x, y)| [*x, *y])
                            .collect(),
                    })
                    .collect(),
                polygon_notes,
            });
        }
    }

    let check_path = {
        let mut p = out_path.clone();
        let file = p.file_name().unwrap().to_string_lossy().to_string();
        let new_file = file.replace(".json", ".selfcheck.json");
        p.set_file_name(new_file);
        p
    };

    let dump = RawDump {
        extracted_at: Utc::now(),
        source: DumpSource {
            kind: "self-check (committed seed blobs) — NOT production".into(),
            database: "n/a (offline)".into(),
            s3_bucket: "n/a (filesystem seeds/)".into(),
            s3_endpoint: None,
        },
        filter: DumpFilter {
            physics_version: 0,
            tracks: TRACK_IDS.to_vec(),
            is_legacy: false,
            per_track_limit: 0,
        },
        count: ghosts.len() as u64,
        decode_failures: failures,
        ghosts,
    };

    let json = serde_json::to_string_pretty(&dump)?;
    if let Some(parent) = check_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&check_path, json)?;

    // Hard-assert real polygons: a non-zero area wheel with >= MIN vertices.
    let mut ok = 0usize;
    let mut bad = 0usize;
    for g in &dump.ghosts {
        let real = g.wheels.iter().all(|w| {
            w.vertex_count >= drawrace_api::blob::MIN_VERTEX_COUNT as u8
                && polygon_signed_area(
                    &w.polygon_vertices
                        .iter()
                        .map(|p| (p[0], p[1]))
                        .collect::<Vec<_>>(),
                )
                .abs()
                    >= 1e-3
        });
        if real && g.wheels.first().is_some_and(|w| w.swap_tick == 0) {
            ok += 1;
        } else {
            bad += 1;
        }
    }
    eprintln!(
        "self-check: decoded {} seed blobs -> wrote {} ; real-drivable-polygons: {} ok / {} flagged",
        dump.count,
        check_path.display(),
        ok,
        bad
    );
    if bad != 0 {
        return Err(anyhow!("self-check flagged {bad} blobs as non-drivable"));
    }
    if dump.count < 200 {
        eprintln!(
            "self-check: NOTE — seed pool only has {} blobs (< 200); this verifies \
             the decode pipeline on real DRGH bytes, it is not a production extract.",
            dump.count
        );
    }
    Ok(())
}

// ── helpers ──────────────────────────────────────────────────────────────────

async fn build_s3_client(endpoint: Option<&str>) -> S3Client {
    // aws_config loaders are async, so this is an async constructor. The Garage
    // endpoint URL + a dummy region are required for S3-compatible storage;
    // without an endpoint the client targets real AWS S3.
    let mut cfg = aws_config::defaults(BehaviorVersion::latest());
    if let Some(endpoint) = endpoint {
        cfg = cfg
            .region(aws_sdk_s3::config::Region::new("garage"))
            .endpoint_url(endpoint);
    }
    S3Client::new(&cfg.load().await)
}

fn report_prod_unreachable(reason: &str) {
    eprintln!("extract: production unreachable — {reason}");
    eprintln!(
        "  Verified 2026-07-26: api-drawrace.ardenone.com is NXDOMAIN; the `drawrace`\n  \
         namespace on rs-manager exists but is empty (no Postgres, no S3 creds);\n  \
         ardenone-hub Garage proxy is unreachable. Deployment is blocked on the\n  \
         OpenBao root token / cluster-admin grant (nd-1fkb / nd-xjnv / nd-639 / bf-5ft)."
    );
    eprintln!(
        "  No raw dump produced. Re-run once DATABASE_URL + S3 creds are configured,\n  \
         or run `--self-check` to verify the decode pipeline offline."
    );
}

fn out_path_from_args(args: &[String]) -> PathBuf {
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        if a == "--out" {
            if let Some(v) = iter.next() {
                return PathBuf::from(v);
            }
        } else if let Some(v) = a.strip_prefix("--out=") {
            return PathBuf::from(v);
        }
    }
    PathBuf::from(DEFAULT_OUT)
}

fn print_usage() {
    eprintln!(
        "extract-reference-ghosts — Layer 6 production ghost extractor\n\n\
         USAGE:\n  \
           extract-reference-ghosts [--out PATH]        prod extract (needs DATABASE_URL + S3)\n  \
           extract-reference-ghosts --self-check [--out PATH]   offline decode self-check\n\n\
         ENV (prod mode):\n  \
           DATABASE_URL, S3_BUCKET (default drawrace-ghosts), S3_ENDPOINT (Garage),\n  \
           AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, CURRENT_PHYSICS_VERSION (default 8)"
    );
}

/// Shoelace signed area of a polygon (in 1/100-px units²). Non-zero ⇒ a real,
/// non-degenerate polygon rather than a synthetic circle / collapsed shape.
fn polygon_signed_area(verts: &[(i16, i16)]) -> f64 {
    if verts.len() < 3 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    for i in 0..verts.len() {
        let (x0, y0) = verts[i];
        let (x1, y1) = verts[(i + 1) % verts.len()];
        sum += (x0 as f64) * (y1 as f64) - (x1 as f64) * (y0 as f64);
    }
    sum * 0.5
}

/// Strip credentials from a DATABASE_URL for the dump's `source` label so the
/// raw dump never persists a password.
fn redact_url(url: &str) -> String {
    // postgres://user:pass@host:port/db  ->  postgres://host:port/db
    match url.find("://") {
        Some(idx) => {
            let scheme = &url[..idx + 3];
            let rest = &url[idx + 3..];
            match rest.find('@') {
                Some(at) => format!("{scheme}{}", &rest[at + 1..]),
                None => url.to_string(),
            }
        }
        None => "<set>".to_string(),
    }
}

// ── dump schema ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct RawDump {
    extracted_at: chrono::DateTime<Utc>,
    source: DumpSource,
    filter: DumpFilter,
    count: u64,
    decode_failures: Vec<DecodeFailure>,
    ghosts: Vec<ExtractedGhost>,
}

#[derive(Serialize)]
struct DumpSource {
    kind: String,
    database: String,
    s3_bucket: String,
    s3_endpoint: Option<String>,
}

#[derive(Serialize)]
struct DumpFilter {
    physics_version: i16,
    tracks: Vec<i16>,
    is_legacy: bool,
    per_track_limit: i64,
}

#[derive(Serialize)]
struct DecodeFailure {
    ghost_id: Uuid,
    s3_key: String,
    stage: String,
    error: String,
}

#[derive(Serialize)]
struct ExtractedGhost {
    ghost_id: Uuid,
    track_id: i16,
    physics_version: i16,
    time_ms: i32,
    is_pb: bool,
    is_legacy: bool,
    s3_key: String,
    blob_version: u8,
    blob_track_id: u16,
    blob_finish_time_ms: u32,
    wheel_count: u8,
    wheels: Vec<DecodedWheel>,
    /// Empty ⇒ clean real polygons; non-empty lists structural anomalies.
    polygon_notes: Vec<String>,
}

#[derive(Serialize)]
struct DecodedWheel {
    swap_tick: u32,
    vertex_count: u8,
    polygon_vertices: Vec<[i16; 2]>,
}

#[cfg(test)]
mod tests {
    //! Decode round-trip proof for criterion 3: confirm the existing ghost-blob
    //! decoder turns a real DRGH blob into real drivable polygons (not the
    //! synthetic circles / degenerate shapes the old corpus held). Runs against
    //! the committed seed blobs in CI via `cargo test -p drawrace-validator`.

    use super::*;
    use std::path::PathBuf;

    fn seeds_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../seeds")
    }

    fn first_seed_blob() -> PathBuf {
        let p = seeds_root().join("track_1").join("seed-001.blob");
        assert!(
            p.exists(),
            "missing seed blob: {}; run the seed generator",
            p.display()
        );
        p
    }

    #[test]
    fn decode_real_seed_blob_yields_drivable_polygons() {
        let bytes = std::fs::read(first_seed_blob()).expect("read seed blob");
        let blob = GhostBlob::parse(&bytes).expect("seed blob must decode");

        // Header sanity.
        // Magic lives in the raw blob bytes (the header parses + discards it).
        assert_eq!(&bytes[0..4], drawrace_api::blob::MAGIC, "magic");
        assert!(
            (1..=21).contains(&blob.wheel_count),
            "wheel_count {} not in 1..=21",
            blob.wheel_count
        );

        // First wheel is the initial wheel (swap_tick == 0).
        let first = &blob.wheels[0];
        assert_eq!(first.swap_tick, 0, "initial wheel swap_tick must be 0");

        // Every wheel is a real, non-degenerate polygon with valid vertex count.
        for (i, w) in blob.wheels.iter().enumerate() {
            assert!(
                (drawrace_api::blob::MIN_VERTEX_COUNT..=drawrace_api::blob::MAX_VERTEX_COUNT)
                    .contains(&w.vertex_count),
                "wheel[{i}] vertex_count {} out of range",
                w.vertex_count
            );
            assert_eq!(
                w.polygon_vertices.len(),
                w.vertex_count as usize,
                "wheel[{i}] vertex array length mismatch"
            );
            let area = polygon_signed_area(&w.polygon_vertices).abs();
            assert!(
                area >= 1e-3,
                "wheel[{i}] degenerate polygon (area={area:.6}) — synthetic, not drivable"
            );
            // Real drivable polygons span a non-trivial bbox (not a collapsed line).
            let xs: Vec<_> = w.polygon_vertices.iter().map(|(x, _)| *x).collect();
            let ys: Vec<_> = w.polygon_vertices.iter().map(|(_, y)| *y).collect();
            let xrange = (*xs.iter().max().unwrap() as i32 - *xs.iter().min().unwrap() as i32);
            let yrange = (*ys.iter().max().unwrap() as i32 - *ys.iter().min().unwrap() as i32);
            assert!(xrange > 5 && yrange > 5, "wheel[{i}] collapsed bbox");
        }
    }

    #[test]
    fn polygon_signed_area_unit_square() {
        let sq: Vec<(i16, i16)> = vec![(0, 0), (10, 0), (10, 10), (0, 10)];
        assert!((polygon_signed_area(&sq) - 100.0).abs() < 1e-9);
    }

    #[test]
    fn polygon_signed_area_degenerate() {
        // Collinear points ⇒ zero area ⇒ flagged as non-drivable.
        let line: Vec<(i16, i16)> = vec![(0, 0), (5, 5), (10, 10)];
        assert!(polygon_signed_area(&line).abs() < 1e-9);
    }
}
