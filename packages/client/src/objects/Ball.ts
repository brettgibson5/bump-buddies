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
  private inner: Phaser.GameObjects.Arc;
  private sheen: Phaser.GameObjects.Arc;
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
    screenRadius?: number,
  ) {
    super(scene, x, y);
    this.ownerId = ownerId;
    this.isLeft = isLeft;
    this.targetX = x;
    this.targetY = y;

    const radius = screenRadius ?? BALL_PHYSICS[size].radius;
    const color = isLeft ? 0x3f8fc6 : 0xc95b73;
    const shadowAlpha = 0.42;

    // Drop shadow (slightly offset, no stroke)
    this.shadow = scene.add.arc(
      3,
      3,
      radius,
      0,
      360,
      false,
      0x000000,
      shadowAlpha,
    );

    // Main orb
    this.sprite = scene.add.arc(0, 0, radius, 0, 360, false, color);
    this.sprite.setStrokeStyle(2.5, 0xf7e8c4, 0.78);

    // Inner core tint gives a richer material feel.
    const innerColor = isLeft ? 0x86cff8 : 0xf29db0;
    this.inner = scene.add.arc(
      0,
      0,
      radius * 0.72,
      0,
      360,
      false,
      innerColor,
      0.38,
    );

    // Top-left specular highlight.
    this.sheen = scene.add.arc(
      -radius * 0.34,
      -radius * 0.34,
      radius * 0.38,
      0,
      360,
      false,
      0xffffff,
      0.26,
    );
    this.sheen.setScale(1, 0.82);

    this.add([this.shadow, this.sprite, this.inner, this.sheen]);
    scene.add.existing(this);

    scene.tweens.add({
      targets: this.sheen,
      alpha: { from: 0.2, to: 0.34 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: Math.floor(Math.random() * 350),
    });
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
      this.sprite.setStrokeStyle(6, 0x9fffd8, 0.95);
      this.inner.setAlpha(0.5);
    } else {
      this.sprite.setStrokeStyle(2.5, 0xf7e8c4, 0.78);
      this.inner.setAlpha(0.38);
    }
  }

  highlight(on: boolean): void {
    const color = this.isLeft ? 0x3f8fc6 : 0xc95b73;
    const glow = on ? 0xfff3d4 : 0xf7e8c4;
    this.sprite.setFillStyle(
      on ? Phaser.Display.Color.GetColor32(229, 242, 255, 220) : color,
    );
    this.sprite.setStrokeStyle(on ? 4.5 : 2.5, glow, on ? 1 : 0.78);
    this.sheen.setAlpha(on ? 0.4 : 0.26);
  }

  setActive(active: boolean): this {
    super.setActive(active);
    this.setVisible(active);
    return this;
  }
}
