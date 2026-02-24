import Phaser from "phaser";
import { Arena } from "../objects/Arena";
import { Ball } from "../objects/Ball";
import { colyseusService } from "../network/ColyseusClient";
import { ARENA, PHYSICS, BALL_PHYSICS, RULES } from "@pinbuddys/shared";
import type {
  GamePhase,
  ServerEvent,
  ThrowPayload,
} from "@pinbuddys/shared";

// Matter.js (browser build) — used for LOCAL mode physics only
import Matter from "matter-js";

const SLINGSHOT_HIT_RADIUS = 60; // px — pointer must start within this of the preview ball

interface SceneData {
  mode: "online" | "local";
  isLocal: boolean;
}

type AimState =
  | { active: false }
  | { active: true; spawnX: number; spawnY: number };

/** Colyseus ball state shape we care about */
interface RemoteBallState {
  id: string;
  ownerId: string;
  size: string;
  x: number;
  y: number;
  isActive: boolean;
  heldBy: string;
}

export class GameScene extends Phaser.Scene {
  // ─── Layout ────────────────────────────────────────────────────────────────
  private arena!: Arena;
  private sceneW = 0;
  private sceneH = 0;
  // Scale factors arena-units → pixels
  private sx = 1;
  private sy = 1;

  // ─── Mode ──────────────────────────────────────────────────────────────────
  private isLocal = false;
  private mySessionId = "";
  private myPlayerSide: "left" | "right" = "left";

  // ─── Balls ─────────────────────────────────────────────────────────────────
  /** Map from ball id → Ball display object */
  private ballObjects = new Map<string, Ball>();

  // ─── Aiming / Flick ────────────────────────────────────────────────────────
  private aimState: AimState = { active: false };
  private aimGraphics!: Phaser.GameObjects.Graphics;
  private previewBall: Phaser.GameObjects.Arc | null = null;
  /** Recent pointer positions for flick velocity calculation */
  private flickHistory: Array<{ x: number; y: number; t: number }> = [];

  // ─── UI refs ───────────────────────────────────────────────────────────────
  private p1ScoreText!: Phaser.GameObjects.Text;
  private p2ScoreText!: Phaser.GameObjects.Text;
  private turnBannerText!: Phaser.GameObjects.Text;

  // ─── Local mode state ──────────────────────────────────────────────────────
  private localPhase: GamePhase = "p1Turn";
  private localP1Score = 0;
  private localP2Score = 0;
  private localCurrentPlayer: 1 | 2 = 1;
  private localEngine!: Matter.Engine;
  private localBodies = new Map<string, Matter.Body>();
  private localRestTicks = 0;
  private localTurnBallId: string | null = null;
  private passScreen!: Phaser.GameObjects.Container;
  /** Tracks which player owns each local ball (1 or 2) */
  private localBallOwners = new Map<string, 1 | 2>();
  /** Last known non-center half for each local ball (crossing detection) */
  private localBallHalves = new Map<string, "left" | "right">();

  constructor() {
    super({ key: "GameScene" });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  init(data: SceneData): void {
    this.isLocal = data?.isLocal ?? false;
  }

  create(): void {
    this.sceneW = this.scale.width;
    this.sceneH = this.scale.height;
    this.sx = this.sceneW / ARENA.WIDTH;
    this.sy = this.sceneH / ARENA.HEIGHT;

    this.arena = new Arena(this, this.sceneW, this.sceneH);
    this.aimGraphics = this.add.graphics();

    this.buildScoreUI();
    this.buildTurnBanner();
    this.setupInput();

    if (this.isLocal) {
      this.initLocalMode();
    } else {
      this.initOnlineMode();
    }
  }

  update(): void {
    // Advance local physics
    if (this.isLocal && this.localPhase === "simulating") {
      this.localStep();
    }

    // Interpolate all ball positions
    for (const ball of this.ballObjects.values()) {
      ball.preUpdate();
    }
  }

  // ─── UI Building ───────────────────────────────────────────────────────────

  private buildScoreUI(): void {
    const pad = 16;
    this.p1ScoreText = this.add
      .text(pad, pad, "P1: 0", {
        fontSize: "22px",
        color: "#4cc9f0",
        fontFamily: "Arial Black",
      })
      .setDepth(10);

    this.p2ScoreText = this.add
      .text(this.sceneW - pad, pad, "P2: 0", {
        fontSize: "22px",
        color: "#f72585",
        fontFamily: "Arial Black",
      })
      .setOrigin(1, 0)
      .setDepth(10);
  }

  private buildTurnBanner(): void {
    this.turnBannerText = this.add
      .text(this.sceneW / 2, 18, "", {
        fontSize: "16px",
        color: "#ffffff",
        fontFamily: "Arial",
        backgroundColor: "#00000066",
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setDepth(10);
  }

  // ─── Input ─────────────────────────────────────────────────────────────────

  private setupInput(): void {
    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      if (!this.isMyTurn() || this.aimState.active) return;
      const { x: spawnX, y: spawnY } = this.getSpawnPoint();
      if (Math.hypot(ptr.x - spawnX, ptr.y - spawnY) > SLINGSHOT_HIT_RADIUS) return;
      if (this.previewBall) {
        this.tweens.killTweensOf(this.previewBall);
        this.previewBall.setScale(1);
      }
      this.flickHistory = [{ x: ptr.x, y: ptr.y, t: Date.now() }];
      this.aimState = { active: true, spawnX, spawnY };
    });

    this.input.on("pointermove", (ptr: Phaser.Input.Pointer) => {
      if (!this.aimState.active) return;
      this.flickHistory.push({ x: ptr.x, y: ptr.y, t: Date.now() });
      // Ghost ball follows the finger
      if (this.previewBall) this.previewBall.setPosition(ptr.x, ptr.y);
    });

    this.input.on("pointerup", (_ptr: Phaser.Input.Pointer) => {
      if (!this.aimState.active) return;
      this.aimState = { active: false };
      this.aimGraphics.clear();
      this.hidePreviewBall();

      // Compute flick velocity from last 80 ms of movement
      const now = Date.now();
      const recent = this.flickHistory.filter((p) => now - p.t < 80);
      if (recent.length < 2) {
        this.showPreviewBall();
        return;
      }
      const dt = recent[recent.length - 1].t - recent[0].t;
      if (dt < 5) {
        this.showPreviewBall();
        return;
      }

      const screenVx =
        (recent[recent.length - 1].x - recent[0].x) / dt; // screen px/ms
      const screenVy = (recent[recent.length - 1].y - recent[0].y) / dt;

      // Convert to arena px/step (Matter.js velocity units)
      let vx = (screenVx / this.sx) * PHYSICS.DELTA_MS;
      let vy = (screenVy / this.sy) * PHYSICS.DELTA_MS;

      const speed = Math.hypot(vx, vy);
      if (speed < 0.5) {
        // Flick too slow — ignore
        this.showPreviewBall();
        return;
      }
      // Cap at max flick velocity
      const scale = Math.min(1, PHYSICS.MAX_FLICK_VELOCITY / speed);
      this.performThrow(vx * scale, vy * scale);
    });

    this.input.on("pointerout", () => {
      if (!this.aimState.active) return;
      this.aimState = { active: false };
      this.aimGraphics.clear();
      // Restore preview ball to spawn
      if (this.previewBall) {
        const { x, y } = this.getSpawnPoint();
        this.previewBall.setPosition(x, y).setScale(1);
        this.tweens.add({
          targets: this.previewBall,
          scaleX: 1.15,
          scaleY: 1.15,
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      }
    });
  }

  private isMyTurn(): boolean {
    if (this.isLocal) {
      return this.localPhase === "p1Turn" || this.localPhase === "p2Turn";
    }
    const room = colyseusService.getRoom();
    if (!room) return false;
    return room.state.currentPlayerId === room.sessionId;
  }

  private getSpawnPoint(): { x: number; y: number } {
    const isLeft = this.isLocal
      ? this.localCurrentPlayer === 1
      : this.myPlayerSide === "left";
    return {
      x: (isLeft ? ARENA.WIDTH * 0.25 : ARENA.WIDTH * 0.75) * this.sx,
      y: ARENA.HEIGHT * 0.5 * this.sy,
    };
  }

  private showPreviewBall(): void {
    if (this.previewBall) return;
    const { x, y } = this.getSpawnPoint();
    const radius = BALL_PHYSICS["medium"].radius;
    const isLeft = this.isLocal
      ? this.localCurrentPlayer === 1
      : this.myPlayerSide === "left";
    const color = isLeft ? 0x4cc9f0 : 0xf72585;
    this.previewBall = this.add
      .arc(x, y, radius, 0, 360, false, color, 0.55)
      .setStrokeStyle(2, 0xffffff, 0.9)
      .setDepth(5);
    this.tweens.add({
      targets: this.previewBall,
      scaleX: 1.15,
      scaleY: 1.15,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private hidePreviewBall(): void {
    if (!this.previewBall) return;
    this.tweens.killTweensOf(this.previewBall);
    this.previewBall.destroy();
    this.previewBall = null;
  }

  private performThrow(vx: number, vy: number): void {
    const payload: ThrowPayload = { vx, vy };
    if (this.isLocal) {
      this.localHandleThrow(payload);
    } else {
      colyseusService.sendThrow(payload);
    }
  }

  // ─── Online Mode ───────────────────────────────────────────────────────────

  private initOnlineMode(): void {
    const room = colyseusService.getRoom();
    if (!room) {
      console.error("[GameScene] No active room — returning to menu");
      this.scene.start("MenuScene");
      return;
    }

    this.mySessionId = room.sessionId;

    // Listen to state changes
    room.state.onChange(() => {
      this.syncScoreUI(room.state.p1Score, room.state.p2Score);
      this.updateTurnBanner(room.state.currentPlayerId, room.state.phase);
    });

    room.state.balls.onAdd((ball: RemoteBallState) => {
      this.onBallAdded(ball);
    });
    room.state.balls.onChange((ball: RemoteBallState) => {
      this.onBallChanged(ball);
    });
    room.state.balls.onRemove((ball: RemoteBallState) => {
      this.ballObjects.get(ball.id)?.destroy();
      this.ballObjects.delete(ball.id);
    });

    // Server events
    colyseusService.on("scored", (e) => {
      const side: "left" | "right" =
        e.scorerId === this.getLeftPlayerId(room) ? "right" : "left";
      this.arena.flashScore(side);
      this.showToast("+1!");
    });

    colyseusService.on("ballCaptured", () => this.showToast("Ball captured!"));
    colyseusService.on("bonusThrow", (e) => {
      if (e.playerId === this.mySessionId) this.showToast("Bonus throw!");
    });

    colyseusService.on("gameOver", (e) => {
      const won = e.winnerId === this.mySessionId;
      this.showGameOver(won, e.finalScore);
    });

    colyseusService.on("opponentDisconnected", () =>
      this.showToast("Opponent disconnected…"),
    );

    // Determine our side
    const player = room.state.players.get(this.mySessionId);
    if (player) this.myPlayerSide = player.side as "left" | "right";
  }

  private getLeftPlayerId(
    room: ReturnType<typeof colyseusService.getRoom>,
  ): string {
    for (const [id, player] of room!.state.players) {
      if (player.side === "left") return id;
    }
    return "";
  }

  private onBallAdded(ball: RemoteBallState): void {
    if (!ball.isActive) return;
    const owner = colyseusService.getRoom()?.state.players.get(ball.ownerId);
    const isLeft = owner?.side === "left";
    const b = new Ball(
      this,
      ball.x * this.sx,
      ball.y * this.sy,
      "medium",
      ball.id,
      isLeft,
    );
    this.ballObjects.set(ball.id, b);
  }

  private onBallChanged(ball: RemoteBallState): void {
    if (!ball.isActive) {
      // Ball went OOB — play exit animation and remove
      const obj = this.ballObjects.get(ball.id);
      if (obj) {
        obj.playScoreAnimation();
        this.ballObjects.delete(ball.id);
      }
      return;
    }
    const obj = this.ballObjects.get(ball.id);
    if (obj) {
      obj.syncFromState(ball.x * this.sx, ball.y * this.sy);
    }
  }

  private syncScoreUI(p1: number, p2: number): void {
    this.p1ScoreText.setText(`P1: ${p1}`);
    this.p2ScoreText.setText(`P2: ${p2}`);
  }

  private updateTurnBanner(currentPlayerId: string, phase: GamePhase): void {
    const isMyTurn = currentPlayerId === this.mySessionId;
    if (phase === "simulating") {
      this.turnBannerText.setText("…rolling");
      this.hidePreviewBall();
    } else if (phase === "gameOver") {
      this.turnBannerText.setText("Game Over");
      this.hidePreviewBall();
    } else if (isMyTurn) {
      this.turnBannerText.setText("Your turn — press & flick");
      this.showPreviewBall();
    } else {
      this.turnBannerText.setText("Opponent's turn");
      this.hidePreviewBall();
    }
  }

  // ─── Local Mode ────────────────────────────────────────────────────────────

  private initLocalMode(): void {
    this.localEngine = Matter.Engine.create({
      gravity: { x: 0, y: PHYSICS.GRAVITY_SCALE },
    });

    // Build walls in screen coordinates
    const W = ARENA.WIDTH * this.sx;
    const H = ARENA.HEIGHT * this.sy;
    const T = ARENA.WALL_THICKNESS;
    Matter.Composite.add(this.localEngine.world, [
      Matter.Bodies.rectangle(W / 2, -T / 2, W, T, { isStatic: true }),
      Matter.Bodies.rectangle(W / 2, H + T / 2, W, T, { isStatic: true }),
      Matter.Bodies.rectangle(-T / 2, H / 2, T, H, { isStatic: true }),
      Matter.Bodies.rectangle(W + T / 2, H / 2, T, H, { isStatic: true }),
    ]);

    this.localPhase = "p1Turn";
    this.updateLocalBanner();
    this.buildPassScreen();
  }

  private buildPassScreen(): void {
    const { width, height } = this.scale;
    const bg = this.add
      .rectangle(0, 0, width, height, 0x000000, 0.85)
      .setOrigin(0);
    const msg = this.add
      .text(width / 2, height / 2 - 20, "", {
        fontSize: "24px",
        color: "#ffffff",
        fontFamily: "Arial",
        align: "center",
      })
      .setOrigin(0.5);
    const hint = this.add
      .text(width / 2, height / 2 + 30, "Tap to continue", {
        fontSize: "16px",
        color: "#aaaacc",
        fontFamily: "Arial",
      })
      .setOrigin(0.5);

    this.passScreen = this.add
      .container(0, 0, [bg, msg, hint])
      .setDepth(50)
      .setVisible(false);

    bg.setInteractive();
    bg.on("pointerdown", () => {
      this.passScreen.setVisible(false);
      this.updateLocalBanner();
    });
  }

  private showPassScreen(): void {
    const player = this.localCurrentPlayer === 1 ? "Player 2" : "Player 1";
    const msg = this.passScreen.list[1] as Phaser.GameObjects.Text;
    msg.setText(`Pass to ${player}`);
    this.passScreen.setVisible(true);
  }

  private localHandleThrow(payload: ThrowPayload): void {
    if (this.localPhase !== "p1Turn" && this.localPhase !== "p2Turn") return;

    const ballId = `local_${Date.now()}`;
    const isLeft = this.localCurrentPlayer === 1;
    const startX = isLeft
      ? ARENA.WIDTH * 0.25 * this.sx
      : ARENA.WIDTH * 0.75 * this.sx;
    const startY = (ARENA.HEIGHT / 2) * this.sy;

    const consts = BALL_PHYSICS["medium"];
    const scaledRadius = consts.radius * Math.min(this.sx, this.sy);

    const body = Matter.Bodies.circle(startX, startY, scaledRadius, {
      mass: consts.mass,
      frictionAir: consts.frictionAir,
      restitution: consts.restitution,
      friction: consts.friction,
      frictionStatic: consts.frictionStatic,
    });

    // Payload vx/vy are in arena px/step — scale to screen px/step
    Matter.Body.setVelocity(body, {
      x: payload.vx * this.sx,
      y: payload.vy * this.sy,
    });

    Matter.Composite.add(this.localEngine.world, body);
    this.localBodies.set(ballId, body);
    this.localBallOwners.set(ballId, this.localCurrentPlayer);
    // Init crossing tracker to thrower's own half
    this.localBallHalves.set(ballId, isLeft ? "left" : "right");

    this.localTurnBallId = ballId;
    this.localRestTicks = 0;

    // Create visual ball
    const ball = new Ball(this, startX, startY, "medium", ballId, isLeft);
    this.ballObjects.set(ballId, ball);

    this.localPhase = "simulating";
  }

  private localStep(): void {
    Matter.Engine.update(this.localEngine, PHYSICS.DELTA_MS);

    // Sync visuals
    for (const [id, body] of this.localBodies) {
      const obj = this.ballObjects.get(id);
      if (obj) obj.syncFromState(body.position.x, body.position.y);
    }

    // Running tally: detect center-line crossings across all balls
    const centerX = ARENA.CENTER_X * this.sx;
    const buffer = ARENA.SCORE_BUFFER * this.sx;
    for (const [id, body] of this.localBodies) {
      let currSide: "left" | "right" | "center";
      if (body.position.x < centerX - buffer) currSide = "left";
      else if (body.position.x > centerX + buffer) currSide = "right";
      else currSide = "center";

      if (currSide !== "center") {
        const lastSide = this.localBallHalves.get(id);
        if (lastSide && lastSide !== currSide) {
          this.localProcessCrossing(id, lastSide, currSide);
          if (this.localPhase === "gameOver") return;
        }
        this.localBallHalves.set(id, currSide);
      }
    }

    if (!this.localTurnBallId) return;

    // Check OOB for the current turn ball
    const turnBody = this.localBodies.get(this.localTurnBallId);
    if (!turnBody) return;
    const W = ARENA.WIDTH * this.sx;
    if (turnBody.position.x < 0 || turnBody.position.x > W) {
      this.localEvaluateCaptured();
      return;
    }

    // Wait for ALL balls to settle before ending the turn
    const allAtRest = [...this.localBodies.values()].every(
      (b) => Math.hypot(b.velocity.x, b.velocity.y) < PHYSICS.REST_SPEED_THRESHOLD,
    );
    if (allAtRest) {
      this.localRestTicks++;
      if (this.localRestTicks >= PHYSICS.REST_TICKS_REQUIRED) {
        this.localFinalizeRound();
      }
    } else {
      this.localRestTicks = 0;
    }
  }

  /** Ball crossed the center line — immediately update the running tally. */
  private localProcessCrossing(
    ballId: string,
    _from: "left" | "right",
    to: "left" | "right",
  ): void {
    const owner = this.localBallOwners.get(ballId);
    if (!owner) return;
    const ownerSide: "left" | "right" = owner === 1 ? "left" : "right";
    const crossedToOpponent = to !== ownerSide;
    const delta = crossedToOpponent ? 1 : -1;

    if (owner === 1) {
      this.localP1Score = Math.max(0, this.localP1Score + delta);
      this.p1ScoreText.setText(`P1: ${this.localP1Score}`);
    } else {
      this.localP2Score = Math.max(0, this.localP2Score + delta);
      this.p2ScoreText.setText(`P2: ${this.localP2Score}`);
    }

    this.showToast(delta > 0 ? "+1!" : "-1");

    if (
      this.localP1Score >= RULES.WIN_SCORE ||
      this.localP2Score >= RULES.WIN_SCORE
    ) {
      const winner = this.localP1Score >= RULES.WIN_SCORE ? 1 : 2;
      this.localPhase = "gameOver";
      this.showLocalGameOver(winner, { p1: this.localP1Score, p2: this.localP2Score });
    }
  }

  /** All balls at rest — ball stays on field, advance turn. */
  private localFinalizeRound(): void {
    this.localPhase = "roundEval";
    this.localTurnBallId = null;
    this.localRestTicks = 0;
    this.localAdvanceTurn();
  }

  private localEvaluateCaptured(): void {
    this.localPhase = "roundEval";
    const ballId = this.localTurnBallId;
    if (!ballId) return;

    this.removeLocalBall(ballId);
    const capturingPlayer = this.localCurrentPlayer === 1 ? 2 : 1;
    this.showToast(`Player ${capturingPlayer} captured the ball!`);

    // Bonus turn for capturing player — swap and let them throw again
    this.localCurrentPlayer = capturingPlayer as 1 | 2;
    this.localPhase = this.localCurrentPlayer === 1 ? "p1Turn" : "p2Turn";
    this.showPassScreen();
  }

  /** Remove a ball from physics + visuals (only called for OOB). */
  private removeLocalBall(ballId: string): void {
    const body = this.localBodies.get(ballId);
    if (body) Matter.Composite.remove(this.localEngine.world, body);
    this.localBodies.delete(ballId);
    this.localBallOwners.delete(ballId);
    this.localBallHalves.delete(ballId);

    const obj = this.ballObjects.get(ballId);
    if (obj) {
      obj.playScoreAnimation();
      this.ballObjects.delete(ballId);
    }

    if (this.localTurnBallId === ballId) this.localTurnBallId = null;
  }

  private localAdvanceTurn(): void {
    this.localCurrentPlayer = this.localCurrentPlayer === 1 ? 2 : 1;
    this.localPhase = this.localCurrentPlayer === 1 ? "p1Turn" : "p2Turn";
    this.showPassScreen();
  }

  private showLocalGameOver(
    winner: 1 | 2,
    score: { p1: number; p2: number },
  ): void {
    const overlay = this.add
      .rectangle(
        this.sceneW / 2,
        this.sceneH / 2,
        this.sceneW,
        this.sceneH,
        0x000000,
        0.7,
      )
      .setDepth(30);
    void overlay;

    const color = winner === 1 ? "#4cc9f0" : "#f72585";
    this.add
      .text(
        this.sceneW / 2,
        this.sceneH / 2 - 40,
        `Player ${winner} Wins!`,
        {
          fontSize: "36px",
          color,
          fontFamily: "Arial Black",
          stroke: "#000000",
          strokeThickness: 4,
        },
      )
      .setOrigin(0.5)
      .setDepth(31);

    this.add
      .text(
        this.sceneW / 2,
        this.sceneH / 2 + 20,
        `Final score — P1: ${score.p1}  P2: ${score.p2}`,
        { fontSize: "18px", color: "#ffffff", fontFamily: "Arial" },
      )
      .setOrigin(0.5)
      .setDepth(31);

    this.add
      .text(this.sceneW / 2, this.sceneH / 2 + 80, "Back to Menu", {
        fontSize: "20px",
        color: "#aaddff",
        fontFamily: "Arial",
        backgroundColor: "#ffffff22",
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(31)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.scene.start("MenuScene"));
  }

  private updateLocalBanner(): void {
    this.turnBannerText.setText(
      `Player ${this.localCurrentPlayer}'s turn — press & flick`,
    );
    this.p1ScoreText.setColor(
      this.localCurrentPlayer === 1 ? "#ffffff" : "#4cc9f0",
    );
    this.p2ScoreText.setColor(
      this.localCurrentPlayer === 2 ? "#ffffff" : "#f72585",
    );
    this.showPreviewBall();
  }

  // ─── Toast / Game Over ─────────────────────────────────────────────────────

  private showToast(msg: string): void {
    const t = this.add
      .text(this.sceneW / 2, this.sceneH * 0.4, msg, {
        fontSize: "20px",
        color: "#ffffff",
        fontFamily: "Arial Black",
        stroke: "#000000",
        strokeThickness: 4,
        backgroundColor: "#00000055",
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(20);

    this.tweens.add({
      targets: t,
      y: t.y - 50,
      alpha: 0,
      duration: 1600,
      ease: "Power2",
      onComplete: () => t.destroy(),
    });
  }

  private showGameOver(won: boolean, score: { p1: number; p2: number }): void {
    const overlay = this.add
      .rectangle(
        this.sceneW / 2,
        this.sceneH / 2,
        this.sceneW,
        this.sceneH,
        0x000000,
        0.7,
      )
      .setDepth(30);
    void overlay;

    this.add
      .text(
        this.sceneW / 2,
        this.sceneH / 2 - 40,
        won ? "You Win!" : "You Lose",
        {
          fontSize: "36px",
          color: won ? "#4cc9f0" : "#f72585",
          fontFamily: "Arial Black",
          stroke: "#000000",
          strokeThickness: 4,
        },
      )
      .setOrigin(0.5)
      .setDepth(31);

    this.add
      .text(
        this.sceneW / 2,
        this.sceneH / 2 + 20,
        `Final score — P1: ${score.p1}  P2: ${score.p2}`,
        {
          fontSize: "18px",
          color: "#ffffff",
          fontFamily: "Arial",
        },
      )
      .setOrigin(0.5)
      .setDepth(31);

    const menuBtn = this.add
      .text(this.sceneW / 2, this.sceneH / 2 + 80, "Back to Menu", {
        fontSize: "20px",
        color: "#aaddff",
        fontFamily: "Arial",
        backgroundColor: "#ffffff22",
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(31)
      .setInteractive({ useHandCursor: true });

    menuBtn.on("pointerdown", () => {
      colyseusService.leave();
      this.scene.start("MenuScene");
    });
  }
}
