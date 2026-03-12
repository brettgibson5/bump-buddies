import Phaser from "phaser";
import { getTopPlayers } from "../firebase/firebaseClient";
import { colyseusService } from "../network/ColyseusClient";
import { getCurrentUser } from "../firebase/firebaseClient";

type QualityTier = "low" | "medium" | "high" | "ultra";

/**
 * Main menu: Play Online, Local Pass-and-Play, Leaderboard.
 */
export class MenuScene extends Phaser.Scene {
  private qualityTier: QualityTier = "high";

  constructor() {
    super({ key: "MenuScene" });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.qualityTier =
      (this.registry.get("qualityTier") as QualityTier | undefined) ?? "high";

    this.ensureProceduralTextures();

    this.buildFantasyBackdrop(width, height);
    this.spawnAmbientMotes(width, height);

    // Scale everything to the shorter dimension so it works in landscape and portrait
    const ref = Math.min(width, height);
    const titleSize = Math.round(Phaser.Math.Clamp(ref * 0.14, 28, 56));
    const subtitleSize = Math.round(Phaser.Math.Clamp(ref * 0.055, 14, 22));
    const btnW = Math.round(Phaser.Math.Clamp(width * 0.45, 180, 320));
    const btnH = Math.round(Phaser.Math.Clamp(ref * 0.12, 40, 56));
    const btnFontSize = Math.round(Phaser.Math.Clamp(ref * 0.05, 14, 20));

    // Title
    this.add
      .text(cx, height * 0.18, "PinBuddys", {
        fontSize: `${titleSize}px`,
        color: "#f5d48a",
        fontFamily: "Georgia, Times New Roman, serif",
        fontStyle: "bold",
        stroke: "#2c1b12",
        strokeThickness: 6,
        shadow: {
          offsetX: 0,
          offsetY: 4,
          color: "#000000",
          blur: 12,
          fill: true,
          stroke: true,
        },
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setResolution(dpr);

    this.add
      .text(cx, height * 0.3, "Forge your throw. Claim the board.", {
        fontSize: `${subtitleSize}px`,
        color: "#d3c8b8",
        fontFamily: "Georgia, Times New Roman, serif",
        shadow: {
          offsetX: 0,
          offsetY: 2,
          color: "#000000",
          blur: 6,
          fill: true,
          stroke: false,
        },
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setResolution(dpr);

    const buttons: Array<{ label: string; y: number; action: () => void }> = [
      {
        label: "Play Online",
        y: height * 0.45,
        action: () => this.startOnline(),
      },
      {
        label: "Local Pass & Play",
        y: height * 0.57,
        action: () => this.startLocal(),
      },
      {
        label: "Join by Code",
        y: height * 0.69,
        action: () => this.joinByCode(),
      },
      {
        label: "Leaderboard",
        y: height * 0.81,
        action: () => this.showLeaderboard(),
      },
    ];

    for (const btn of buttons) {
      this.makeButton(
        cx,
        btn.y,
        btn.label,
        btn.action,
        btnW,
        btnH,
        btnFontSize,
      );
    }

    this.addOrnateFrame(width, height);
    this.addPostFxLayers(width, height);
  }

  private tierValue<T>(values: Record<QualityTier, T>): T {
    return values[this.qualityTier] ?? values.high;
  }

  private ensureProceduralTextures(): void {
    if (!this.textures.exists("menu-frame-tile")) {
      const frame = this.textures.createCanvas("menu-frame-tile", 64, 64);
      if (frame) {
        const ctx = frame.getContext();
        const grad = ctx.createLinearGradient(0, 0, 64, 64);
        grad.addColorStop(0, "#2b1a12");
        grad.addColorStop(0.5, "#5c3c24");
        grad.addColorStop(1, "#2a1a12");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);

        for (let i = 0; i < 90; i++) {
          ctx.fillStyle =
            i % 2 ? "rgba(232, 199, 126, 0.08)" : "rgba(20, 12, 8, 0.16)";
          const y = Math.random() * 64;
          const h = 1 + Math.random() * 1.2;
          ctx.fillRect(0, y, 64, h);
        }

        ctx.strokeStyle = "rgba(246, 219, 158, 0.22)";
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, 62, 62);
        frame.refresh();
      }
    }

    if (!this.textures.exists("menu-button-base")) {
      const base = this.textures.createCanvas("menu-button-base", 256, 96);
      if (base) {
        const ctx = base.getContext();
        ctx.clearRect(0, 0, 256, 96);

        const outer = ctx.createLinearGradient(0, 0, 0, 96);
        outer.addColorStop(0, "#7b5a36");
        outer.addColorStop(1, "#3f2a1a");
        ctx.fillStyle = outer;
        this.drawRoundRect(ctx, 0, 0, 256, 96, 22);
        ctx.fill();

        const inner = ctx.createLinearGradient(0, 6, 0, 90);
        inner.addColorStop(0, "#6d4a2f");
        inner.addColorStop(0.48, "#4b3224");
        inner.addColorStop(1, "#2f211a");
        ctx.fillStyle = inner;
        this.drawRoundRect(ctx, 6, 6, 244, 84, 18);
        ctx.fill();

        ctx.strokeStyle = "rgba(252, 227, 173, 0.75)";
        ctx.lineWidth = 3;
        this.drawRoundRect(ctx, 7.5, 7.5, 241, 81, 17);
        ctx.stroke();

        const gloss = ctx.createLinearGradient(0, 10, 0, 50);
        gloss.addColorStop(0, "rgba(255,255,255,0.22)");
        gloss.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gloss;
        this.drawRoundRect(ctx, 12, 12, 232, 34, 12);
        ctx.fill();

        base.refresh();
      }
    }
  }

  private drawRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private spawnAmbientMotes(width: number, height: number): void {
    const moteCount = this.tierValue({
      low: 10,
      medium: 18,
      high: 28,
      ultra: 38,
    });
    const drift = this.tierValue({ low: 24, medium: 34, high: 44, ultra: 56 });

    for (let i = 0; i < moteCount; i++) {
      const x = Phaser.Math.Between(8, Math.max(9, width - 8));
      const y = Phaser.Math.Between(8, Math.max(9, height - 8));
      const r = Phaser.Math.FloatBetween(0.7, 2.1);
      const color = i % 3 === 0 ? 0xf9d88e : i % 3 === 1 ? 0x86c9ff : 0xffb38e;
      const mote = this.add
        .circle(x, y, r, color, Phaser.Math.FloatBetween(0.08, 0.24))
        .setDepth(-8);

      this.tweens.add({
        targets: mote,
        x: x + Phaser.Math.Between(-drift, drift),
        y: y + Phaser.Math.Between(-drift, drift),
        alpha: { from: mote.alpha * 0.65, to: mote.alpha },
        duration: Phaser.Math.Between(2600, 6200),
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  private addPostFxLayers(width: number, height: number): void {
    const vignetteTextureKey = `menu-vignette-${width}x${height}`;
    if (!this.textures.exists(vignetteTextureKey)) {
      const tex = this.textures.createCanvas(vignetteTextureKey, width, height);
      if (tex) {
        const ctx = tex.getContext();
        const cx = width / 2;
        const cy = height / 2;
        const innerR = Math.min(width, height) * 0.24;
        const outerR = Math.max(width, height) * 0.62;
        const g = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0,0.88)");
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        tex.refresh();
      }
    }

    const vignetteAlpha = this.tierValue({
      low: 0.24,
      medium: 0.31,
      high: 0.38,
      ultra: 0.44,
    });
    this.add
      .image(width / 2, height / 2, vignetteTextureKey)
      .setAlpha(vignetteAlpha)
      .setDepth(19);

    const bloomAlpha = this.tierValue({
      low: 0.08,
      medium: 0.11,
      high: 0.14,
      ultra: 0.18,
    });
    this.add
      .ellipse(
        width * 0.5,
        height * 0.14,
        width * 0.55,
        height * 0.24,
        0xffd99b,
        bloomAlpha,
      )
      .setDepth(18);
    this.add
      .ellipse(
        width * 0.5,
        height * 0.88,
        width * 0.62,
        height * 0.2,
        0x6ca6d2,
        bloomAlpha * 0.7,
      )
      .setDepth(18);
  }

  private buildFantasyBackdrop(width: number, height: number): void {
    const bg = this.add.graphics().setDepth(-10);

    bg.fillGradientStyle(0x120e1e, 0x1e1626, 0x22152d, 0x2b1d3c, 1);
    bg.fillRect(0, 0, width, height);

    bg.fillGradientStyle(0x6e4a2a, 0x6e4a2a, 0x130f1d, 0x130f1d, 0.22);
    bg.fillRect(0, 0, width, height);

    const leftGlow = this.add
      .ellipse(
        width * 0.18,
        height * 0.45,
        width * 0.55,
        height * 0.95,
        0x4a8bb6,
        0.16,
      )
      .setDepth(-9);
    const rightGlow = this.add
      .ellipse(
        width * 0.82,
        height * 0.45,
        width * 0.55,
        height * 0.95,
        0xb76545,
        0.16,
      )
      .setDepth(-9);
    const topGlow = this.add
      .ellipse(
        width * 0.5,
        height * 0.04,
        width * 0.6,
        height * 0.35,
        0xe4be7a,
        0.12,
      )
      .setDepth(-9);

    this.tweens.add({
      targets: [leftGlow, rightGlow, topGlow],
      alpha: { from: 0.1, to: 0.2 },
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private addOrnateFrame(width: number, height: number): void {
    const inset = Math.round(Math.min(width, height) * 0.02);
    const thickness = Math.max(14, Math.round(Math.min(width, height) * 0.03));

    this.add
      .tileSprite(
        width / 2,
        inset + thickness / 2,
        width - inset * 2,
        thickness,
        "menu-frame-tile",
      )
      .setDepth(20);
    this.add
      .tileSprite(
        width / 2,
        height - inset - thickness / 2,
        width - inset * 2,
        thickness,
        "menu-frame-tile",
      )
      .setDepth(20);
    this.add
      .tileSprite(
        inset + thickness / 2,
        height / 2,
        thickness,
        height - inset * 2,
        "menu-frame-tile",
      )
      .setDepth(20);
    this.add
      .tileSprite(
        width - inset - thickness / 2,
        height / 2,
        thickness,
        height - inset * 2,
        "menu-frame-tile",
      )
      .setDepth(20);

    const corners = [
      [inset + 12, inset + 12],
      [width - inset - 12, inset + 12],
      [inset + 12, height - inset - 12],
      [width - inset - 12, height - inset - 12],
    ];

    for (const [x, y] of corners) {
      this.add.circle(x, y, 5, 0xe7cb90, 0.9).setDepth(21);
      this.add.circle(x, y, 9, 0x51331a, 0.5).setDepth(20);
    }
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    btnW = 220,
    btnH = 44,
    fontSize = 18,
  ): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const shadow = this.add
      .rectangle(x, y + 3, btnW + 10, btnH + 10, 0x000000, 0.4)
      .setDepth(3);
    const outer = this.add
      .image(x, y, "menu-button-base")
      .setDisplaySize(btnW + 8, btnH + 8)
      .setDepth(4)
      .setInteractive({ useHandCursor: true });
    const inner = this.add
      .image(x, y, "menu-button-base")
      .setDisplaySize(btnW, btnH)
      .setDepth(5);
    inner.setTint(0xd2a66e, 0xb8834f, 0x8b5e37, 0x714828);
    const topGloss = this.add
      .image(x, y - btnH * 0.23, "menu-button-base")
      .setDisplaySize(btnW * 0.85, btnH * 0.38)
      .setAlpha(0.08)
      .setDepth(6);

    const text = this.add
      .text(x, y, label, {
        fontSize: `${fontSize}px`,
        color: "#f7ead0",
        fontFamily: "Georgia, Times New Roman, serif",
        fontStyle: "bold",
        stroke: "#2f1d13",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(7)
      .setResolution(dpr);

    void text;
    outer.on("pointerover", () => {
      inner.setTint(0xf0c180, 0xd89f62, 0xa56d41, 0x885732);
      topGloss.setAlpha(0.14);
      this.tweens.add({
        targets: [outer, inner],
        scaleX: 1.02,
        scaleY: 1.02,
        duration: 120,
        ease: "Sine.easeOut",
      });
    });
    outer.on("pointerout", () => {
      inner.setTint(0xd2a66e, 0xb8834f, 0x8b5e37, 0x714828);
      topGloss.setAlpha(0.08);
      this.tweens.add({
        targets: [outer, inner],
        scaleX: 1,
        scaleY: 1,
        duration: 120,
        ease: "Sine.easeOut",
      });
    });
    outer.on("pointerdown", () => {
      this.tweens.add({
        targets: [shadow, outer, inner, topGloss, text],
        y: "+=2",
        duration: 45,
        yoyo: true,
        ease: "Quad.easeOut",
      });
      onClick();
    });
  }

  private async startOnline(): Promise<void> {
    const user = getCurrentUser();
    try {
      await colyseusService.matchmake({
        displayName: user?.displayName ?? "Player",
        firebaseUid: user?.uid ?? "",
      });
      this.scene.start("GameScene", { mode: "online", isLocal: false });
    } catch (err) {
      console.error("[Menu] Matchmaking failed:", err);
      this.showError("Could not connect to server. Is it running?");
    }
  }

  private startLocal(): void {
    this.scene.start("GameScene", { mode: "local", isLocal: true });
  }

  private async joinByCode(): Promise<void> {
    // Simple prompt fallback — replace with a proper in-game dialog
    const code = window.prompt("Enter room code:");
    if (!code) return;
    const user = getCurrentUser();
    try {
      await colyseusService.joinRoom(code.trim(), {
        displayName: user?.displayName ?? "Player",
        firebaseUid: user?.uid ?? "",
      });
      this.scene.start("GameScene", { mode: "online", isLocal: false });
    } catch (err) {
      console.error("[Menu] Join by code failed:", err);
      this.showError("Room not found. Check the code and try again.");
    }
  }

  private async showLeaderboard(): Promise<void> {
    try {
      const players = await getTopPlayers(10);
      let text = "── Top Players ──\n\n";
      players.forEach((p, i) => {
        text += `${i + 1}. ${p.displayName}  ${p.wins}W / ${p.losses}L\n`;
      });
      window.alert(text);
    } catch {
      window.alert("Leaderboard unavailable (Firebase not configured).");
    }
  }

  private showError(msg: string): void {
    const { width, height } = this.scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const t = this.add
      .text(width / 2, height * 0.92, msg, {
        fontSize: "14px",
        color: "#ff6b6b",
        fontFamily: "Arial",
      })
      .setOrigin(0.5)
      .setResolution(dpr);
    this.time.delayedCall(3000, () => t.destroy());
  }
}
