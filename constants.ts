import {SpriteConfig} from './utils/helper';

/**
 * THEME definition for Kinetic Serpent
 */
export const THEME = {
  fontFamily: "'Chakra Petch', 'Orbitron', 'Rajdhani', monospace, sans-serif",
  colors: {
    bgDark: '#050811',
    gridLines: '#0a192f',
    cyanGlow: '#00f0ff',
    emeraldCore: '#00ff88',
    crimsonMine: '#ff0055',
    amberWarning: '#ffb700',
    purpleShield: '#9d4edd',
    panelBg: 'rgba(7, 14, 28, 0.92)',
    panelBorder: '#00f0ff44',
  },
};

/**
 * Configuration for Kinetic Serpent.
 */
export const CONFIG = {
  // GAME
  title: {
    value: 'Kinetic Serpent',
    type: 'string',
    label: 'Game Title',
    group: 'GAME',
  },
  baseCanvasWidth: {
    value: 1376,
    type: 'number',
    label: 'Base Canvas Width',
    group: 'GAME',
  },
  baseCanvasHeight: {
    value: 768,
    type: 'number',
    label: 'Base Canvas Height',
    group: 'GAME',
  },

  // SYSTEM
  targetFPS: {
    value: 60,
    type: 'number',
    label: 'Target FPS',
    group: 'SYSTEM',
  },
  stepMs: {
    value: 1000 / 60,
    type: 'number',
    label: 'Step MS',
    group: 'SYSTEM',
  },
  maxSubSteps: {
    value: 5,
    type: 'number',
    label: 'Max Sub Steps',
    group: 'SYSTEM',
  },

  // THEME
  backgroundColor: {
    value: '#050811',
    type: 'color',
    label: 'Background Color',
    group: 'THEME',
  },
  primaryColor: {
    value: '#00f0ff',
    type: 'color',
    label: 'Primary Color',
    group: 'THEME',
  },
  fontFamily: {
    value: "'Chakra Petch', 'Orbitron', monospace, sans-serif",
    type: 'string',
    label: 'Font Family',
    group: 'THEME',
  },

  // AUDIO
  defaultMusicVolume: {
    value: 0.5,
    type: 'number',
    label: 'Default Music Volume',
    group: 'AUDIO',
  },
  defaultSfxVolume: {
    value: 0.6,
    type: 'number',
    label: 'Default SFX Volume',
    group: 'AUDIO',
  },

  // RULES & GAMEPLAY
  gridSize: {
    value: 24,
    type: 'number',
    label: 'Grid Dimension (24x24)',
    group: 'RULES',
  },
  initialSpeed: {
    value: 0.675,
    type: 'number',
    label: 'Base Step Interval (s)',
    group: 'RULES',
  },
  minSpeed: {
    value: 0.375,
    type: 'number',
    label: 'Minimum Step Interval (s)',
    group: 'RULES',
  },
  speedStep: {
    value: 0.01,
    type: 'number',
    label: 'Speed Boost per 5 Orbs',
    group: 'RULES',
  },
  brakeCharges: {
    value: 3,
    type: 'number',
    label: 'Starting Brake Charges',
    group: 'RULES',
  },
  brakeDuration: {
    value: 3.0,
    type: 'number',
    label: 'Shield Freeze Duration (s)',
    group: 'RULES',
  },
  hazardWarningTime: {
    value: 1.0,
    type: 'number',
    label: 'Hazard Warning Time (s)',
    group: 'RULES',
  },
  scorePerFood: {
    value: 10,
    type: 'number',
    label: 'Score per Energy Core',
    group: 'RULES',
  },

  // ASSETS (exact resolutions from read_assets_metadata)
  assetBgNeonGridAspectRatio: {
    value: 1376 / 768, // 1.791667
    type: 'number',
    label: 'Background Neon Grid Aspect Ratio',
    group: 'ASSETS',
  },
  assetBgNeonGridWidth: {
    value: 1376,
    type: 'number',
    label: 'Background Neon Grid Width',
    group: 'ASSETS',
  },
  assetBgNeonGridHeight: {
    value: 768,
    type: 'number',
    label: 'Background Neon Grid Height',
    group: 'ASSETS',
  },

  assetShieldBarrierAspectRatio: {
    value: 818 / 951, // 0.860147
    type: 'number',
    label: 'Shield Barrier Aspect Ratio',
    group: 'ASSETS',
  },
  assetShieldBarrierWidth: {
    value: 818,
    type: 'number',
    label: 'Shield Barrier Width',
    group: 'ASSETS',
  },
  assetShieldBarrierHeight: {
    value: 951,
    type: 'number',
    label: 'Shield Barrier Height',
    group: 'ASSETS',
  },

  assetHazardMineAspectRatio: {
    value: 702 / 717, // 0.979079
    type: 'number',
    label: 'Hazard Mine Aspect Ratio',
    group: 'ASSETS',
  },
  assetHazardMineWidth: {
    value: 702,
    type: 'number',
    label: 'Hazard Mine Width',
    group: 'ASSETS',
  },
  assetHazardMineHeight: {
    value: 717,
    type: 'number',
    label: 'Hazard Mine Height',
    group: 'ASSETS',
  },

  assetSerpentHeadAspectRatio: {
    value: 845 / 556, // 1.519784
    type: 'number',
    label: 'Serpent Head Aspect Ratio',
    group: 'ASSETS',
  },
  assetSerpentHeadWidth: {
    value: 845,
    type: 'number',
    label: 'Serpent Head Width',
    group: 'ASSETS',
  },
  assetSerpentHeadHeight: {
    value: 556,
    type: 'number',
    label: 'Serpent Head Height',
    group: 'ASSETS',
  },

  assetFoodCoreAspectRatio: {
    value: 655 / 654, // 1.001529
    type: 'number',
    label: 'Food Core Aspect Ratio',
    group: 'ASSETS',
  },
  assetFoodCoreWidth: {
    value: 655,
    type: 'number',
    label: 'Food Core Width',
    group: 'ASSETS',
  },
  assetFoodCoreHeight: {
    value: 654,
    type: 'number',
    label: 'Food Core Height',
    group: 'ASSETS',
  },
};

// Merge customized config values if present (injected by Playground)
const {playgroundConfig} = globalThis as {
  playgroundConfig?: Record<string, unknown>;
};
if (playgroundConfig) {
  for (const [key, value] of Object.entries(playgroundConfig)) {
    if (key in CONFIG) {
      Object.assign(CONFIG[key as keyof typeof CONFIG], {value});
    }
  }
}

/**
 * Type helper for reading values in game code
 */
export type ConfigKey = keyof typeof CONFIG;

/**
 * Gets a configuration value by key.
 * @param key The configuration key.
 * @return The configuration value.
 */
export function getConfig<K extends ConfigKey>(
  key: K,
): (typeof CONFIG)[K]['value'] {
  return CONFIG[key].value;
}
