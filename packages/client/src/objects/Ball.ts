import Phaser from "phaser";
import { BALL_PHYSICS } from "@pinbuddys/shared";
import type { BallSize } from "@pinbuddys/shared";

const LERP_ALPHA = 0.25; // position interpolation factor per frame

/**
 * Visual representation of a ball.
 * Positions are interpolated smoothly toward the server-authoritative target.
 */
export class Ball extends Phaser.GameObjects.Container {
  private sprite: Phaser.GameObjects.Arc;
  private shadow: Phaser.GameObjects.Arc;
  private ownerId: string;
  private isLeft: boolean; // true = owned by left player

  private targetX: number;
  private targetY: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    size: BallSize,
    ownerId: string,
    isLeft: boolean,
    screenRadius?: number
  ) {
    super(scene, x, y);
    this.ownerId = ownerId;
    this.isLeft = isLeft;
    this.targetX = x;
    this.targetY = y;

    const radius = screenRadius ?? BALL_PHYSICS[size].radius;
    const color = isLeft ? 0x4cc9f0 : 0xf72585;
    const shadowAlpha = 0.35;

    // Drop shadow (slightly offset, no stroke)
    this.shadow = scene.add.arc(3, 3, radius, 0, 360, false, 0x000000, shadowAlpha);

    // Main ball
    this.sprite = scene.add.arc(0, 0, radius, 0, 360, false, color);
    this.sprite.setStrokeStyle(2, 0xffffff, 0.6);

    this.add([this.shadow, this.sprite]);
    scene.add.existing(this);
  }

  get id(): string {
    return this.ownerId;
  }

  // ─── State sync ────────────────────────────────────────────────────────────

  syncFromState(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /** Teleport to exact position — use in local mode to keep visual in sync with physics. */
  snapToPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
  }

  preUpdate(): void {
    // Smooth interpolation toward server position (online mode only)
    this.x = Phaser.Math.Linear(this.x, this.targetX, LERP_ALPHA);
    this.y = Phaser.Math.Linear(this.y, this.targetY, LERP_ALPHA);
  }

  // ─── Animations ────────────────────────────────────────────────────────────

  playThrowAnimation(): void {
    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: 0.85,
      scaleY: 1.15,
      duration: 80,
      yoyo: true,
      ease: "Sine.easeOut",
    });
  }

  playScoreAnimation(): void {
    this.scene.tweens.add({
      targets: this,
      scaleX: 1.4,
      scaleY: 1.4,
      alpha: 0,
      duration: 400,
      ease: "Back.easeOut",
      onComplete: () => this.destroy(),
    });
  }

  playCapturedAnimation(callback?: () => void): void {
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scaleX: 0.5,
      scaleY: 0.5,
      duration: 300,
      ease: "Power2",
      onComplete: () => {
        this.destroy();
        callback?.();
      },
    });
  }

  /** Show a green border when this ball is currently scoring. */
  setScoring(on: boolean): void {
    if (on) {
      this.sprite.setStrokeStyle(5, 0x00ff66, 1);
    } else {
      this.sprite.setStrokeStyle(2, 0xffffff, 0.6);
    }
  }

  highlight(on: boolean): void {
    const color = this.isLeft ? 0x4cc9f0 : 0xf72585;
    const glow = on ? 0xffffff : color;
    this.sprite.setFillStyle(on ? Phaser.Display.Color.GetColor32(255, 255, 255, 200) : color);
    this.sprite.setStrokeStyle(on ? 4 : 2, glow, on ? 1 : 0.6);
  }

  setActive(active: boolean): this {
    super.setActive(active);
    this.setVisible(active);
    return this;
  }
}
