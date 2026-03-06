import Phaser from "phaser";
import { Arena } from "../objects/Arena";
import { Ball } from "../objects/Ball";
import { colyseusService } from "../network/ColyseusClient";
import { ARENA, PHYSICS, BALL_PHYSICS, RULES } from "@pinbuddys/shared";
import type {
  GamePhase,
  ThrowPayload,
} from "@pinbuddys/shared";

// Matter.js (browser build) — used for LOCAL mode physics only
import Matter from "matter-js";

interface SceneData {
  mode: "online" | "local";
  isLocal: boolean;
}

type AimState =
  | { active: false }
  | { active: true; currentX: number; currentY: number };

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
  private sx = 1;
  private sy = 1;
  /** True when the screen is taller than wide (phone held vertically). */
  private portrait = false;

  // ─── Mode ──────────────────────────────────────────────────────────────────
  private isLocal = false;
  private mySessionId = "";
  private myPlayerSide: "left" | "right" = "left";

  // ─── Balls ─────────────────────────────────────────────────────────────────
  private ballObjects = new Map<string, Ball>();

  // ─── Aiming / Flick ────────────────────────────────────────────────────────
  private aimState: AimState = { active: false };
  private aimGraphics!: Phaser.GameObjects.Graphics;
  private previewBall: Phaser.GameObjects.Arc | null = null;
  private flickHistory: Array<{ x: number; y: number; t: number }> = [];

  // ─── UI refs ───────────────────────────────────────────────────────────────
  private p1ScoreText!: Phaser.GameObjects.Text;
  private p2ScoreText!: Phaser.GameObjects.Text;
  private rosterGraphics!: Phaser.GameObjects.Graphics;
  private turnIndicatorGraphics!: Phaser.GameObjects.Graphics;
  private p1TurnText!: Phaser.GameObjects.Text;
  private p2TurnText!: Phaser.GameObjects.Text;

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

  // Roster — balls available to throw
  private localP1Roster: number = ARENA.INITIAL_ROSTER_SIZE;
  private localP2Roster: number = ARENA.INITIAL_ROSTER_SIZE;

  // Ball owner tracking (for scoring and endzone capture)
  private localBallOwners = new Map<string, 1 | 2>();

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
    this.portrait = this.sceneH > this.sceneW;

    if (this.portrait) {
      // Long axis (height) maps to ARENA.WIDTH; short axis (width) maps to ARENA.HEIGHT
      this.sx = this.sceneW / ARENA.HEIGHT;
      this.sy = this.sceneH / ARENA.WIDTH;
    } else {
      this.sx = this.sceneW / ARENA.WIDTH;
      this.sy = this.sceneH / ARENA.HEIGHT;
    }

    this.arena = new Arena(this, this.sceneW, this.sceneH);
    this.aimGraphics = this.add.graphics();

    this.buildScoreUI();
    this.buildRosterUI();
    this.setupInput();

    if (this.isLocal) {
      this.initLocalMode();
    } else {
      this.initOnlineMode();
    }
  }

  update(): void {
    if (this.isLocal && this.localPhase === "simulating") {
      this.localStep();
    }
    for (const ball of this.ballObjects.values()) {
      ball.preUpdate();
    }
  }

  // ─── UI Building ───────────────────────────────────────────────────────────

  private buildScoreUI(): void {
    if (this.portrait) {
      this.buildScoreUIPortrait();
    } else {
      this.buildScoreUILandscape();
    }
  }

  private buildScoreUILandscape(): void {
    const circleY = this.sceneH - 20;
    const offset = 8;
    const fs = Math.round(Math.min(
      ARENA.LEFT_ENDZONE_END * this.sx * 0.4,
      this.sceneH * 0.1,
      56,
    ));

    this.p1ScoreText = this.add
      .text(ARENA.LEFT_ENDZONE_END * this.sx - offset, circleY, "0", {
        fontSize: `${fs}px`,
        color: "#4cc9f0",
        fontFamily: "Arial Black",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(1, 0.5)
      .setDepth(8);

    this.p2ScoreText = this.add
      .text(ARENA.RIGHT_ENDZONE_START * this.sx + offset, circleY, "0", {
        fontSize: `${fs}px`,
        color: "#f72585",
        fontFamily: "Arial Black",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0, 0.5)
      .setDepth(8);
  }

  private buildScoreUIPortrait(): void {
    // In portrait: endzones are top/bottom.
    // sy maps ARENA.WIDTH (800) to sceneH.
    // Endzone depth in screen px = ARENA.LEFT_ENDZONE_END * sy
    const endH = ARENA.LEFT_ENDZONE_END * this.sy;
    const fs = Math.round(Math.min(endH * 0.4, this.sceneW * 0.1, 56));
    const cx = this.sceneW / 2;
    const offset = 8;

    // P1 is at the bottom — score near the bottom endzone line, readable normally
    this.p1ScoreText = this.add
      .text(cx, this.sceneH - endH + offset, "0", {
        fontSize: `${fs}px`,
        color: "#4cc9f0",
        fontFamily: "Arial Black",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0)
      .setDepth(8);

    // P2 is at the top — score near the top endzone line, rotated 180° so P2 can read it
    this.p2ScoreText = this.add
      .text(cx, endH - offset, "0", {
        fontSize: `${fs}px`,
        color: "#f72585",
        fontFamily: "Arial Black",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setAngle(180)
      .setDepth(8);
  }

  private buildRosterUI(): void {
    if (this.portrait) {
      this.buildRosterUIPortrait();
    } else {
      this.buildRosterUILandscape();
    }
  }

  private buildRosterUILandscape(): void {
    const textY = this.sceneH - 68;
    this.p1TurnText = this.add
      .text(16, textY, "Blue's Turn", {
        fontSize: "12px",
        color: "#4cc9f0",
        fontFamily: "Arial",
        fontStyle: "bold",
      })
      .setDepth(11)
      .setOrigin(0, 0.5);

    this.p2TurnText = this.add
      .text(this.sceneW - 16, textY, "Red's Turn", {
        fontSize: "12px",
        color: "#f72585",
        fontFamily: "Arial",
        fontStyle: "bold",
      })
      .setDepth(11)
      .setOrigin(1, 0.5);

    this.turnIndicatorGraphics = this.add.graphics().setDepth(10);
    this.rosterGraphics = this.add.graphics().setDepth(10);
    this.redrawRosterUI();
  }

  private buildRosterUIPortrait(): void {
    // P1 at bottom — label near bottom-left, normal orientation
    this.p1TurnText = this.add
      .text(16, this.sceneH - 16, "Blue's Turn", {
        fontSize: "12px",
        color: "#4cc9f0",
        fontFamily: "Arial",
        fontStyle: "bold",
      })
      .setDepth(11)
      .setOrigin(0, 1);

    // P2 at top — label near top-left, rotated 180° so P2 can read it
    this.p2TurnText = this.add
      .text(this.sceneW - 16, 16, "Red's Turn", {
        fontSize: "12px",
        color: "#f72585",
        fontFamily: "Arial",
        fontStyle: "bold",
      })
      .setDepth(11)
      .setOrigin(0, 0)
      .setAngle(180);

    this.turnIndicatorGraphics = this.add.graphics().setDepth(10);
    this.rosterGraphics = this.add.graphics().setDepth(10);
    this.redrawRosterUI();
  }

  private redrawRosterUI(): void {
    const g = this.rosterGraphics;
    g.clear();

    if (this.portrait) {
      this.drawRosterPortrait(g);
    } else {
      this.drawRosterLandscape(g);
    }

    this.updateTurnIndicators();
  }

  private drawRosterLandscape(g: Phaser.GameObjects.Graphics): void {
    const r = 5, gap = 4, perRow = 4, padX = 12;
    const rowH = r * 2 + gap;
    const bottomY = this.sceneH - 16;
    const maxBalls = 8;

    for (let i = 0; i < maxBalls; i++) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const cx = padX + col * (r * 2 + gap) + r;
      const cy = bottomY - row * rowH;
      const filled = i < this.localP1Roster;
      g.lineStyle(1.5, 0x4cc9f0, filled ? 1 : 0.3);
      g.fillStyle(0x4cc9f0, filled ? 0.85 : 0.1);
      g.fillCircle(cx, cy, r); g.strokeCircle(cx, cy, r);
    }

    for (let i = 0; i < maxBalls; i++) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const cx = this.sceneW - padX - col * (r * 2 + gap) - r;
      const cy = bottomY - row * rowH;
      const filled = i < this.localP2Roster;
      g.lineStyle(1.5, 0xf72585, filled ? 1 : 0.3);
      g.fillStyle(0xf72585, filled ? 0.85 : 0.1);
      g.fillCircle(cx, cy, r); g.strokeCircle(cx, cy, r);
    }
  }

  private drawRosterPortrait(g: Phaser.GameObjects.Graphics): void {
    // P1 at bottom: dots in a row near the bottom edge
    // P2 at top: dots in a row near the top edge (mirrored)
    const r = 5, gap = 4, padY = 32;
    const maxBalls = 8;
    const totalW = maxBalls * (r * 2) + (maxBalls - 1) * gap;
    const startX = (this.sceneW - totalW) / 2;

    // P1 — bottom, cyan
    for (let i = 0; i < maxBalls; i++) {
      const cx = startX + i * (r * 2 + gap) + r;
      const cy = this.sceneH - padY;
      const filled = i < this.localP1Roster;
      g.lineStyle(1.5, 0x4cc9f0, filled ? 1 : 0.3);
      g.fillStyle(0x4cc9f0, filled ? 0.85 : 0.1);
      g.fillCircle(cx, cy, r); g.strokeCircle(cx, cy, r);
    }

    // P2 — top, magenta (right-to-left so it reads correctly when rotated)
    for (let i = 0; i < maxBalls; i++) {
      const cx = this.sceneW - startX - i * (r * 2 + gap) - r;
      const cy = padY;
      const filled = i < this.localP2Roster;
      g.lineStyle(1.5, 0xf72585, filled ? 1 : 0.3);
      g.fillStyle(0xf72585, filled ? 0.85 : 0.1);
      g.fillCircle(cx, cy, r); g.strokeCircle(cx, cy, r);
    }
  }

  private updateTurnIndicators(): void {
    if (!this.p1TurnText || !this.p2TurnText || !this.turnIndicatorGraphics) return;

    const isP1Turn = this.localCurrentPlayer === 1;
    this.p1TurnText.setAlpha(isP1Turn ? 1 : 0.3);
    this.p2TurnText.setAlpha(isP1Turn ? 0.3 : 1);

    const g = this.turnIndicatorGraphics;
    g.clear();

    const drawPill = (
      text: Phaser.GameObjects.Text,
      color: number,
      active: boolean,
    ) => {
      const b = text.getBounds();
      const px = 8, py = 5;
      const x = b.left - px;
      const y = b.top - py;
      const w = b.width + px * 2;
      const h = b.height + py * 2;
      g.fillStyle(color, active ? 0.18 : 0.04);
      g.fillRoundedRect(x, y, w, h, h / 2);
      g.lineStyle(1.5, color, active ? 0.9 : 0.25);
      g.strokeRoundedRect(x, y, w, h, h / 2);
    };

    drawPill(this.p1TurnText, 0x4cc9f0, isP1Turn);
    drawPill(this.p2TurnText, 0xf72585, !isP1Turn);
  }

  // ─── Input ─────────────────────────────────────────────────────────────────

  /**
   * Returns the endzone bounds for the current player.
   * In landscape: x bounds. In portrait: y bounds (P1=bottom, P2=top).
   */
  private getEndzoneBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const isP1 = this.isLocal ? this.localCurrentPlayer === 1 : this.myPlayerSide === "left";

    if (this.portrait) {
      // sy maps ARENA.WIDTH (800) → sceneH
      const endH = ARENA.LEFT_ENDZONE_END * this.sy;
      // P1 = bottom endzone (high y), P2 = top endzone (low y)
      return isP1
        ? { minX: 0, maxX: this.sceneW, minY: this.sceneH - endH, maxY: this.sceneH }
        : { minX: 0, maxX: this.sceneW, minY: 0, maxY: endH };
    }

    return isP1
      ? { minX: 0, maxX: ARENA.LEFT_ENDZONE_END * this.sx, minY: 0, maxY: this.sceneH }
      : { minX: ARENA.RIGHT_ENDZONE_START * this.sx, maxX: this.sceneW, minY: 0, maxY: this.sceneH };
  }

  private setupInput(): void {
    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      if (!this.isMyTurn() || this.aimState.active) return;

      // Check pointer is within the player's endzone
      const bounds = this.getEndzoneBounds();
      if (ptr.x < bounds.minX || ptr.x > bounds.maxX) return;
      if (ptr.y < bounds.minY || ptr.y > bounds.maxY) return;

      // Check player has balls remaining
      const hasRoster = this.isLocal
        ? (this.localCurrentPlayer === 1 ? this.localP1Roster : this.localP2Roster) > 0
        : true; // online mode: server tracks roster
      if (!hasRoster) return;

      if (this.previewBall) {
        this.tweens.killTweensOf(this.previewBall);
        this.previewBall.setScale(1);
        this.previewBall.setPosition(ptr.x, ptr.y);
      } else {
        this.showPreviewBallAt(ptr.x, ptr.y);
      }

      this.flickHistory = [{ x: ptr.x, y: ptr.y, t: Date.now() }];
      this.aimState = { active: true, currentX: ptr.x, currentY: ptr.y };
    });

    this.input.on("pointermove", (ptr: Phaser.Input.Pointer) => {
      if (!this.aimState.active) return;

      // Clamp to endzone bounds (portrait: locked to Y endzone, free in X; landscape: vice versa)
      const bounds = this.getEndzoneBounds();
      const clampedX = Phaser.Math.Clamp(ptr.x, bounds.minX, bounds.maxX);
      const clampedY = Phaser.Math.Clamp(ptr.y, bounds.minY, bounds.maxY);

      this.flickHistory.push({ x: clampedX, y: clampedY, t: Date.now() });
      if (this.previewBall) this.previewBall.setPosition(clampedX, clampedY);
      this.aimState = { active: true, currentX: clampedX, currentY: clampedY };
    });

    this.input.on("pointerup", (_ptr: Phaser.Input.Pointer) => {
      if (!this.aimState.active) return;
      const { currentX, currentY } = this.aimState;
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

      const screenVx = (recent[recent.length - 1].x - recent[0].x) / dt;
      const screenVy = (recent[recent.length - 1].y - recent[0].y) / dt;

      // Convert to arena px/step (Matter.js velocity units)
      let vx = (screenVx / this.sx) * PHYSICS.DELTA_MS;
      let vy = (screenVy / this.sy) * PHYSICS.DELTA_MS;

      const speed = Math.hypot(vx, vy);
      if (speed < 0.5) {
        this.showPreviewBall();
        return;
      }
      const capScale = Math.min(1, PHYSICS.MAX_FLICK_VELOCITY / speed);
      this.performThrow(vx * capScale, vy * capScale, currentX, currentY);
    });

    this.input.on("pointerout", () => {
      if (!this.aimState.active) return;
      this.aimState = { active: false };
      this.aimGraphics.clear();
      // Restore preview ball to endzone center
      if (this.previewBall) {
        const { x, y } = this.getEndzoneCenterPoint();
        this.previewBall.setPosition(x, y).setScale(1);
        this.startPreviewPulse();
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

  /** Center of the current player's endzone in screen px. */
  private getEndzoneCenterPoint(): { x: number; y: number } {
    const isP1 = this.isLocal ? this.localCurrentPlayer === 1 : this.myPlayerSide === "left";

    if (this.portrait) {
      const endH = ARENA.LEFT_ENDZONE_END * this.sy;
      return {
        x: this.sceneW / 2,
        y: isP1 ? this.sceneH - endH / 2 : endH / 2,
      };
    }

    return {
      x: (isP1 ? ARENA.LEFT_ENDZONE_END / 2 : (ARENA.RIGHT_ENDZONE_START + ARENA.WIDTH) / 2) * this.sx,
      y: ARENA.HEIGHT * 0.5 * this.sy,
    };
  }

  private showPreviewBall(): void {
    if (this.previewBall) return;
    const { x, y } = this.getEndzoneCenterPoint();
    this.showPreviewBallAt(x, y);
    this.startPreviewPulse();
  }

  private showPreviewBallAt(x: number, y: number): void {
    if (this.previewBall) {
      this.previewBall.setPosition(x, y);
      return;
    }
    const screenR = BALL_PHYSICS["medium"].radius * Math.min(this.sx, this.sy);
    const isLeft = this.isLocal
      ? this.localCurrentPlayer === 1
      : this.myPlayerSide === "left";
    const color = isLeft ? 0x4cc9f0 : 0xf72585;
    this.previewBall = this.add
      .arc(x, y, screenR, 0, 360, false, color, 0.55)
      .setStrokeStyle(2, 0xffffff, 0.9)
      .setDepth(5);
  }

  private startPreviewPulse(): void {
    if (!this.previewBall) return;
    this.tweens.killTweensOf(this.previewBall);
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

  private performThrow(vx: number, vy: number, startScreenX: number, startScreenY: number): void {
    const payload: ThrowPayload = { vx, vy };
    if (this.isLocal) {
      this.localHandleThrow(payload, startScreenX, startScreenY);
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
    const screenR = BALL_PHYSICS["medium"].radius * Math.min(this.sx, this.sy);
    const b = new Ball(
      this,
      ball.x * this.sx,
      ball.y * this.sy,
      "medium",
      ball.id,
      isLeft,
      screenR,
    );
    this.ballObjects.set(ball.id, b);
  }

  private onBallChanged(ball: RemoteBallState): void {
    if (!ball.isActive) {
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
    this.p1ScoreText.setText(`${p1}`);
    this.p2ScoreText.setText(`${p2}`);
  }

  private updateTurnBanner(currentPlayerId: string, phase: GamePhase): void {
    const isMyTurn = currentPlayerId === this.mySessionId;
    if (phase === "simulating" || phase === "gameOver") {
      this.hidePreviewBall();
    } else if (isMyTurn) {
      this.showPreviewBall();
    } else {
      this.hidePreviewBall();
    }
  }

  // ─── Local Mode ────────────────────────────────────────────────────────────

  private initLocalMode(): void {
    this.localEngine = Matter.Engine.create({
      gravity: { x: 0, y: PHYSICS.GRAVITY_SCALE },
      positionIterations: 10,
      velocityIterations: 8,
      enableSleeping: true,
    });

    // Physics walls are in screen space — always use actual scene dimensions.
    const W = this.sceneW;
    const H = this.sceneH;
    const T = 200;
    Matter.Composite.add(this.localEngine.world, [
      Matter.Bodies.rectangle(W / 2, -T / 2, W + T * 2, T, { isStatic: true }),
      Matter.Bodies.rectangle(W / 2, H + T / 2, W + T * 2, T, { isStatic: true }),
      Matter.Bodies.rectangle(-T / 2, H / 2, T, H + T * 2, { isStatic: true }),
      Matter.Bodies.rectangle(W + T / 2, H / 2, T, H + T * 2, { isStatic: true }),
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

  private localHandleThrow(payload: ThrowPayload, startScreenX: number, startScreenY: number): void {
    if (this.localPhase !== "p1Turn" && this.localPhase !== "p2Turn") return;

    const roster = this.localCurrentPlayer === 1 ? this.localP1Roster : this.localP2Roster;
    if (roster <= 0) return;

    const ballId = `local_${Date.now()}`;
    const isLeft = this.localCurrentPlayer === 1;

    const consts = BALL_PHYSICS["medium"];
    const scaledRadius = consts.radius * Math.min(this.sx, this.sy);

    const body = Matter.Bodies.circle(startScreenX, startScreenY, scaledRadius, {
      mass: consts.mass,
      frictionAir: consts.frictionAir,
      restitution: consts.restitution,
      friction: consts.friction,
      frictionStatic: consts.frictionStatic,
    });

    Matter.Body.setVelocity(body, {
      x: payload.vx * this.sx,
      y: payload.vy * this.sy,
    });

    Matter.Composite.add(this.localEngine.world, body);
    this.localBodies.set(ballId, body);
    this.localBallOwners.set(ballId, this.localCurrentPlayer);
    this.localTurnBallId = ballId;
    this.localRestTicks = 0;

    // Deduct from roster
    if (this.localCurrentPlayer === 1) this.localP1Roster--;
    else this.localP2Roster--;
    this.redrawRosterUI();

    // Create visual ball with correctly scaled radius
    const screenR = scaledRadius;
    const ball = new Ball(this, startScreenX, startScreenY, "medium", ballId, isLeft, screenR);
    this.ballObjects.set(ballId, ball);

    this.localPhase = "simulating";
  }

  private localStep(): void {
    Matter.Engine.update(this.localEngine, PHYSICS.DELTA_MS);

    // Clamp near-zero velocities to prevent floating-point drift.
    // Matter.js bodies accumulate sub-pixel noise from position correction
    // that keeps them perpetually "awake" and creeping across the field.
    for (const body of this.localBodies.values()) {
      if (Math.hypot(body.velocity.x, body.velocity.y) < 0.15) {
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
      }
    }

    // Sync visuals — snap to exact physics position (no lerp in local mode)
    let p1Score = 0;
    let p2Score = 0;

    if (this.portrait) {
      // Portrait: long axis = Y. P1 at bottom (high y), P2 at top (low y).
      // sy maps ARENA.WIDTH (800) → sceneH
      const centerY = this.sceneH / 2;
      const topEndY = ARENA.LEFT_ENDZONE_END * this.sy;          // P2 endzone bottom edge
      const bottomEndY = ARENA.RIGHT_ENDZONE_START * this.sy;    // P1 endzone top edge

      for (const [id, body] of this.localBodies) {
        const obj = this.ballObjects.get(id);
        if (obj) obj.snapToPosition(body.position.x, body.position.y);

        const owner = this.localBallOwners.get(id);
        // P1 (bottom) scores when ball is above center (low y), not yet in P2 endzone
        // P2 (top) scores when ball is below center (high y), not yet in P1 endzone
        const pastCenter =
          owner === 1 ? body.position.y < centerY : body.position.y > centerY;
        const inOpponentEndzone =
          owner === 1 ? body.position.y < topEndY : body.position.y > bottomEndY;
        const isScoring = pastCenter && !inOpponentEndzone;
        if (isScoring) {
          if (owner === 1) p1Score++;
          else p2Score++;
        }
        obj?.setScoring(isScoring);
      }
    } else {
      const centerX = ARENA.CENTER_X * this.sx;
      const leftEndX = ARENA.LEFT_ENDZONE_END * this.sx;
      const rightEndX = ARENA.RIGHT_ENDZONE_START * this.sx;

      for (const [id, body] of this.localBodies) {
        const obj = this.ballObjects.get(id);
        if (obj) obj.snapToPosition(body.position.x, body.position.y);

        const owner = this.localBallOwners.get(id);
        const pastCenter =
          owner === 1 ? body.position.x > centerX : body.position.x < centerX;
        const inOpponentEndzone =
          owner === 1
            ? body.position.x > rightEndX
            : body.position.x < leftEndX;
        const isScoring = pastCenter && !inOpponentEndzone;
        if (isScoring) {
          if (owner === 1) p1Score++;
          else p2Score++;
        }
        obj?.setScoring(isScoring);
      }
    }
    if (p1Score !== this.localP1Score || p2Score !== this.localP2Score) {
      this.localP1Score = p1Score;
      this.localP2Score = p2Score;
      this.p1ScoreText.setText(`${p1Score}`);
      this.p2ScoreText.setText(`${p2Score}`);
      if (p1Score >= RULES.WIN_SCORE || p2Score >= RULES.WIN_SCORE) {
        const winner = p1Score >= RULES.WIN_SCORE ? 1 : 2;
        this.localPhase = "gameOver";
        this.showLocalGameOver(winner, { p1: p1Score, p2: p2Score });
        return;
      }
    }

    // Check for balls that have come to rest in the opponent's endzone
    const toCapture: Array<{ id: string; capturer: 1 | 2 }> = [];
    for (const [id, body] of this.localBodies) {
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed >= PHYSICS.REST_SPEED_THRESHOLD) continue;
      const owner = this.localBallOwners.get(id);
      if (!owner) continue;
      let inOpponentEndzone: boolean;
      if (this.portrait) {
        const topEndY = ARENA.LEFT_ENDZONE_END * this.sy;
        const bottomEndY = ARENA.RIGHT_ENDZONE_START * this.sy;
        inOpponentEndzone = owner === 1 ? body.position.y < topEndY : body.position.y > bottomEndY;
      } else {
        const leftEndX = ARENA.LEFT_ENDZONE_END * this.sx;
        const rightEndX = ARENA.RIGHT_ENDZONE_START * this.sx;
        inOpponentEndzone = owner === 1 ? body.position.x > rightEndX : body.position.x < leftEndX;
      }
      if (inOpponentEndzone) {
        toCapture.push({ id, capturer: owner === 1 ? 2 : 1 });
      }
    }
    for (const { id, capturer } of toCapture) {
      this.localCaptureByEndzone(id, capturer);
      if (id === this.localTurnBallId) this.localTurnBallId = null;
    }

    if (!this.localTurnBallId) {
      // Check if we should finalise (no current turn ball; all others at rest)
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
      return;
    }

    // OOB for the turn ball (tunnelling safety net)
    const turnBody = this.localBodies.get(this.localTurnBallId);
    if (turnBody) {
      const oob = this.portrait
        ? turnBody.position.y < 0 || turnBody.position.y > this.sceneH
        : turnBody.position.x < 0 || turnBody.position.x > this.sceneW;
      if (oob) {
        this.localEvaluateCaptured();
        return;
      }
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


  /** Ball rested in opponent's endzone — captured, added to opponent's roster. */
  private localCaptureByEndzone(id: string, capturer: 1 | 2): void {
    this.removeLocalBall(id);
    if (capturer === 1) {
      this.localP1Roster++;
    } else {
      this.localP2Roster++;
    }
    this.redrawRosterUI();
    this.showToast(`P${capturer} captured a ball!`);
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

    // Bonus turn for capturing player
    this.localCurrentPlayer = capturingPlayer as 1 | 2;
    this.localPhase = this.localCurrentPlayer === 1 ? "p1Turn" : "p2Turn";
    this.showPassScreen();
  }

  /** Remove a ball from physics + visuals. Only called for OOB or endzone capture. */
  private removeLocalBall(ballId: string): void {
    const body = this.localBodies.get(ballId);
    if (body) Matter.Composite.remove(this.localEngine.world, body);
    this.localBodies.delete(ballId);
    this.localBallOwners.delete(ballId);

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
      .text(this.sceneW / 2, this.sceneH / 2 - 40, `Player ${winner} Wins!`, {
        fontSize: "36px",
        color,
        fontFamily: "Arial Black",
        stroke: "#000000",
        strokeThickness: 4,
      })
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
    const roster =
      this.localCurrentPlayer === 1 ? this.localP1Roster : this.localP2Roster;

    this.updateTurnIndicators();

    if (roster > 0) {
      this.showPreviewBall();
    } else {
      this.hidePreviewBall();
      // No balls — skip turn after brief delay
      this.time.delayedCall(800, () => {
        if (this.localPhase !== "p1Turn" && this.localPhase !== "p2Turn") return;
        this.showToast(`Player ${this.localCurrentPlayer} has no balls!`);
        this.localAdvanceTurn();
      });
    }
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
        { fontSize: "18px", color: "#ffffff", fontFamily: "Arial" },
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
