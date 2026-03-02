import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";

/**
 * Computes game dimensions that fill the window while maintaining
 * the 800×480 aspect ratio (or filling the screen on mobile).
 */
function getGameDimensions(): { width: number; height: number } {
  const targetAspect = 800 / 480;
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const winAspect = winW / winH;

  if (winAspect > targetAspect) {
    // Window is wider than target — constrain by height
    return { width: Math.round(winH * targetAspect), height: winH };
  } else {
    return { width: winW, height: Math.round(winW / targetAspect) };
  }
}

const { width, height } = getGameDimensions();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width,
  height,
  resolution: window.devicePixelRatio || 1,
  parent: "game-container",
  backgroundColor: "#1a1a2e",
  physics: {
    default: "matter",
    matter: {
      gravity: { x: 0, y: 0 },
      debug: import.meta.env.DEV,
    },
  },
  scene: [BootScene, MenuScene, GameScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 2,
  },
};

const game = new Phaser.Game(config);

// Handle window resize (important for Capacitor / mobile)
window.addEventListener("resize", () => {
  const dims = getGameDimensions();
  game.scale.resize(dims.width, dims.height);
});
