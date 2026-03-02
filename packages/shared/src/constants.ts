// ─── Arena ────────────────────────────────────────────────────────────────────
// The server uses these as the authoritative world dimensions.
// The client scales the render to match the device, but physics stays in these units.

export const ARENA = {
  WIDTH: 800,        // total arena width
  HEIGHT: 480,       // total arena height
  WALL_THICKNESS: 20,
  CENTER_X: 400,     // x position of the dividing line

  // The "too far" zone — ball exits here = opponent captures it
  LEFT_BOUNDARY: 0,
  RIGHT_BOUNDARY: 800,

  // Scoring zone: ball must be fully within opponent half (with a small buffer)
  SCORE_BUFFER: 10,  // px — ball centre must be at least this far from center line

  // Endzones — back ~19% of each player's side
  LEFT_ENDZONE_END: 100,     // P1 throws from x=0..100
  RIGHT_ENDZONE_START: 700,  // P2 throws from x=700..800

  /** Starting number of balls per player */
  INITIAL_ROSTER_SIZE: 4,
} as const;

// ─── Physics Simulation ───────────────────────────────────────────────────────

export const PHYSICS = {
  /** Target simulation rate in Hz */
  SIM_HZ: 60,
  /** deltaTime passed to Matter.js Engine.update() */
  DELTA_MS: 1000 / 60,
  /** Ball is considered "stopped" when speed < this (px/s) */
  REST_SPEED_THRESHOLD: 0.8,
  /** Number of consecutive ticks at rest before declaring all balls stopped */
  REST_TICKS_REQUIRED: 20,
  /** Cap on flick velocity in arena px/step passed to Matter.js setVelocity */
  MAX_FLICK_VELOCITY: 28,
  /** Gravity scale — low, almost top-down friction feel */
  GRAVITY_SCALE: 0.0,
} as const;

// ─── Game Rules ───────────────────────────────────────────────────────────────

export const RULES = {
  /** Points needed to win the match */
  WIN_SCORE: 5,
  /** Seconds a player has to throw before auto-pass */
  TURN_TIMEOUT_SEC: 30,
} as const;

// ─── Colyseus ─────────────────────────────────────────────────────────────────

export const ROOM_NAME = "pinbuddys";

// ─── Firebase collections ─────────────────────────────────────────────────────

export const FIRESTORE = {
  USERS: "users",
  MATCHES: "matches",
  LEADERBOARD: "leaderboard",
} as const;
