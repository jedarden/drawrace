use std::collections::VecDeque;

use drawrace_api::blob::WheelEntry;

/// Maximum accepted difference (inclusive) between server and client finish ticks.
pub const FINISH_TICK_TOLERANCE: u32 = 2;

/// Manages the pending wheel-swap queue during re-simulation.
///
/// Swaps are consumed in ascending `swap_tick` order. At each sim tick,
/// call `pop_if_due(sim_tick)` to apply the wheel scheduled for that tick
/// (if any). The initial wheel (swap_tick == 0) is popped at tick 0.
pub struct SwapScheduler {
    pending: VecDeque<WheelEntry>,
}

impl SwapScheduler {
    pub fn new(wheels: Vec<WheelEntry>) -> Self {
        Self {
            pending: wheels.into_iter().collect(),
        }
    }

    /// If the next pending swap is scheduled for `sim_tick`, pops and returns it.
    /// Returns `None` if no swap is due at this tick.
    pub fn pop_if_due(&mut self, sim_tick: u32) -> Option<WheelEntry> {
        if self
            .pending
            .front()
            .map_or(false, |w| w.swap_tick == sim_tick)
        {
            self.pending.pop_front()
        } else {
            None
        }
    }

    /// The tick of the next pending swap, if any remain.
    pub fn next_swap_tick(&self) -> Option<u32> {
        self.pending.front().map(|w| w.swap_tick)
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    pub fn remaining(&self) -> usize {
        self.pending.len()
    }
}

/// Result of a re-simulation run.
pub struct ResimResult {
    /// The tick at which the finish line was crossed, or `None` on timeout.
    pub finish_ticks: Option<u32>,
    /// Log of `(swap_tick, vertex_count)` for each applied swap.
    pub swaps_applied: Vec<(u32, u8)>,
}

/// Run a stub re-simulation.
///
/// Exercises the `SwapScheduler` infrastructure: the initial wheel fires at
/// tick 0, and each subsequent swap fires at its recorded `swap_tick`. The
/// stub reports finish at `claimed_finish_ticks` rather than computing actual
/// Planck.js physics.
///
/// NOTE: This is a scaffold for the full WASM-based re-sim. Once
/// `engine-core.wasm` is compiled, the loop body will drive the Planck.js
/// world and detect the finish line via the physics state; `claimed_finish_ticks`
/// will become a validation target rather than the loop termination condition.
pub fn run_resim_stub(wheels: &[WheelEntry], claimed_finish_ticks: u32) -> ResimResult {
    let mut scheduler = SwapScheduler::new(wheels.to_vec());
    let mut swaps_applied = Vec::new();

    // 2× claimed finish or the 90-second floor, whichever is larger.
    let timeout_ticks = claimed_finish_ticks.saturating_mul(2).max(90 * 60);

    for sim_tick in 0..=timeout_ticks {
        // Apply the swap (if any) scheduled for this tick.
        // The initial wheel fires here at tick 0.
        if let Some(wheel) = scheduler.pop_if_due(sim_tick) {
            swaps_applied.push((wheel.swap_tick, wheel.vertex_count));
        }

        // Stub finish detection: the full WASM re-sim will check the physics
        // world for finish-line crossing instead.
        if sim_tick == claimed_finish_ticks {
            return ResimResult {
                finish_ticks: Some(sim_tick),
                swaps_applied,
            };
        }
    }

    ResimResult {
        finish_ticks: None,
        swaps_applied,
    }
}

/// Returns true if `|server_ticks - client_ticks| <= FINISH_TICK_TOLERANCE`.
pub fn finish_within_tolerance(server_ticks: u32, client_ticks: u32) -> bool {
    server_ticks.abs_diff(client_ticks) <= FINISH_TICK_TOLERANCE
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_wheel(swap_tick: u32, vertex_count: u8) -> WheelEntry {
        WheelEntry {
            swap_tick,
            vertex_count,
            polygon_vertices: (0..vertex_count).map(|i| (i as i16, i as i16)).collect(),
        }
    }

    // ── SwapScheduler tests ───────────────────────────────────────────────────

    #[test]
    fn scheduler_initial_wheel_at_tick_zero() {
        let mut sched = SwapScheduler::new(vec![make_wheel(0, 12)]);
        let w = sched.pop_if_due(0);
        assert!(w.is_some());
        assert_eq!(w.unwrap().swap_tick, 0);
        assert!(sched.is_empty());
    }

    #[test]
    fn scheduler_no_swap_before_due_tick() {
        let mut sched = SwapScheduler::new(vec![make_wheel(0, 12), make_wheel(60, 10)]);
        let _ = sched.pop_if_due(0); // consume initial
        assert!(sched.pop_if_due(30).is_none());
        assert!(sched.pop_if_due(59).is_none());
        let w = sched.pop_if_due(60);
        assert!(w.is_some());
        assert_eq!(w.unwrap().swap_tick, 60);
    }

    #[test]
    fn scheduler_applies_five_swaps_in_order() {
        let ticks = [0u32, 60, 120, 180, 240, 300];
        let wheels: Vec<WheelEntry> = ticks.iter().map(|&t| make_wheel(t, 12)).collect();
        let mut sched = SwapScheduler::new(wheels);
        for &t in &ticks {
            let w = sched.pop_if_due(t);
            assert!(w.is_some(), "swap should fire at tick {t}");
            assert_eq!(w.unwrap().swap_tick, t);
        }
        assert!(sched.is_empty());
    }

    #[test]
    fn scheduler_twenty_swaps_all_consumed() {
        let wheels: Vec<WheelEntry> = (0..21u32).map(|i| make_wheel(i * 60, 12)).collect();
        let mut sched = SwapScheduler::new(wheels);
        for i in 0..21u32 {
            let w = sched.pop_if_due(i * 60);
            assert!(w.is_some(), "swap {i} should fire");
        }
        assert!(sched.is_empty());
    }

    #[test]
    fn scheduler_next_swap_tick_tracks_queue() {
        let wheels = vec![
            make_wheel(0, 12),
            make_wheel(90, 10),
            make_wheel(180, 8),
        ];
        let mut sched = SwapScheduler::new(wheels);
        assert_eq!(sched.next_swap_tick(), Some(0));
        let _ = sched.pop_if_due(0);
        assert_eq!(sched.next_swap_tick(), Some(90));
        let _ = sched.pop_if_due(90);
        assert_eq!(sched.next_swap_tick(), Some(180));
        let _ = sched.pop_if_due(180);
        assert_eq!(sched.next_swap_tick(), None);
        assert!(sched.is_empty());
    }

    #[test]
    fn scheduler_remaining_decrements() {
        let mut sched = SwapScheduler::new(vec![
            make_wheel(0, 12),
            make_wheel(60, 10),
            make_wheel(120, 8),
        ]);
        assert_eq!(sched.remaining(), 3);
        let _ = sched.pop_if_due(0);
        assert_eq!(sched.remaining(), 2);
        let _ = sched.pop_if_due(60);
        assert_eq!(sched.remaining(), 1);
        let _ = sched.pop_if_due(120);
        assert_eq!(sched.remaining(), 0);
    }

    // ── finish_within_tolerance tests ─────────────────────────────────────────

    #[test]
    fn tolerance_exact_match() {
        assert!(finish_within_tolerance(1706, 1706));
    }

    #[test]
    fn tolerance_one_tick_delta() {
        assert!(finish_within_tolerance(1707, 1706));
        assert!(finish_within_tolerance(1705, 1706));
    }

    #[test]
    fn tolerance_two_tick_delta() {
        assert!(finish_within_tolerance(1708, 1706));
        assert!(finish_within_tolerance(1704, 1706));
    }

    #[test]
    fn tolerance_three_tick_delta_fails() {
        assert!(!finish_within_tolerance(1709, 1706));
        assert!(!finish_within_tolerance(1703, 1706));
    }

    // ── run_resim_stub tests ──────────────────────────────────────────────────

    #[test]
    fn stub_resim_single_wheel_finishes_at_claimed_tick() {
        let wheels = vec![make_wheel(0, 12)];
        let claimed = 1706u32;
        let result = run_resim_stub(&wheels, claimed);
        assert_eq!(result.finish_ticks, Some(claimed));
        assert_eq!(result.swaps_applied.len(), 1);
        assert_eq!(result.swaps_applied[0].0, 0);
    }

    #[test]
    fn stub_resim_five_swaps_all_applied() {
        let wheels: Vec<WheelEntry> = (0..6u32).map(|i| make_wheel(i * 60, 12)).collect();
        let claimed = 2400u32;
        let result = run_resim_stub(&wheels, claimed);
        assert_eq!(result.finish_ticks, Some(claimed));
        assert_eq!(result.swaps_applied.len(), 6);
        for (i, &(tick, _)) in result.swaps_applied.iter().enumerate() {
            assert_eq!(tick, i as u32 * 60, "swap {i} should fire at tick {}", i * 60);
        }
    }

    #[test]
    fn stub_resim_twenty_swaps_all_applied() {
        let wheels: Vec<WheelEntry> = (0..21u32).map(|i| make_wheel(i * 60, 12)).collect();
        let claimed = 3600u32;
        let result = run_resim_stub(&wheels, claimed);
        assert_eq!(result.finish_ticks, Some(claimed));
        assert_eq!(result.swaps_applied.len(), 21);
    }

    #[test]
    fn stub_resim_swaps_applied_before_finish() {
        // Swap at tick 500, finish at tick 1000 — swap must be in log.
        let wheels = vec![make_wheel(0, 12), make_wheel(500, 10)];
        let result = run_resim_stub(&wheels, 1000);
        assert_eq!(result.finish_ticks, Some(1000));
        assert_eq!(result.swaps_applied.len(), 2);
        assert_eq!(result.swaps_applied[1].0, 500);
    }
}
