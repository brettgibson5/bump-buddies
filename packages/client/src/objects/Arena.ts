import Phaser from "phaser";
import { ARENA } from "@pinbuddys/shared";

/**
 * Draws the arena background, center divider, and scoring-zone highlights.
 * Scaled to fill the scene's logical dimensions.
 */
export class Arena extends Phaser.GameObjects.Container {
  private scaleX_: number;
  private scaleY_: number;
  private leftHighlight!: Phaser.GameObjects.Rectangle;
  private rightHighlight!: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, sceneW: number, sceneH: number) {
    super(scene, 0, 0);

    this.scaleX_ = sceneW / ARENA.WIDTH;
    this.scaleY_ = sceneH / ARENA.HEIGHT;

    this.buildBackground(sceneW, sceneH);
    this.buildScoringHighlights(sceneW, sceneH);
    this.buildEndzones(sceneW, sceneH);
    this.buildDivider(sceneW, sceneH);

    scene.add.existing(this);
  }

  private buildBackground(w: number, h: number): void {
    // Left half
    const leftBg = this.scene.add.rectangle(w / 4, h / 2, w / 2, h, 0x1a1a3e);
    // Right half
    const rightBg = this.scene.add.rectangle(
      (w * 3) / 4,
      h / 2,
      w / 2,
      h,
      0x2a1a2e,
    );
    this.add([leftBg, rightBg]);
  }

  private buildScoringHighlights(w: number, h: number): void {
    this.leftHighlight = this.scene.add.rectangle(
      w / 4,
      h / 2,
      w / 2,
      h,
      0x4cc9f0,
      0,
    );
    this.rightHighlight = this.scene.add.rectangle(
      (w * 3) / 4,
      h / 2,
      w / 2,
      h,
      0xf72585,
      0,
    );
    this.add([this.leftHighlight, this.rightHighlight]);
  }

  private buildEndzones(w: number, h: number): void {
    const sx = this.scaleX_;
    const endW = ARENA.LEFT_ENDZONE_END * sx; // 200 arena units → screen px

    // Dark gray tint overlays — "danger zone" feel
    const leftZone = this.scene.add
      .rectangle(0, 0, endW, h, 0x111111, 0.55)
      .setOrigin(0);
    const rightZone = this.scene.add
      .rectangle(w - endW, 0, endW, h, 0x111111, 0.55)
      .setOrigin(0);
    this.add([leftZone, rightZone]);

    // Dashed boundary lines at x=200 and x=600
    const line = this.scene.add.graphics();
    line.lineStyle(1, 0xffffff, 0.2);
    const dashLen = 8;
    const gap = 6;
    for (const x of [endW, w - endW]) {
      let y = 0;
      while (y < h) {
        line.beginPath();
        line.moveTo(x, y);
        line.lineTo(x, Math.min(y + dashLen, h));
        line.strokePath();
        y += dashLen + gap;
      }
    }
    this.add(line);
  }

  private buildDivider(w: number, h: number): void {
    // Dashed center line
    const line = this.scene.add.graphics();
    line.lineStyle(2, 0xffffff, 0.3);
    const dashLen = 12;
    const gap = 8;
    let y = 0;
    while (y < h) {
      line.beginPath();
      line.moveTo(w / 2, y);
      line.lineTo(w / 2, Math.min(y + dashLen, h));
      line.strokePath();
      y += dashLen + gap;
    }
    this.add(line);
  }

  /**
   * Flash the scoring zone on the given side for visual feedback.
   * @param side "left" or "right"
   */
  flashScore(side: "left" | "right"): void {
    const rect = side === "left" ? this.leftHighlight : this.rightHighlight;
    this.scene.tweens.add({
      targets: rect,
      fillAlpha: 0.25,
      duration: 120,
      yoyo: true,
      repeat: 2,
      onComplete: () => rect.setAlpha(0),
    });
  }
}
