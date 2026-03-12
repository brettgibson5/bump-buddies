import Phaser from "phaser";
import { ARENA } from "@pinbuddys/shared";

type QualityTier = "low" | "medium" | "high" | "ultra";

/**
 * Draws the arena background, center divider, and scoring-zone highlights.
 * In landscape: endzones are left/right columns.
 * In portrait:  endzones are top/bottom rows (phone held vertically, players at each end).
 */
export class Arena extends Phaser.GameObjects.Container {
  private leftHighlight!: Phaser.GameObjects.Rectangle;
  private rightHighlight!: Phaser.GameObjects.Rectangle;
  // In portrait these become top/bottom highlights
  private topHighlight!: Phaser.GameObjects.Rectangle;
  private bottomHighlight!: Phaser.GameObjects.Rectangle;

  private portrait: boolean;
  private qualityTier: QualityTier;

  constructor(scene: Phaser.Scene, sceneW: number, sceneH: number) {
    super(scene, 0, 0);
    this.portrait = sceneH > sceneW;
    this.qualityTier =
      (scene.registry.get("qualityTier") as QualityTier | undefined) ?? "high";

    if (this.portrait) {
      this.buildPortrait(sceneW, sceneH);
    } else {
      this.buildLandscape(sceneW, sceneH);
    }

    this.addAmbientMotes(sceneW, sceneH);
    this.addPostFxLayers(sceneW, sceneH);

    scene.add.existing(this);
  }

  private tierValue<T>(values: Record<QualityTier, T>): T {
    return values[this.qualityTier] ?? values.high;
  }

  private addAmbientMotes(w: number, h: number): void {
    const count = this.tierValue({ low: 8, medium: 14, high: 22, ultra: 30 });
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(8, Math.max(9, w - 8));
      const y = Phaser.Math.Between(8, Math.max(9, h - 8));
      const r = Phaser.Math.FloatBetween(0.6, 1.6);
      const color = i % 2 === 0 ? 0xf6d79f : 0x8ec8f2;
      const mote = this.scene.add.circle(
        x,
        y,
        r,
        color,
        Phaser.Math.FloatBetween(0.07, 0.18),
      );
      this.add(mote);

      this.scene.tweens.add({
        targets: mote,
        x: x + Phaser.Math.Between(-34, 34),
        y: y + Phaser.Math.Between(-34, 34),
        alpha: { from: mote.alpha * 0.6, to: mote.alpha },
        duration: Phaser.Math.Between(2800, 6200),
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  private addPostFxLayers(w: number, h: number): void {
    const vignetteTextureKey = `arena-vignette-${w}x${h}`;
    if (!this.scene.textures.exists(vignetteTextureKey)) {
      const tex = this.scene.textures.createCanvas(vignetteTextureKey, w, h);
      if (tex) {
        const ctx = tex.getContext();
        const cx = w / 2;
        const cy = h / 2;
        const innerR = Math.min(w, h) * 0.22;
        const outerR = Math.max(w, h) * 0.63;
        const g = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0,0.9)");
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        tex.refresh();
      }
    }

    const vignette = this.scene.add.image(w / 2, h / 2, vignetteTextureKey);
    vignette.setAlpha(
      this.tierValue({ low: 0.18, medium: 0.24, high: 0.31, ultra: 0.37 }),
    );
    this.add(vignette);

    const bloomAlpha = this.tierValue({
      low: 0.05,
      medium: 0.08,
      high: 0.1,
      ultra: 0.14,
    });
    this.add(
      this.scene.add.ellipse(
        w / 2,
        h * 0.12,
        w * 0.46,
        h * 0.14,
        0xffdca2,
        bloomAlpha,
      ),
    );
    this.add(
      this.scene.add.ellipse(
        w / 2,
        h * 0.88,
        w * 0.56,
        h * 0.16,
        0x7fb6e3,
        bloomAlpha * 0.7,
      ),
    );
  }

  // ─── Landscape layout (endzones left / right) ───────────────────────────────

  private buildLandscape(w: number, h: number): void {
    const sx = w / ARENA.WIDTH;
    const endW = ARENA.LEFT_ENDZONE_END * sx;

    // Layered table background
    this.add([
      this.scene.add.rectangle(w / 2, h / 2, w, h, 0x120e1b),
      this.scene.add.rectangle(
        w / 2,
        h / 2,
        w * 0.96,
        h * 0.92,
        0x21172b,
        0.92,
      ),
      this.scene.add.rectangle(w / 2, h / 2, w * 0.86, h * 0.8, 0x2a1f34, 0.7),
    ]);

    // Team halves tint
    this.add([
      this.scene.add.rectangle(w / 4, h / 2, w / 2, h, 0x234a63, 0.17),
      this.scene.add.rectangle((w * 3) / 4, h / 2, w / 2, h, 0x6a3d2a, 0.17),
    ]);

    // Soft center glow
    this.add(
      this.scene.add.ellipse(w / 2, h / 2, w * 0.56, h * 0.9, 0xe7c98f, 0.08),
    );

    // Scoring highlights (flash on score)
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

    // Endzone overlays
    const leftZone = this.scene.add
      .rectangle(0, 0, endW, h, 0x0f141b, 0.54)
      .setOrigin(0);
    const rightZone = this.scene.add
      .rectangle(w - endW, 0, endW, h, 0x1e1412, 0.54)
      .setOrigin(0);
    this.add([leftZone, rightZone]);

    // Decorative edge rails
    this.add([
      this.scene.add.rectangle(endW / 2, h / 2, 3, h * 0.92, 0xe5c988, 0.45),
      this.scene.add.rectangle(
        w - endW / 2,
        h / 2,
        3,
        h * 0.92,
        0xe5c988,
        0.45,
      ),
    ]);

    // Dashed endzone boundary lines
    const eLine = this.scene.add.graphics();
    eLine.lineStyle(1, 0xf0deba, 0.24);
    for (const x of [endW, w - endW]) {
      this.drawDashedLineV(eLine, x, 0, h, 8, 6);
    }
    this.add(eLine);

    // Center divider with glow
    this.add(
      this.scene.add.rectangle(w / 2, h / 2, 10, h * 0.8, 0xe8c98d, 0.08),
    );
    const cLine = this.scene.add.graphics();
    cLine.lineStyle(2, 0xf8e8c5, 0.55);
    this.drawDashedLineV(cLine, w / 2, 0, h, 12, 8);
    this.add(cLine);

    this.drawOrnateCorners(w, h);
  }

  // ─── Portrait layout (endzones top / bottom) ────────────────────────────────

  private buildPortrait(w: number, h: number): void {
    // In portrait: ARENA.WIDTH maps to the screen height (long axis),
    //              ARENA.HEIGHT maps to the screen width (short axis).
    const sy = h / ARENA.WIDTH;
    const endH = ARENA.LEFT_ENDZONE_END * sy; // endzone depth in screen px

    // Layered table background
    this.add([
      this.scene.add.rectangle(w / 2, h / 2, w, h, 0x120e1b),
      this.scene.add.rectangle(
        w / 2,
        h / 2,
        w * 0.92,
        h * 0.96,
        0x22182d,
        0.92,
      ),
      this.scene.add.rectangle(w / 2, h / 2, w * 0.82, h * 0.86, 0x2a1f34, 0.7),
    ]);

    // Halves tint (top = P2, bottom = P1)
    this.add([
      this.scene.add.rectangle(w / 2, h / 4, w, h / 2, 0x6a3d2a, 0.17), // top (P2)
      this.scene.add.rectangle(w / 2, (h * 3) / 4, w, h / 2, 0x234a63, 0.17), // bottom (P1)
    ]);

    this.add(
      this.scene.add.ellipse(w / 2, h / 2, w * 0.8, h * 0.56, 0xe7c98f, 0.08),
    );

    // Scoring highlights
    this.topHighlight = this.scene.add.rectangle(
      w / 2,
      h / 4,
      w,
      h / 2,
      0xf72585,
      0,
    );
    this.bottomHighlight = this.scene.add.rectangle(
      w / 2,
      (h * 3) / 4,
      w,
      h / 2,
      0x4cc9f0,
      0,
    );
    this.add([this.topHighlight, this.bottomHighlight]);
    // Map to left/right names for flashScore API compatibility
    this.leftHighlight = this.bottomHighlight;
    this.rightHighlight = this.topHighlight;

    // Endzone overlays
    const topZone = this.scene.add
      .rectangle(0, 0, w, endH, 0x1e1412, 0.54)
      .setOrigin(0);
    const bottomZone = this.scene.add
      .rectangle(0, h - endH, w, endH, 0x0f141b, 0.54)
      .setOrigin(0);
    this.add([topZone, bottomZone]);

    this.add([
      this.scene.add.rectangle(w / 2, endH / 2, w * 0.9, 3, 0xe5c988, 0.45),
      this.scene.add.rectangle(w / 2, h - endH / 2, w * 0.9, 3, 0xe5c988, 0.45),
    ]);

    // Dashed endzone boundary lines (horizontal)
    const eLine = this.scene.add.graphics();
    eLine.lineStyle(1, 0xf0deba, 0.24);
    for (const y of [endH, h - endH]) {
      this.drawDashedLineH(eLine, 0, w, y, 8, 6);
    }
    this.add(eLine);

    // Center divider (horizontal) with glow
    this.add(
      this.scene.add.rectangle(w / 2, h / 2, w * 0.8, 10, 0xe8c98d, 0.08),
    );
    const cLine = this.scene.add.graphics();
    cLine.lineStyle(2, 0xf8e8c5, 0.55);
    this.drawDashedLineH(cLine, 0, w, h / 2, 12, 8);
    this.add(cLine);

    this.drawOrnateCorners(w, h);
  }

  private drawOrnateCorners(w: number, h: number): void {
    const g = this.scene.add.graphics();
    g.lineStyle(2, 0xe4c17d, 0.7);
    const pad = 14;
    const arm = 26;

    // Top-left
    g.beginPath();
    g.moveTo(pad, pad + arm);
    g.lineTo(pad, pad);
    g.lineTo(pad + arm, pad);
    g.strokePath();

    // Top-right
    g.beginPath();
    g.moveTo(w - pad - arm, pad);
    g.lineTo(w - pad, pad);
    g.lineTo(w - pad, pad + arm);
    g.strokePath();

    // Bottom-left
    g.beginPath();
    g.moveTo(pad, h - pad - arm);
    g.lineTo(pad, h - pad);
    g.lineTo(pad + arm, h - pad);
    g.strokePath();

    // Bottom-right
    g.beginPath();
    g.moveTo(w - pad - arm, h - pad);
    g.lineTo(w - pad, h - pad);
    g.lineTo(w - pad, h - pad - arm);
    g.strokePath();

    this.add(g);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private drawDashedLineV(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y0: number,
    y1: number,
    dashLen: number,
    gap: number,
  ): void {
    let y = y0;
    while (y < y1) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, Math.min(y + dashLen, y1));
      g.strokePath();
      y += dashLen + gap;
    }
  }

  private drawDashedLineH(
    g: Phaser.GameObjects.Graphics,
    x0: number,
    x1: number,
    y: number,
    dashLen: number,
    gap: number,
  ): void {
    let x = x0;
    while (x < x1) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(Math.min(x + dashLen, x1), y);
      g.strokePath();
      x += dashLen + gap;
    }
  }

  /**
   * Flash the scoring zone. In landscape: "left"=P1 half, "right"=P2 half.
   * In portrait:  "left"=P1 bottom half, "right"=P2 top half.
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
