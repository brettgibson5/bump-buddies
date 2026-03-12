import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";

type QualityTier = "low" | "medium" | "high" | "ultra";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: "game-container",
  backgroundColor: "#1a1a2e",
  render: {
    antialias: true,
    roundPixels: false,
  },
  physics: {
    default: "matter",
    matter: {
      gravity: { x: 0, y: 0 },
      debug: import.meta.env.DEV,
    },
  },
  scene: [BootScene, MenuScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
  },
  input: {
    activePointers: 2,
  },
};

const game = new Phaser.Game(config);

// Phaser's Scale.RESIZE mode does not apply devicePixelRatio to the canvas pixel buffer.
// We fix this by going through Phaser's own renderer.resize() path with resolution set to
// the DPR — it correctly sets renderer.width/height to physical pixels (so every camera
// calls gl.viewport at the right size) while passing logical dims to setProjectionMatrix
// (so game coordinates continue to map correctly to the screen).
game.events.once("ready", () => {
  const renderer = game.renderer as any;
  const maxDpr = 4;
  const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);

  const detectQualityTier = (): QualityTier => {
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency ?? 4;
    const memory =
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

    const score =
      dpr * 1.1 + Math.min(cores, 12) * 0.16 + Math.min(memory, 8) * 0.22;
    if (score >= 5.3) return "ultra";
    if (score >= 4.2) return "high";
    if (score >= 3.2) return "medium";
    return "low";
  };

  const resolutionBoostByTier: Record<QualityTier, number> = {
    low: 1.0,
    medium: 1.08,
    high: 1.2,
    ultra: isMobile ? 1.28 : 1.35,
  };

  const getViewportSize = () => {
    const vv = window.visualViewport;
    return {
      w: Math.max(1, Math.round(vv?.width ?? window.innerWidth)),
      h: Math.max(1, Math.round(vv?.height ?? window.innerHeight)),
    };
  };

  const applyDPR = () => {
    const qualityTier = detectQualityTier();
    const qualityBoost = resolutionBoostByTier[qualityTier];
    const nativeDpr = window.devicePixelRatio || 1;
    const renderResolution = Math.min(nativeDpr * qualityBoost, maxDpr);
    const { w, h } = getViewportSize();

    game.registry.set("qualityTier", qualityTier);
    game.registry.set("renderResolution", renderResolution);

    if (game.scale.width !== w || game.scale.height !== h) {
      game.scale.resize(w, h);
    }

    // Keep renderer and canvas pixel buffer in physical pixels while CSS remains logical.
    renderer.resolution = renderResolution;
    renderer.resize(w, h);

    game.canvas.style.width = `${w}px`;
    game.canvas.style.height = `${h}px`;

    // CanvasRenderer needs an explicit context transform to map logical coordinates.
    if (game.renderer.type === Phaser.CANVAS) {
      const ctx = game.canvas.getContext(
        "2d",
      ) as CanvasRenderingContext2D | null;
      if (ctx) {
        ctx.setTransform(renderResolution, 0, 0, renderResolution, 0, 0);
      }
    }
  };

  applyDPR();
  game.scale.on("resize", applyDPR);
  window.addEventListener("resize", applyDPR);
  window.visualViewport?.addEventListener("resize", applyDPR);

  // Re-apply when the browser moves to a monitor with a different DPR.
  const observeDPR = () => {
    const dpr = window.devicePixelRatio || 1;
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    mq.addEventListener(
      "change",
      () => {
        applyDPR();
        observeDPR();
      },
      { once: true },
    );
  };
  observeDPR();
});
