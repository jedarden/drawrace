import { World, Vec2, Edge, Box, WheelJoint, Polygon } from "planck";
import { buildWheelBody } from "./swap.js";

const DT = 1/60, VI = 8, PI_ITER = 3;
const MOTOR_SPEED = 8, MOTOR_MAX_TORQUE = 40;
const SUSPENSION_FREQ_HZ = 2.5, SUSPENSION_DAMPING_RATIO = 0.7;
const WHEEL_DENSITY = 1.0, WHEEL_FRICTION = 2.5, WHEEL_RESTITUTION = 0.3;
const CHASSIS_DENSITY = 1.0;
const angDamp = 5, spring = 500, threshold = Math.PI/6, extraDamp = 0;

const world = new World({ x: 0, y: 10 });
const ground = world.createBody();
ground.createFixture(Edge(Vec2(-10, 0), Vec2(100, 0)), { friction: 0.9, restitution: 0.0 });
const leftBarrier = world.createBody({ position: Vec2(-1.8, -2), type: "static" });
leftBarrier.createFixture(Box(0.05, 10), { friction: 0.0, restitution: 0.0 });

const startX = 0, terrainY = 0, wheelRadius = 0.8;
const wheelSpawnY = terrainY - wheelRadius;
const wv: [number, number][] = [[0.8, 0], [-0.4, 0.693], [-0.4, -0.693]];

// Front wheel — direct Polygon, like race-sim.ts
const wheelBody = world.createBody({ position: Vec2(startX, wheelSpawnY), type: "dynamic" });
wheelBody.createFixture(Polygon(wv.map(v => Vec2(v[0], v[1]))), { density: WHEEL_DENSITY, friction: WHEEL_FRICTION, restitution: WHEEL_RESTITUTION });

const chassisSpawnY = wheelSpawnY - 1.5;
const chassisBody = world.createBody({ position: Vec2(startX, chassisSpawnY), type: "dynamic", angularDamping: angDamp });
chassisBody.createFixture(Box(1.2, 0.4), { density: CHASSIS_DENSITY, friction: 0.5, restitution: 0.1 });

const rearWheelBody = buildWheelBody(world, wv, startX - 0.9, wheelSpawnY);

world.createJoint(WheelJoint({ bodyA: chassisBody, bodyB: wheelBody, localAnchorA: Vec2(0.5, 0.5), localAnchorB: Vec2(0, 0), localAxisA: Vec2(0, 1), frequencyHz: SUSPENSION_FREQ_HZ, dampingRatio: SUSPENSION_DAMPING_RATIO, enableMotor: true, motorSpeed: MOTOR_SPEED, maxMotorTorque: MOTOR_MAX_TORQUE }));
world.createJoint(WheelJoint({ bodyA: chassisBody, bodyB: rearWheelBody, localAnchorA: Vec2(-0.9, 0.5), localAnchorB: Vec2(0, 0), localAxisA: Vec2(0, 1), frequencyHz: SUSPENSION_FREQ_HZ, dampingRatio: SUSPENSION_DAMPING_RATIO, enableMotor: true, motorSpeed: MOTOR_SPEED, maxMotorTorque: MOTOR_MAX_TORQUE }));

console.log("Tick | FrontAngVel | RearAngVel  | ChassisVx | ChassisX  | ChassisAngle");
for (let t = 0; t < 30; t++) {
  const ra = chassisBody.getAngle(), rv = chassisBody.getAngularVelocity();
  const excess = Math.abs(ra) > threshold ? ra - Math.sign(ra) * threshold : 0;
  chassisBody.applyTorque(-spring * excess - extraDamp * rv);
  world.step(DT, VI, PI_ITER);
  const cp = chassisBody.getPosition();
  const cv = chassisBody.getLinearVelocity();
  const fw = wheelBody.getAngularVelocity();
  const rw = rearWheelBody.getAngularVelocity();
  if (t < 6 || t % 5 === 0)
    console.log(`  ${t.toString().padStart(3)} | ${fw.toFixed(2).padStart(11)} | ${rw.toFixed(2).padStart(11)} | ${cv.x.toFixed(2).padStart(9)} | ${cp.x.toFixed(3).padStart(9)} | ${(ra*180/Math.PI).toFixed(1)}°`);
}
console.log("Final chassisX:", chassisBody.getPosition().x.toFixed(3));
