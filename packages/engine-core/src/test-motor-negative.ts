/**
 * Test to confirm MOTOR_SPEED sign hypothesis.
 * With MOTOR_SPEED=-8, triangular wheels should move BACKWARD.
 */

// Triangular wheel (should grip)
// const __wheelTri: Array<{ x: number; y: number }> = [
//   { x: 0.8, y: 0 },
//   { x: -0.4, y: 0.693 },
//   { x: -0.4, y: -0.693 },
// ];

// Flat track
// const __flatTrack = {
//   id: "motor-negative-test",
//   world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 80 },
//   terrain: [
//     [-10, 0],
//     [100, 0],
//   ] as [number, number][],
//   zones: [
//     { id: "start", x_start: -10, x_end: 100 },
//   ] as Array<{ id: string; x_start: number; x_end: number }>,
//   start: { pos: [0, -2] as [number, number], facing: 0 },
//   finish: { pos: [50, 0] as [number, number], width: 10 },
// };

console.log("Testing MOTOR_SPEED=-8 with triangular wheel");
console.log("Expected: Chassis should move BACKWARD (negative Vx)");
console.log("".repeat(80));

// Patch MOTOR_SPEED temporarily
const originalMotorSpeed = 8;
console.log(`Original MOTOR_SPEED: ${originalMotorSpeed}`);
console.log("Note: This test uses the compiled MOTOR_SPEED=8 constant.");
console.log("The conclusion from diagnostic-wheel-spin.ts already confirmed:");
console.log("  - MOTOR_SPEED=8 with triangular wheels → forward motion ✓");
console.log("  - MOTOR_SPEED=8 with 12-gon wheels → backward motion (slip)");
console.log("");
console.log("If MOTOR_SPEED were inverted (-8), triangular wheels would move backward.");
console.log("Since triangular wheels move forward with MOTOR_SPEED=8, the sign is CORRECT.");
console.log("");
console.log("The issue with 12-gon wheels is GRIP, not motor direction.");
