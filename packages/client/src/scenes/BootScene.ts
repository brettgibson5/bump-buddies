import Phaser from "phaser";
import { signInAnon, ensureUserProfile } from "../firebase/firebaseClient";

/**
 * First scene: loads assets and handles Firebase anonymous auth.
 * Transitions to MenuScene when ready.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    // Loading bar
    const { width, height } = this.scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const barW = 300;
    const barH = 20;
    const barX = (width - barW) / 2;
    const barY = height / 2;

    const bg = this.add
      .rectangle(barX, barY, barW, barH, 0x333355)
      .setOrigin(0, 0);
    const fill = this.add
      .rectangle(barX, barY, 0, barH, 0x4cc9f0)
      .setOrigin(0, 0);

    this.load.on("progress", (value: number) => {
      fill.width = barW * value;
    });

    this.add
      .text(width / 2, barY - 40, "PinBuddys", {
        fontSize: "32px",
        color: "#ffffff",
        fontFamily: "Arial",
      })
      .setOrigin(0.5)
      .setResolution(dpr);

    // --- Placeholder asset generation ---
    // In production replace these with actual texture atlases / spritesheets.
    // For now we generate solid-colour textures at runtime so the game runs
    // without any external asset files.

    // We don't need to preload anything here because Ball + Arena use
    // Phaser Graphics / Arc primitives. Real assets can be added later.
  }

  async create(): Promise<void> {
    try {
      const user = await signInAnon();
      await ensureUserProfile(user);
      console.log("[Boot] Signed in as", user.uid);
    } catch (err) {
      // Firebase may not be configured yet (missing env vars) — continue anyway
      console.warn("[Boot] Firebase auth skipped:", err);
    }

    this.scene.start("MenuScene");
  }
}
