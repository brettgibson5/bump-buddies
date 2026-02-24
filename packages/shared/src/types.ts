// ─── Ball ─────────────────────────────────────────────────────────────────────

export type BallSize = "small" | "medium" | "large";

export interface BallPhysicsConstants {
  radius: number;
  mass: number;
  frictionAir: number;   // air resistance (0–1); higher = stops faster
  restitution: number;   // bounciness (0–1)
  frictionStatic: number;
  friction: number;
}

export const BALL_PHYSICS: Record<BallSize, BallPhysicsConstants> = {
  small: {
    radius: 18,
    mass: 0.5,
    frictionAir: 0.04,
    restitution: 0.55,
    frictionStatic: 0.05,
    friction: 0.02,
  },
  medium: {
    radius: 22,
    mass: 1.0,
    frictionAir: 0.012,
    restitution: 0.65,
    frictionStatic: 0.02,
    friction: 0.01,
  },
  large: {
    radius: 40,
    mass: 3.0,
    frictionAir: 0.075,
    restitution: 0.25,
    frictionStatic: 0.1,
    friction: 0.07,
  },
};

// ─── Game Phase / State ───────────────────────────────────────────────────────

export type GamePhase =
  | "waiting"      // room created, waiting for 2nd player
  | "p1Turn"       // player 1 aims & throws
  | "p2Turn"       // player 2 aims & throws
  | "bonusTurn"    // a player was awarded a bonus ball to throw
  | "simulating"   // physics running server-side
  | "roundEval"    // brief pause, server evaluating result
  | "gameOver";    // match finished

export type PlayerSide = "left" | "right";

// ─── Messages (client → server) ───────────────────────────────────────────────

export interface ThrowPayload {
  /** Arena px per Matter.js step, rightward positive */
  vx: number;
  /** Arena px per Matter.js step, downward positive */
  vy: number;
}

export interface SelectBallPayload {
  size: BallSize;
}

// ─── Events (server → client, outside Colyseus schema) ────────────────────────

export type ServerEvent =
  | { type: "scored"; scorerId: string; newScore: { p1: number; p2: number } }
  | { type: "ballCaptured"; capturedBy: string; ballId: string }
  | { type: "bonusThrow"; playerId: string }
  | { type: "gameOver"; winnerId: string; finalScore: { p1: number; p2: number } }
  | { type: "opponentDisconnected" }
  | { type: "opponentReconnected" };

// ─── Firestore data shapes (shared for type safety) ───────────────────────────

export interface UserProfile {
  uid: string;
  displayName: string;
  avatarUrl?: string;
  wins: number;
  losses: number;
  points: number;
  createdAt: number; // epoch ms
}

export interface MatchRecord {
  matchId: string;
  p1Uid: string;
  p2Uid: string;
  p1Score: number;
  p2Score: number;
  winnerId: string;
  playedAt: number; // epoch ms
  mode: "online" | "local";
}
