import { Room, Client } from "colyseus";
import { GameState } from "../schema/GameState";
import { PlayerState } from "../schema/PlayerState";
import { BallState } from "../schema/BallState";
import { PhysicsEngine } from "../physics/PhysicsEngine";
import type { BallCrossing } from "../physics/PhysicsEngine";
import { ARENA, PHYSICS, RULES } from "@pinbuddys/shared";
import type {
  ThrowPayload,
  SelectBallPayload,
  ServerEvent,
  GamePhase,
  BallSize,
} from "@pinbuddys/shared";
import { saveMatchResult } from "../firebase/firebaseAdmin";

export class PinBuddysRoom extends Room<GameState> {
  maxClients = 2;

  private physics!: PhysicsEngine;
  private simInterval: NodeJS.Timer | null = null;
  private restTicks = 0;
  private turnBallId: string | null = null;
  private turnTimeout: NodeJS.Timeout | null = null;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onCreate(): void {
    this.setState(new GameState());
    this.physics = new PhysicsEngine();

    this.onMessage<ThrowPayload>("throw", (client, payload) =>
      this.handleThrow(client, payload),
    );
    this.onMessage<SelectBallPayload>("selectBall", (_client, _payload) => {
      // Ball size selection removed — single standard ball
    });

    console.log(`[PinBuddysRoom] Created room ${this.roomId}`);
  }

  onJoin(
    client: Client,
    options: { displayName?: string; firebaseUid?: string },
  ): void {
    const playerCount = this.state.players.size;

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.displayName = options?.displayName ?? `Player ${playerCount + 1}`;
    player.firebaseUid = options?.firebaseUid ?? "";
    player.side = playerCount === 0 ? "left" : "right";
    player.connected = true;

    this.state.players.set(client.sessionId, player);

    console.log(
      `[PinBuddysRoom] ${player.displayName} joined (side: ${player.side})`,
    );

    if (this.state.players.size === 2) {
      this.startGame();
    }
  }

  onLeave(client: Client, consented: boolean): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
    }
    if (!consented && this.state.phase !== "gameOver") {
      this.broadcast("opponentDisconnected", {
        type: "opponentDisconnected",
      } satisfies ServerEvent);
    }
  }

  onDispose(): void {
    this.stopSimulation();
    this.clearTurnTimeout();
    console.log(`[PinBuddysRoom] Disposed room ${this.roomId}`);
  }

  // ─── Game Flow ─────────────────────────────────────────────────────────────

  private startGame(): void {
    const [p1Id] = [...this.state.players.keys()];
    this.state.currentPlayerId = p1Id;
    this.setPhase("p1Turn");
    this.startTurnTimeout();
    console.log(`[PinBuddysRoom] Game started, ${p1Id} goes first`);
  }

  private setPhase(phase: GamePhase): void {
    this.state.phase = phase;
  }

  // ─── Message Handlers ──────────────────────────────────────────────────────

  private handleThrow(client: Client, payload: ThrowPayload): void {
    if (client.sessionId !== this.state.currentPlayerId) return;
    if (!["p1Turn", "p2Turn", "bonusTurn"].includes(this.state.phase)) return;

    this.clearTurnTimeout();

    const size: BallSize = "medium";

    // Create a new ball in state + physics
    const ballId = `ball_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const throwerSide = this.state.players.get(client.sessionId)!.side;
    const startX =
      throwerSide === "left" ? ARENA.CENTER_X / 2 : ARENA.WIDTH * 0.75;
    const startY = ARENA.HEIGHT / 2;

    // Add to Colyseus state
    const ball = new BallState();
    ball.id = ballId;
    ball.ownerId = client.sessionId;
    ball.size = size;
    ball.x = startX;
    ball.y = startY;
    ball.isActive = true;
    this.state.balls.push(ball);

    // Add to physics engine
    this.physics.addBall(ballId, size, startX, startY);

    // Apply flick velocity
    this.physics.applyThrow(ballId, payload);

    this.turnBallId = ballId;
    this.setPhase("simulating");
    this.startSimulation();
  }

  // ─── Physics Simulation Loop ───────────────────────────────────────────────

  private startSimulation(): void {
    if (this.simInterval) return;
    this.restTicks = 0;

    this.simInterval = setInterval(
      () => this.simulationTick(),
      PHYSICS.DELTA_MS,
    );
  }

  private stopSimulation(): void {
    if (this.simInterval) {
      clearInterval(this.simInterval as NodeJS.Timeout);
      this.simInterval = null;
    }
  }

  private simulationTick(): void {
    const { snapshots, crossings } = this.physics.step();

    // Sync positions to Colyseus state (active balls only)
    for (const snap of snapshots) {
      const ballState = this.state.balls.find(
        (b: BallState) => b.id === snap.id,
      );
      if (ballState) {
        ballState.x = Math.round(snap.x * 10) / 10;
        ballState.y = Math.round(snap.y * 10) / 10;
        ballState.velX = Math.round(snap.velX * 100) / 100;
        ballState.velY = Math.round(snap.velY * 100) / 100;
      }
    }

    // Running tally: process center-line crossings immediately
    for (const crossing of crossings) {
      this.processCrossing(crossing);
      if (this.state.phase === "gameOver") return;
    }

    if (!this.turnBallId) return;

    // Check for out-of-bounds on the turn ball
    const oob = this.physics.isBallOutOfBounds(this.turnBallId);
    if (oob.oob) {
      this.stopSimulation();
      this.evaluateCapturedBall();
      return;
    }

    // Wait for ALL balls to come to rest before ending the turn
    if (this.physics.areAllBallsAtRest()) {
      this.restTicks++;
      if (this.restTicks >= PHYSICS.REST_TICKS_REQUIRED) {
        this.stopSimulation();
        this.finalizeRound();
      }
    } else {
      this.restTicks = 0;
    }
  }

  // ─── Round Evaluation ──────────────────────────────────────────────────────

  /** Ball crossed the center line — update running tally immediately. */
  private processCrossing(crossing: BallCrossing): void {
    const ballState = this.state.balls.find(
      (b: BallState) => b.id === crossing.ballId && b.isActive,
    );
    if (!ballState) return;

    const playerList = [...this.state.players.keys()];
    const isP1 = playerList[0] === ballState.ownerId;
    const ownerSide = this.state.players.get(ballState.ownerId)?.side;
    const crossedToOpponent = crossing.to !== ownerSide;
    const delta = crossedToOpponent ? 1 : -1;

    if (isP1) {
      this.state.p1Score = Math.max(0, this.state.p1Score + delta);
    } else {
      this.state.p2Score = Math.max(0, this.state.p2Score + delta);
    }

    this.broadcast("scored", {
      type: "scored",
      scorerId: ballState.ownerId,
      newScore: { p1: this.state.p1Score, p2: this.state.p2Score },
    });

    if (
      this.state.p1Score >= RULES.WIN_SCORE ||
      this.state.p2Score >= RULES.WIN_SCORE
    ) {
      this.stopSimulation();
      const winnerId =
        this.state.p1Score >= RULES.WIN_SCORE ? playerList[0] : playerList[1];
      this.endGame(winnerId);
    }
  }

  /** All balls at rest — ball stays on field, just advance turn. */
  private finalizeRound(): void {
    this.turnBallId = null;
    this.advanceTurn();
  }

  private evaluateCapturedBall(): void {
    this.setPhase("roundEval");
    if (!this.turnBallId) return;

    const throwerId = this.state.currentPlayerId;
    const opponentId = this.getOpponentId(throwerId);

    // Mark the ball as captured by opponent and remove from physics
    const ballState = this.state.balls.find(
      (b: BallState) => b.id === this.turnBallId,
    );
    if (ballState) {
      ballState.isActive = false;
      ballState.heldBy = opponentId;
    }

    this.physics.removeBall(this.turnBallId!);
    this.turnBallId = null;

    // Notify clients
    this.broadcast("ballCaptured", {
      type: "ballCaptured",
      capturedBy: opponentId,
      ballId: ballState?.id ?? "",
    });
    this.broadcast("bonusThrow", {
      type: "bonusThrow",
      playerId: opponentId,
    });

    // Award bonus throw to opponent
    this.state.bonusBallHolderId = opponentId;
    this.state.currentPlayerId = opponentId;
    this.setPhase("bonusTurn");
    this.startTurnTimeout();
  }

  private advanceTurn(): void {
    this.state.bonusBallHolderId = "";

    const throwerId = this.state.currentPlayerId;
    const opponentId = this.getOpponentId(throwerId);

    // Balls persist on the field — no cleanup here
    this.state.currentPlayerId = opponentId;
    const playerList = [...this.state.players.keys()];
    const isOpponentP1 = playerList[0] === opponentId;
    this.setPhase(isOpponentP1 ? "p1Turn" : "p2Turn");
    this.startTurnTimeout();
  }

  private endGame(winnerId: string): void {
    this.state.winnerId = winnerId;
    this.setPhase("gameOver");
    this.broadcast("gameOver", {
      type: "gameOver",
      winnerId,
      finalScore: { p1: this.state.p1Score, p2: this.state.p2Score },
    });

    // Persist match result
    const playerList = [...this.state.players.values()];
    if (playerList.length === 2) {
      saveMatchResult({
        matchId: this.roomId,
        p1Uid: playerList[0].firebaseUid,
        p2Uid: playerList[1].firebaseUid,
        p1Score: this.state.p1Score,
        p2Score: this.state.p2Score,
        winnerId: this.state.players.get(winnerId)?.firebaseUid ?? "",
        playedAt: Date.now(),
        mode: "online",
      }).catch(console.error);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private getOpponentId(playerId: string): string {
    for (const id of this.state.players.keys()) {
      if (id !== playerId) return id;
    }
    return "";
  }

  private startTurnTimeout(): void {
    this.clearTurnTimeout();
    this.turnTimeout = setTimeout(() => {
      // Auto-pass: treat as empty turn
      this.advanceTurn();
    }, RULES.TURN_TIMEOUT_SEC * 1000);
  }

  private clearTurnTimeout(): void {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
      this.turnTimeout = null;
    }
  }
}
