/// WASM loader for content-hashed engine-core.wasm.
///
/// This module loads the engine-core WASM module using the content-hash
/// metadata file, verifies the physics_version export, and provides
/// access to the WASM instance.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::PathBuf;
use wasmtime::{Engine, Module, Store, Linker};

/// Metadata structure from engine-core.wasm.json
#[derive(Debug, Deserialize)]
struct EngineCoreMetadata {
    #[serde(rename = "contentHash")]
    content_hash: String,
    #[serde(rename = "physicsVersion")]
    physics_version: u32,
    #[serde(rename = "wasmFile")]
    wasm_file: String,
    #[serde(rename = "buildTime")]
    #[allow(dead_code)]
    build_time: String,
}

/// WASM engine wrapper for engine-core.
pub struct EngineCoreWasm {
    _engine: Engine,
    _module: Module,
    /// The physics version reported by the WASM module
    pub physics_version: u32,
    /// The content hash from the metadata file
    pub content_hash: String,
}

impl EngineCoreWasm {
    /// Load the content-hashed engine-core.wasm module.
    ///
    /// This reads the metadata file (engine-core.wasm.json) to determine
    /// which content-hashed WASM file to load, then instantiates the module
    /// and verifies the physics_version export.
    pub fn load() -> Result<Self> {
        let metadata_path = Self::find_metadata_path()?;
        let metadata = Self::read_metadata(&metadata_path)?;

        let wasm_path = metadata_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Invalid metadata path"))?
            .join(&metadata.wasm_file);

        let wasm_bytes = std::fs::read(&wasm_path)
            .with_context(|| format!("Failed to read WASM file: {}", wasm_path.display()))?;

        let mut config = wasmtime::Config::new();
        config.wasm_simd(true);
        config.wasm_multi_memory(true);

        let engine = Engine::new(&config)
            .context("Failed to create WASM engine")?;

        let module = Module::new(&engine, &wasm_bytes)
            .context("Failed to load WASM module")?;

        let mut store = Store::new(&engine, ());
        let linker = Linker::new(&engine);
        let instance = linker.instantiate(&mut store, &module)
            .context("Failed to instantiate WASM module")?;

        // Get and verify physics_version export
        let physics_version_func = instance
            .get_typed_func::<(), u32>(&mut store, "physics_version")
            .context("physics_version export not found")?;

        let wasm_physics_version = physics_version_func
            .call(&mut store, ())
            .context("physics_version call failed")?;

        // Verify the physics version matches the metadata
        if wasm_physics_version != metadata.physics_version {
            anyhow::bail!(
                "Physics version mismatch: WASM reports {}, metadata expects {}",
                wasm_physics_version,
                metadata.physics_version
            );
        }

        Ok(Self {
            _engine: engine,
            _module: module,
            physics_version: wasm_physics_version,
            content_hash: metadata.content_hash.clone(),
        })
    }

    /// Read the metadata JSON file.
    fn read_metadata(path: &PathBuf) -> Result<EngineCoreMetadata> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read metadata file: {}", path.display()))?;

        let metadata: EngineCoreMetadata = serde_json::from_str(&content)
            .context("Failed to parse metadata JSON")?;

        Ok(metadata)
    }

    /// Find the metadata file (engine-core.wasm.json).
    fn find_metadata_path() -> Result<PathBuf> {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .unwrap_or_else(|_| ".".to_string());

        // Compute workspace root from manifest_dir (crates/validator -> workspace root)
        let workspace_root = PathBuf::from(&manifest_dir)
            .parent() // crates
            .and_then(|p| p.parent()) // workspace root
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| ".".to_string());

        // Check for environment variable override
        if let Ok(env_path) = std::env::var("ENGINE_CORE_WASM_PATH") {
            let metadata_path = PathBuf::from(&env_path);
            if metadata_path.exists() {
                return Ok(metadata_path);
            }
        }

        // List of paths to try, in order
        let candidates = vec![
            // Absolute path from workspace root
            format!("{}/packages/engine-core/dist/engine-core.wasm.json", workspace_root),
            // Standard workspace layout
            format!("{}/../../packages/engine-core/dist/engine-core.wasm.json", manifest_dir),
            // Test environment
            format!("{}/../../../../../packages/engine-core/dist/engine-core.wasm.json", manifest_dir),
            // From current working directory
            "packages/engine-core/dist/engine-core.wasm.json".to_string(),
        ];

        for path in &candidates {
            let path_buf = PathBuf::from(&path);
            if path_buf.exists() {
                return Ok(path_buf);
            }
        }

        Err(anyhow::anyhow!(
            "Could not find engine-core.wasm.json in any of the following locations: {:?}. \
             Set ENGINE_CORE_WASM_PATH environment variable to override.",
            candidates
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_engine_core_wasm() {
        match EngineCoreWasm::load() {
            Ok(wasm) => {
                assert_eq!(wasm.physics_version, 4);
                assert!(!wasm.content_hash.is_empty());
            }
            Err(e) => {
                // If WASM file doesn't exist (e.g., in CI without build), skip test
                if e.to_string().contains("No such file") || e.to_string().contains("could not find") {
                    println!("Skipping test: WASM file not found (run build first)");
                    return;
                }
                panic!("Failed to load engine-core WASM: {}", e);
            }
        }
    }

    #[test]
    fn physics_version_matches_metadata() {
        match EngineCoreWasm::load() {
            Ok(wasm) => {
                // Physics version should be 4 as per metadata
                assert_eq!(wasm.physics_version, 4);
            }
            Err(e) => {
                if e.to_string().contains("No such file") || e.to_string().contains("could not find") {
                    println!("Skipping test: WASM file not found (run build first)");
                    return;
                }
                panic!("Failed to load engine-core WASM: {}", e);
            }
        }
    }
}
