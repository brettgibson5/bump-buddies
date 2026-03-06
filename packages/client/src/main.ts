import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";

function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}

function getGameDims(): { width: number; height: number } {
  return {
    width: Math.max(window.innerWidth, window.innerHeight),
    height: Math.min(window.innerWidth, window.innerHeight),
  };
}

/** CSS-rotate the canvas 90° CCW so a landscape canvas fills a portrait screen. */
function applyCanvasTransform(canvas: HTMLCanvasElement): void {
  if (isPortrait()) {
    canvas.style.transformOrigin = "top left";
    canvas.style.transform = "rotate(-90deg) translateX(-100%)";
  } else {
    canvas.style.transformOrigin = "";
    canvas.style.transform = "";
  }
}

const { width, height } = getGameDims();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width,
  height,
  resolution: window.devicePixelRatio || 1,
  parent: "game-container",
  backgroundColor: "#1a1a2e",
  render: {
    antialias: true,
    roundPixels: true,
  },
  physics: {
    default: "matter",
    matter: {
      gravity: { x: 0, y: 0 },
      debug: import.meta.env.DEV,
    },
  },
  scene: [BootScene, MenuScene, GameScene],
  // NONE: we manage canvas sizing manually so portrait CSS-rotation works correctly.
  // Scale.RESIZE would override landscape dims to match the portrait container.
  scale: {
    mode: Phaser.Scale.NONE,
  },
  input: {
    activePointers: 2,
  },
};

const game = new Phaser.Game(config);

// Lock to landscape on Android; iOS PWA respects manifest orientation: landscape
if (screen.orientation?.lock) {
  screen.orientation.lock("landscape").catch(() => {});
}

// Patch Phaser's input coordinate transform for portrait mode.
// When the canvas is CSS-rotated -90°, a screen touch at (px, py) maps to
// canvas coords (gameWidth - py, px). We intercept transformX/transformY on
// the ScaleManager, using a captured "sibling" coordinate stored just before
// Phaser's own pointer handlers fire (capture-phase listener).
let _lastPageX = 0;
let _lastPageY = 0;

game.events.once("ready", () => {
  const canvas = game.canvas;
  applyCanvasTransform(canvas);

  // Capture raw page coords before Phaser sees the event
  const captureCoords = (e: Event): void => {
    if (e instanceof TouchEvent) {
      _lastPageX = e.touches[0]?.pageX ?? _lastPageX;
      _lastPageY = e.touches[0]?.pageY ?? _lastPageY;
    } else if (e instanceof PointerEvent) {
      _lastPageX = e.pageX;
      _lastPageY = e.pageY;
    }
  };
  for (const type of ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove", "touchend"]) {
    canvas.addEventListener(type, captureCoords, { capture: true, passive: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scaleMgr = game.scale as any;
  const origTX = scaleMgr.transformX.bind(scaleMgr) as (x: number) => number;
  const origTY = scaleMgr.transformY.bind(scaleMgr) as (y: number) => number;

  scaleMgr.transformX = (_pageX: number): number => {
    if (isPortrait()) {
      // canvas_x = gameWidth - pageY
      return game.scale.width - _lastPageY;
    }
    return origTX(_pageX);
  };

  scaleMgr.transformY = (_pageY: number): number => {
    if (isPortrait()) {
      // canvas_y = pageX
      return _lastPageX;
    }
    return origTY(_pageY);
  };
});

window.addEventListener("resize", () => {
  const { width, height } = getGameDims();
  game.scale.resize(width, height);
  if (game.canvas) {
    applyCanvasTransform(game.canvas);
    game.scale.updateBounds();
  }
});
