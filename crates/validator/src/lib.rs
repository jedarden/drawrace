pub const VALIDATOR_VERSION: &str = env!("CARGO_PKG_VERSION");

pub mod wasm_loader;
pub mod wasm_abi;
pub mod resim;

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn test_wasm_binary_format() {
        // Find resim.wasm
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
        let workspace_root = PathBuf::from(&manifest_dir)
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| ".".to_string());

        let wasm_path = PathBuf::from(format!("{}/packages/engine-core/dist/resim.wasm", workspace_root));
        if !wasm_path.exists() {
            println!("Skipping test: resim.wasm not found");
            return;
        }

        let wasm_bytes = std::fs::read(&wasm_path).expect("Failed to read WASM file");
        println!("WASM size: {} bytes", wasm_bytes.len());

        // Check WASM magic
        assert_eq!(&wasm_bytes[0..4], b"\x00asm", "Invalid WASM magic");

        // Check WASM version
        let version = u32::from_le_bytes([wasm_bytes[4], wasm_bytes[5], wasm_bytes[6], wasm_bytes[7]]);
        assert_eq!(version, 1, "Invalid WASM version");

        println!("WASM binary format: OK");
    }

    #[test]
    fn test_wasm_load_with_minimal_config() {
        use wasmtime::{Engine, Module, Config};

        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
        let workspace_root = PathBuf::from(&manifest_dir)
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| ".".to_string());

        let wasm_path = PathBuf::from(format!("{}/packages/engine-core/dist/resim.wasm", workspace_root));
        if !wasm_path.exists() {
            println!("Skipping test: resim.wasm not found");
            return;
        }

        let wasm_bytes = std::fs::read(&wasm_path).expect("Failed to read WASM file");

        // Try with minimal config
        let config = Config::new();
        let engine = Engine::new(&config).expect("Failed to create engine");

        match Module::new(&engine, &wasm_bytes) {
            Ok(module) => {
                println!("Module loaded successfully with minimal config!");
                println!("Exports:");
                for export in module.exports() {
                    println!("  - {}", export.name());
                }
            }
            Err(e) => {
                eprintln!("Failed to load module with minimal config: {}", e);
                if let Some(source) = e.source() {
                    eprintln!("Source error: {}", source);
                }
                // Print hex dump of the problematic area
                eprintln!("First 100 bytes: {:02x?}", &wasm_bytes[..100.min(wasm_bytes.len())]);
                panic!("Failed to load module");
            }
        }
    }

    #[test]
    fn test_wasm_detailed_parse() {
        use wasmtime::{Engine, Module, Config};

        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
        let workspace_root = PathBuf::from(&manifest_dir)
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| ".".to_string());

        let wasm_path = PathBuf::from(format!("{}/packages/engine-core/dist/resim.wasm", workspace_root));
        if !wasm_path.exists() {
            println!("Skipping test: resim.wasm not found");
            return;
        }

        let wasm_bytes = std::fs::read(&wasm_path).expect("Failed to read WASM file");

        // Try different configs
        let configs = vec![
            ("default", {
                let c = Config::new();
                c
            }),
            ("simd", {
                let mut c = Config::new();
                c.wasm_simd(true);
                c
            }),
            ("multi_memory", {
                let mut c = Config::new();
                c.wasm_multi_memory(true);
                c
            }),
        ];

        for (name, config) in configs {
            println!("\nTrying with {} config:", name);
            match Engine::new(&config) {
                Ok(engine) => {
                    match Module::new(&engine, &wasm_bytes) {
                        Ok(_) => {
                            println!("  ✓ Success!");
                            return;
                        }
                        Err(e) => {
                            println!("  ✗ Failed: {}", e);
                            if let Some(source) = e.source() {
                                println!("    Source: {}", source);
                            }
                        }
                    }
                }
                Err(e) => {
                    println!("  ✗ Failed to create engine: {}", e);
                }
            }
        }
    }
}
