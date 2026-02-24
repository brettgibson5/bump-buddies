import Matter from "matter-js";
import { ARENA, PHYSICS, BALL_PHYSICS } from "@pinbuddys/shared";
import type { BallSize, ThrowPayload } from "@pinbuddys/shared";

const { Engine, World, Bodies, Body } = Matter;

export interface BallSnapshot {
  id: string;
  x: number;
  y: number;
  velX: number;
  velY: number;
}

export interface BallCrossing {
  ballId: string;
  from: "left" | "right";
  to: "left" | "right";
}

/**
 * Server-side Matter.js wrapper.
 * Runs a headless physics world used by PinBuddysRoom.
 * All coordinates are in ARENA units (800×480).
 */
export class PhysicsEngine {
  private engine: Matter.Engine;
  private world: Matter.World;
  /** Map from ball id → Matter body */
  private bodies = new Map<string, Matter.Body>();
  /** Last known non-center half for each ball (used for crossing detection) */
  private ballHalves = new Map<string, "left" | "right">();

  constructor() {
    this.engine = Engine.create({
      gravity: { x: 0, y: PHYSICS.GRAVITY_SCALE },
    });
    this.world = this.engine.world;
    this.buildArena();
  }

  // ─── Setup ─────────────────────────────────────────────────────────────────

  private buildArena(): void {
    const W = ARENA.WIDTH;
    const H = ARENA.HEIGHT;
    const T = ARENA.WALL_THICKNESS;

    // Top wall, bottom wall, left wall, right wall (static bodies)
    const walls = [
      Bodies.rectangle(W / 2, -T / 2, W, T, { isStatic: true, label: "wallTop" }),
      Bodies.rectangle(W / 2, H + T / 2, W, T, { isStatic: true, label: "wallBottom" }),
      Bodies.rectangle(-T / 2, H / 2, T, H, { isStatic: true, label: "wallLeft" }),
      Bodies.rectangle(W + T / 2, H / 2, T, H, { isStatic: true, label: "wallRight" }),
    ];
    World.add(this.world, walls);
  }

  // ─── Ball management ───────────────────────────────────────────────────────

  addBall(id: string, _size: BallSize, x: number, y: number): void {
    const consts = BALL_PHYSICS["medium"];
    const body = Bodies.circle(x, y, consts.radius, {
      mass: consts.mass,
      frictionAir: consts.frictionAir,
      restitution: consts.restitution,
      friction: consts.friction,
      frictionStatic: consts.frictionStatic,
      label: id,
    });
    this.bodies.set(id, body);
    this.ballHalves.set(id, x < ARENA.CENTER_X ? "left" : "right");
    World.add(this.world, body);
  }

  removeBall(id: string): void {
    const body = this.bodies.get(id);
    if (body) {
      World.remove(this.world, body);
      this.bodies.delete(id);
    }
    this.ballHalves.delete(id);
  }

  /**
   * Apply a flick impulse to an existing ball body.
   * `payload.vx` and `payload.vy` are arena px per Matter.js step.
   */
  applyThrow(ballId: string, payload: ThrowPayload): void {
    const body = this.bodies.get(ballId);
    if (!body) return;
    Body.setVelocity(body, { x: payload.vx, y: payload.vy });
  }

  // ─── Simulation ────────────────────────────────────────────────────────────

  /**
   * Advance the simulation by one tick (1/60 s).
   * Returns snapshots of all tracked balls plus any center-line crossings.
   */
  step(): { snapshots: BallSnapshot[]; crossings: BallCrossing[] } {
    Engine.update(this.engine, PHYSICS.DELTA_MS);
    const crossings = this.detectCrossings();
    return { snapshots: this.snapshots(), crossings };
  }

  snapshots(): BallSnapshot[] {
    const result: BallSnapshot[] = [];
    for (const [id, body] of this.bodies) {
      result.push({
        id,
        x: body.position.x,
        y: body.position.y,
        velX: body.velocity.x,
        velY: body.velocity.y,
      });
    }
    return result;
  }

  /**
   * Detect which balls crossed the center line this tick.
   * Uses hysteresis: only updates registered side when ball is outside the
   * SCORE_BUFFER zone, preventing rapid oscillation near center.
   */
  private detectCrossings(): BallCrossing[] {
    const crossings: BallCrossing[] = [];
    for (const [id, body] of this.bodies) {
      const x = body.position.x;
      let currSide: "left" | "right" | "center";
      if (x < ARENA.CENTER_X - ARENA.SCORE_BUFFER) currSide = "left";
      else if (x > ARENA.CENTER_X + ARENA.SCORE_BUFFER) currSide = "right";
      else currSide = "center";

      if (currSide !== "center") {
        const lastSide = this.ballHalves.get(id);
        if (lastSide && lastSide !== currSide) {
          crossings.push({ ballId: id, from: lastSide, to: currSide });
        }
        this.ballHalves.set(id, currSide);
      }
      // If in center buffer zone: keep last known side, no crossing registered
    }
    return crossings;
  }

  isBallAtRest(id: string): boolean {
    const body = this.bodies.get(id);
    if (!body) return true;
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    return speed < PHYSICS.REST_SPEED_THRESHOLD;
  }

  /** Returns true when every tracked ball is below the rest speed threshold. */
  areAllBallsAtRest(): boolean {
    for (const body of this.bodies.values()) {
      if (Math.hypot(body.velocity.x, body.velocity.y) >= PHYSICS.REST_SPEED_THRESHOLD) {
        return false;
      }
    }
    return true;
  }

  getBallPosition(id: string): { x: number; y: number } | null {
    const body = this.bodies.get(id);
    if (!body) return null;
    return { x: body.position.x, y: body.position.y };
  }

  isBallOutOfBounds(id: string): { oob: boolean; side: "left" | "right" | null } {
    const body = this.bodies.get(id);
    if (!body) return { oob: false, side: null };
    if (body.position.x < ARENA.LEFT_BOUNDARY) return { oob: true, side: "left" };
    if (body.position.x > ARENA.RIGHT_BOUNDARY) return { oob: true, side: "right" };
    return { oob: false, side: null };
  }

  /** Determine which half a ball is on once at rest */
  getBallHalf(id: string): "left" | "right" | "center" | null {
    const pos = this.getBallPosition(id);
    if (!pos) return null;
    if (pos.x < ARENA.CENTER_X - ARENA.SCORE_BUFFER) return "left";
    if (pos.x > ARENA.CENTER_X + ARENA.SCORE_BUFFER) return "right";
    return "center";
  }

  reset(): void {
    World.clear(this.world, false);
    Engine.clear(this.engine);
    this.bodies.clear();
    this.ballHalves.clear();
    this.buildArena();
  }
}
