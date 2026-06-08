(module
  ;; Global for physics version
  (global $PHYSICS_VERSION i32 (i32.const 4))

  ;; Mutable globals for simulation state
  (global $sim_tick (mut i32) (i32.const 0))
  (global $finished (mut i32) (i32.const 0))
  (global $stuck (mut i32) (i32.const 0))
  (global $chassis_x (mut f32) (f32.const 0.0))
  (global $chassis_y (mut f32) (f32.const 0.0))
  (global $velocity_x (mut f32) (f32.const 0.0))
  (global $finish_x_copy (mut f32) (f32.const 0.0))
  (global $wheel_radius (mut f32) (f32.const 0.35))
  (global $swaps_applied (mut i32) (i32.const 0))

  ;; Constants
  (global $MOTOR_SPEED f32 (f32.const 8.0))  ;; rad/s
  (global $EFFICIENCY f32 (f32.const 0.795))  ;; rolling efficiency (~80%)
  (global $DT f32 (f32.const 0.01666667))  ;; 1/60

  ;; Offsets (from wasm_abi.rs)
  (global $HEADER_OFFSET i32 (i32.const 0))
  (global $WHEEL_ARRAY_OFFSET i32 (i32.const 256))
  (global $WHEEL_DESC_SIZE i32 (i32.const 16))
  (global $VERTEX_BUFFER_OFFSET i32 (i32.const 8192))
  (global $STATE_OFFSET i32 (i32.const 49152))
  (global $RESULT_OFFSET i32 (i32.const 65536))
  (global $MAX_WHEELS i32 (i32.const 21))

  ;; Header offsets
  (global $HEADER_NUM_WHEELS i32 (i32.const 8))
  (global $HEADER_FINISH_X i32 (i32.const 24))
  (global $HEADER_START_X i32 (i32.const 28))
  (global $HEADER_START_Y i32 (i32.const 32))

  ;; Wheel descriptor offsets
  (global $WHEEL_SWAP_TICK i32 (i32.const 0))
  (global $WHEEL_VERTEX_COUNT i32 (i32.const 4))
  (global $WHEEL_VERTEX_OFFSET i32 (i32.const 8))

  ;; Result offsets
  (global $RESULT_FINISH_TICKS i32 (i32.const 0))
  (global $RESULT_STUCK i32 (i32.const 4))
  (global $RESULT_SWAP_LOG_OFFSET i32 (i32.const 8))
  (global $RESULT_SWAP_LOG_COUNT i32 (i32.const 12))

  ;; State offsets
  (global $STATE_SIM_TICK i32 (i32.const 0))
  (global $STATE_FINISHED i32 (i32.const 4))
  (global $STATE_STUCK i32 (i32.const 8))
  (global $STATE_SWAPS_APPLIED i32 (i32.const 12))
  (global $STATE_CHASSIS_X i32 (i32.const 16))
  (global $STATE_CHASSIS_Y i32 (i32.const 20))

  ;; Memory export (2 pages = 128KB)
  (memory (export "memory") 2)

  ;; Helper: Convert i16 (hundredths) to f32
  (func $i16_to_f32 (param $value i32) (result f32)
    local.get $value
    f32.convert_i32_s
    f32.const 0.01
    f32.mul
  )

  ;; Helper: Calculate wheel radius from vertex descriptor
  ;; Returns radius in meters
  (func $calculate_radius_from_descriptor (param $vertex_offset i32) (param $vertex_count i32) (result f32)
    (local $i i32)
    (local $max_dist_sq f32)
    (local $v_base_addr i32)
    (local $v_addr i32)
    (local $v_x i32)
    (local $v_y i32)
    (local $vx f32)
    (local $vy f32)
    (local $dist_sq f32)

    ;; Initialize max_dist_sq to 0
    f32.const 0.0
    local.set $max_dist_sq

    ;; Calculate base address for this wheel's vertices
    ;; Each vertex is 4 bytes (2 i16 values), vertex_offset is in vertices
    global.get $VERTEX_BUFFER_OFFSET
    local.get $vertex_offset
    i32.const 4
    i32.mul
    i32.add
    local.set $v_base_addr

    ;; Loop through vertices to find maximum distance from origin
    i32.const 0
    local.set $i
    (block $break
      (loop $continue
        local.get $i
        local.get $vertex_count
        i32.ge_u
        br_if $break

        ;; Read vertex at index i
        ;; vertex address = v_base_addr + i * 4
        local.get $v_base_addr
        local.get $i
        i32.const 4
        i32.mul
        i32.add
        local.set $v_addr

        ;; Load x (signed i16)
        local.get $v_addr
        i32.load16_s
        local.set $v_x

        ;; Load y (offset by 2 bytes, signed i16)
        local.get $v_addr
        i32.const 2
        i32.add
        i32.load16_s
        local.set $v_y

        ;; Convert to f32 and calculate squared distance
        local.get $v_x
        call $i16_to_f32
        local.set $vx
        local.get $v_y
        call $i16_to_f32
        local.set $vy

        ;; Calculate dist_sq = vx^2 + vy^2
        local.get $vx
        local.get $vx
        f32.mul
        local.get $vy
        local.get $vy
        f32.mul
        f32.add
        local.set $dist_sq

        ;; Update max_dist_sq if this vertex is farther from origin
        local.get $dist_sq
        local.get $max_dist_sq
        f32.gt
        if
          local.get $dist_sq
          local.set $max_dist_sq
        end

        ;; Increment i and continue
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $continue
      )
    )

    ;; Return sqrt of max squared distance
    local.get $max_dist_sq
    f32.sqrt
  )

  ;; Helper: Recalculate velocity from wheel radius
  (func $recalculate_velocity
    global.get $MOTOR_SPEED
    global.get $wheel_radius
    f32.mul
    global.get $EFFICIENCY
    f32.mul
    global.set $velocity_x
  )

  ;; Helper: Find and apply wheel swap for current tick
  ;; Returns 1 if swap was applied, 0 otherwise
  (func $apply_wheel_swap (param $current_tick i32) (result i32)
    (local $num_wheels i32)
    (local $i i32)
    (local $wheel_addr i32)
    (local $swap_tick i32)
    (local $vertex_count i32)
    (local $vertex_offset i32)
    (local $new_radius f32)
    (local $swap_log_count i32)
    (local $swap_log_addr i32)

    ;; Read num_wheels from header
    global.get $HEADER_OFFSET
    global.get $HEADER_NUM_WHEELS
    i32.add
    i32.load
    local.set $num_wheels

    ;; Iterate through wheel array
    i32.const 0
    local.set $i
    (block $break
      (loop $continue
        local.get $i
        local.get $num_wheels
        i32.ge_u
        br_if $break

        ;; Calculate wheel descriptor address
        global.get $WHEEL_ARRAY_OFFSET
        local.get $i
        global.get $WHEEL_DESC_SIZE
        i32.mul
        i32.add
        local.set $wheel_addr

        ;; Read swap_tick from wheel descriptor
        local.get $wheel_addr
        global.get $WHEEL_SWAP_TICK
        i32.add
        i32.load
        local.set $swap_tick

        ;; Check if this wheel's swap_tick matches current tick
        local.get $swap_tick
        local.get $current_tick
        i32.eq
        if
          ;; Match! Read wheel descriptor
          local.get $wheel_addr
          global.get $WHEEL_VERTEX_COUNT
          i32.add
          i32.load
          local.set $vertex_count

          local.get $wheel_addr
          global.get $WHEEL_VERTEX_OFFSET
          i32.add
          i32.load
          local.set $vertex_offset

          ;; Calculate new radius
          local.get $vertex_offset
          local.get $vertex_count
          call $calculate_radius_from_descriptor
          local.set $new_radius
          local.get $new_radius
          global.set $wheel_radius

          ;; Recalculate velocity with new radius
          call $recalculate_velocity

          ;; Increment swaps_applied counter
          global.get $swaps_applied
          i32.const 1
          i32.add
          global.set $swaps_applied

          ;; Log swap to result region
          ;; Get current swap log count
          global.get $RESULT_OFFSET
          global.get $RESULT_SWAP_LOG_COUNT
          i32.add
          i32.load
          local.set $swap_log_count

          ;; Calculate swap log entry address (65552 + count * 8)
          i32.const 65552
          local.get $swap_log_count
          i32.const 8
          i32.mul
          i32.add
          local.set $swap_log_addr

          ;; Write swap_tick
          local.get $swap_log_addr
          local.get $current_tick
          i32.store

          ;; Write vertex_count (offset by 4 bytes)
          local.get $swap_log_addr
          i32.const 4
          i32.add
          local.get $vertex_count
          i32.store

          ;; Increment swap log count
          global.get $RESULT_OFFSET
          global.get $RESULT_SWAP_LOG_COUNT
          i32.add
          local.get $swap_log_count
          i32.const 1
          i32.add
          i32.store

          ;; Return 1 (swap applied)
          i32.const 1
          return
        end

        ;; Increment i and continue
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $continue
      )
    )

    ;; No swap applied
    i32.const 0
  )

  ;; Export: physics_version() -> i32
  (func (export "physics_version") (result i32)
    global.get $PHYSICS_VERSION
  )

  ;; Export: wasm_validate() -> i32
  (func (export "wasm_validate") (result i32)
    global.get $PHYSICS_VERSION
    i32.const 0
    i32.gt_s
  )

  ;; Export: resim_init() -> i32
  (func (export "resim_init") (result i32)
    (local $first_wheel_addr i32)
    (local $vertex_count i32)
    (local $vertex_offset i32)
    (local $initial_radius f32)

    ;; Read first wheel descriptor (always at offset 256)
    global.get $WHEEL_ARRAY_OFFSET
    local.set $first_wheel_addr

    ;; Read vertex_count from first wheel
    local.get $first_wheel_addr
    global.get $WHEEL_VERTEX_COUNT
    i32.add
    i32.load
    local.set $vertex_count

    ;; Read vertex_offset from first wheel
    local.get $first_wheel_addr
    global.get $WHEEL_VERTEX_OFFSET
    i32.add
    i32.load
    local.set $vertex_offset

    ;; Calculate initial wheel radius
    local.get $vertex_offset
    local.get $vertex_count
    call $calculate_radius_from_descriptor
    local.set $initial_radius
    local.get $initial_radius
    global.set $wheel_radius

    ;; Calculate initial velocity
    call $recalculate_velocity

    ;; Read START_X from header and set chassis_x
    global.get $HEADER_OFFSET
    global.get $HEADER_START_X
    i32.add
    f32.load
    global.set $chassis_x

    ;; Read START_Y from header and set chassis_y
    global.get $HEADER_OFFSET
    global.get $HEADER_START_Y
    i32.add
    f32.load
    global.set $chassis_y

    ;; Read FINISH_X from header and store in global
    global.get $HEADER_OFFSET
    global.get $HEADER_FINISH_X
    i32.add
    f32.load
    global.set $finish_x_copy

    ;; Reset tick to 0
    i32.const 0
    global.set $sim_tick

    ;; Reset finished to 0
    i32.const 0
    global.set $finished

    ;; Reset stuck to 0
    i32.const 0
    global.set $stuck

    ;; Reset swaps_applied to 0
    i32.const 0
    global.set $swaps_applied

    ;; Initialize swap log: set offset to 65552, count to 0
    global.get $RESULT_OFFSET
    global.get $RESULT_SWAP_LOG_OFFSET
    i32.add
    i32.const 65552
    i32.store

    global.get $RESULT_OFFSET
    global.get $RESULT_SWAP_LOG_COUNT
    i32.add
    i32.const 0
    i32.store

    ;; Write -1 (0xFFFFFFFF) to RESULT_OFFSET for finish_ticks (not finished)
    global.get $RESULT_OFFSET
    global.get $RESULT_FINISH_TICKS
    i32.add
    i32.const -1
    i32.store

    ;; Initialize STATE region (write initial values)
    global.get $STATE_OFFSET
    global.get $STATE_SIM_TICK
    i32.add
    i32.const 0
    i32.store

    global.get $STATE_OFFSET
    global.get $STATE_CHASSIS_X
    i32.add
    global.get $chassis_x
    f32.store

    global.get $STATE_OFFSET
    global.get $STATE_CHASSIS_Y
    i32.add
    global.get $chassis_y
    f32.store

    global.get $STATE_OFFSET
    global.get $STATE_SWAPS_APPLIED
    i32.add
    global.get $swaps_applied
    i32.store

    ;; Return 1 (success)
    i32.const 1
  )

  ;; Export: resim_step() -> i32
  (func (export "resim_step") (result i32)
    (local $new_tick i32)

    ;; Check for wheel swaps at this tick (before incrementing)
    global.get $sim_tick
    call $apply_wheel_swap
    drop

    ;; Increment tick
    global.get $sim_tick
    i32.const 1
    i32.add
    local.tee $new_tick
    global.set $sim_tick

    ;; Update chassis_x: chassis_x += velocity_x * dt
    global.get $velocity_x
    global.get $DT
    f32.mul
    global.get $chassis_x
    f32.add
    global.set $chassis_x

    ;; Write sim_tick to STATE_OFFSET
    global.get $STATE_OFFSET
    global.get $STATE_SIM_TICK
    i32.add
    local.get $new_tick
    i32.store

    ;; Write chassis_x to STATE_OFFSET + 16
    global.get $STATE_OFFSET
    global.get $STATE_CHASSIS_X
    i32.add
    global.get $chassis_x
    f32.store

    ;; Write chassis_y to STATE_OFFSET + 20
    global.get $STATE_OFFSET
    global.get $STATE_CHASSIS_Y
    i32.add
    global.get $chassis_y
    f32.store

    ;; Write swaps_applied to STATE_OFFSET + 12
    global.get $STATE_OFFSET
    global.get $STATE_SWAPS_APPLIED
    i32.add
    global.get $swaps_applied
    i32.store

    ;; Write finished to STATE_OFFSET + 4
    global.get $STATE_OFFSET
    global.get $STATE_FINISHED
    i32.add
    global.get $finished
    i32.store

    ;; Write stuck to STATE_OFFSET + 8
    global.get $STATE_OFFSET
    global.get $STATE_STUCK
    i32.add
    global.get $stuck
    i32.store

    ;; Check if finished (chassis_x >= FINISH_X) and return 0 or 1
    global.get $chassis_x
    global.get $finish_x_copy
    f32.ge
    if
      ;; Finished - set finished flag
      i32.const 1
      global.set $finished

      ;; Write finish_ticks to RESULT_OFFSET
      global.get $RESULT_OFFSET
      global.get $RESULT_FINISH_TICKS
      i32.add
      local.get $new_tick
      i32.store

      ;; Write finished=1 to STATE_OFFSET + 4
      global.get $STATE_OFFSET
      global.get $STATE_FINISHED
      i32.add
      i32.const 1
      i32.store

      ;; Return 0 (finished)
      i32.const 0
      return
    end

    ;; Not finished - return 1
    i32.const 1
    return
  )

  ;; Export: resim_swap_wheel(vertexCount: i32) -> i32
  (func (export "resim_swap_wheel") (param $vertex_count i32) (result i32)
    ;; Swaps are now handled automatically in resim_step()
    ;; This function remains for backward compatibility
    i32.const 1
  )

  ;; Export: resim_is_finished() -> i32
  (func (export "resim_is_finished") (result i32)
    global.get $finished
  )

  ;; Export: resim_is_stuck() -> i32
  (func (export "resim_is_stuck") (result i32)
    global.get $stuck
  )

  ;; Export: resim_get_tick() -> i32
  (func (export "resim_get_tick") (result i32)
    global.get $sim_tick
  )

  ;; Export: resim_get_swaps_applied() -> i32
  (func (export "resim_get_swaps_applied") (result i32)
    global.get $swaps_applied
  )

  ;; Debug exports
  (func (export "debug_get_finish_x") (result f32)
    global.get $finish_x_copy
  )

  (func (export "debug_get_chassis_x") (result f32)
    global.get $chassis_x
  )

  (func (export "debug_get_velocity_x") (result f32)
    global.get $velocity_x
  )

  (func (export "debug_get_wheel_radius") (result f32)
    global.get $wheel_radius
  )
)
