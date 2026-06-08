/// Quick debug script to see what the WASM resim produces
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let wasm_bytes = std::fs::read("packages/engine-core/dist/resim.wasm")?;

    let config = wasmtime::Config::new();
    let engine = wasmtime::Engine::new(&config)?;
    let module = wasmtime::Module::new(&engine, &wasm_bytes)?;

    let mut store = wasmtime::Store::new(&engine, ());
    let linker = wasmtime::Linker::new(&engine);
    let instance = linker.instantiate(&mut store, &module)?;

    // Get physics version
    let physics_version = instance
        .get_typed_func::<(), u32>(&mut store, "physics_version")?
        .call(&mut store, ())?;
    println!("Physics version: {}", physics_version);

    // Get memory
    let memory = instance
        .get_memory(&mut store, "memory")
        .expect("memory export not found");

    // Write minimal test data
    // 12-vertex unit circle wheel
    let wheel_verts: Vec<(i16, i16)> = (0..12)
        .map(|i| {
            let angle = (i as f32 / 12.0) * std::f32::consts::PI * 2.0;
            ((angle.cos() * 100.0) as i16, (angle.sin() * 100.0) as i16)
        })
        .collect();

    // Write header
    let write_u32 = |offset: u32, value: u32| -> anyhow::Result<()> {
        let data = memory.data_mut(&mut store);
        let offset = offset as usize;
        unsafe {
            std::ptr::write(data.as_mut_ptr().add(offset) as *mut u32, value.to_le());
        }
        Ok(())
    };

    let write_f32 = |offset: u32, value: f32| -> anyhow::Result<()> {
        let data = memory.data_mut(&mut store);
        let offset = offset as usize;
        unsafe {
            std::ptr::write(data.as_mut_ptr().add(offset) as *mut u32, value.to_bits().to_le());
        }
        Ok(())
    };

    let write_vertex = |offset: u32, x: i16, y: i16| -> anyhow::Result<()> {
        let data = memory.data_mut(&mut store);
        let offset = offset as usize;
        unsafe {
            std::ptr::write(data.as_mut_ptr().add(offset) as *mut i16, x.to_le());
            std::ptr::write(data.as_mut_ptr().add(offset + 2) as *mut i16, y.to_le());
        }
        Ok(())
    };

    let read_u32 = |offset: u32| -> u32 {
        let data = memory.data(&store);
        let offset = offset as usize;
        unsafe {
            u32::from_le(std::ptr::read(data.as_ptr().add(offset) as *const u32))
        }
    };

    // Header region (offset 0)
    write_u32(0, 0x52534D49)?; // MAGIC
    write_u32(4, 1)?;           // VERSION
    write_u32(8, 1)?;           // NUM_WHEELS
    write_u32(16, 5)?;          // TERRAIN_COUNT
    write_u32(20, 0)?;          // OBSTACLE_COUNT
    write_f32(24, 40.0)?;       // FINISH_X
    write_f32(28, 1.5)?;        // START_X
    write_f32(32, 498.5)?;      // START_Y
    write_u32(36, 500)?;        // CLAIMED_FINISH (generous timeout)
    write_u32(48, 42)?;         // SEED

    // Wheel array (offset 256)
    write_u32(256, 0)?;         // SWAP_TICK
    write_u32(260, 12)?;        // VERTEX_COUNT
    write_u32(264, 0)?;         // VERTEX_OFFSET

    // Vertex buffer (offset 8192)
    for (i, &(x, y)) in wheel_verts.iter().enumerate() {
        write_vertex(8192 + (i as u32) * 4, x, y)?;
    }

    // Terrain (offset 24576)
    for (i, &(x, y)) in [(0.0, 500.0), (10.0, 500.0), (20.0, 500.0), (30.0, 500.0), (40.0, 500.0)].iter().enumerate() {
        write_f32(24576 + (i as u32) * 8 + 0, x)?;
        write_f32(24576 + (i as u32) * 8 + 4, y)?;
    }

    // Initialize
    let resim_init = instance.get_typed_func::<(), u32>(&mut store, "resim_init")?;
    let init_result = resim_init.call(&mut store, ())?;
    println!("Init result: {}", init_result);

    // Run simulation
    let resim_step = instance.get_typed_func::<(), u32>(&mut store, "resim_step")?;
    let mut tick = 0;
    loop {
        let step_result = resim_step.call(&mut store, ())?;
        tick += 1;
        if step_result == 0 || tick > 1000 {
            break;
        }
    }

    // Read result
    let finish_ticks = read_u32(65536);
    let sim_tick = read_u32(49152);

    println!("Simulation tick: {}", sim_tick);
    println!("Finish ticks: {}", finish_ticks);
    println!("Finish time ms: {}", finish_ticks * 1000 / 60);

    Ok(())
}
