// One implementation for the blocking first-paint bootstrap, ES modules and Node.
// The classic runtime is loaded before body parsing; this import reuses it.
import './continuousCornersRuntime.js';
export const { CORNER_PROFILE, APPLE_CORNER_EXTENT, APPLE_CORNER_COMMANDS,
  cornerCubics, continuousCornerPath, createCornerSVG, normalizeRadii, splitCSS,
  setupContinuousCorners } = globalThis.__EBCTFContinuousCorners;
