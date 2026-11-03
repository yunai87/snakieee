// tslint:disable
/* eslint-disable */
import {
  Activity,
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Circle,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Menu,
  Pause,
  Play,
  RotateCw,
  Shield,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {getConfig, THEME} from './constants';
import BackgroundMusic from './utils/BackgroundMusic';
import {
  createFixedStepper,
  drawAsset,
  drawBackground,
  formatTime,
  gameAudio,
  GameState,
  MenuOverlay,
  Overlay,
  prepareCanvas,
  useAssets,
  useAutoFocus,
  useInput,
  useIsMobile,
} from './utils/helper';
import {
  usePlayground,
  usePlaygroundGameLifecycle,
  useRpc,
} from './utils/usePlayground';

// Discovered Audio Asset
const BACKGROUND_MUSIC_URL = 'assets/audio/bgm_cyber_groove.mp3';

// Discovered Image Assets
const ASSETS_MANIFEST: Record<string, string> = {
  bg: 'assets/images/bg_neon_grid.png',
  serpentHead: 'assets/images/serpent_head.png',
  foodCore: 'assets/images/food_core.png',
  hazardMine: 'assets/images/hazard_mine.png',
  shieldBarrier: 'assets/images/shield_barrier.png',
};

type Heading = 0 | 1 | 2 | 3; // 0: East, 1: South, 2: West, 3: North

interface GridCoord {
  x: number;
  y: number;
}

interface HazardMine {
  id: number;
  x: number;
  y: number;
  isReady: boolean;
  spawnTimer: number; // in seconds
  pulsePhase: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  maxLife: number;
  life: number;
}

interface TurnIndicator {
  x: number;
  y: number;
  dir: 'left' | 'right';
  alpha: number;
}

// Built-in Teachable Machine pose model (左傾 / 右傾 / 自然狀態 / 暫停)
const DEFAULT_TM_MODEL_URL = 'https://teachablemachine.withgoogle.com/models/AYRH8wtQQ/';

// Pose detection tuning: lower confidence / fewer frames = faster but more false triggers
const TM_MIN_CONFIDENCE = 0.7; // model must be at least this sure of a pose
const TM_CONFIRM_FRAMES = 2; // consecutive matching predictions before acting
const TM_PREDICT_INTERVAL_MS = 50; // minimum gap between predictions

// Inject a CDN <script> once and resolve when it has loaded
const scriptPromises: Record<string, Promise<void>> = {};
function loadScriptOnce(src: string): Promise<void> {
  if (!scriptPromises[src]) {
    scriptPromises[src] = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        delete scriptPromises[src];
        reject(new Error(`無法載入 ${src}`));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromises[src];
}

// Map a Teachable Machine class name to a game gesture (English or Chinese names)
function labelToGesture(label: string): string {
  const l = label.toLowerCase();
  if (/left|左/.test(l)) return 'LEAN_LEFT';
  if (/right|右/.test(l)) return 'LEAN_RIGHT';
  if (/shield|freeze|brake|stop|盾|停|煞/.test(l)) return 'SHIELD_FREEZE';
  return 'NEUTRAL';
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const stepperRef = useRef<ReturnType<typeof createFixedStepper>>();
  const lastCancelRef = useRef(false);

  const isMobile = useIsMobile();

  // --- Playground SDK ---
  const {sdk, isReady} = usePlayground();
  const [exitChat] = useRpc<Record<string, unknown>, void>('ExitChat');

  const {assets, isReady: assetsReady} = useAssets(ASSETS_MANIFEST);

  const canvasWidth = getConfig('baseCanvasWidth') as number;
  const canvasHeight = getConfig('baseCanvasHeight') as number;
  const gridSize = getConfig('gridSize') as number;
  const baseStepInterval = getConfig('initialSpeed') as number;
  const minSpeed = getConfig('minSpeed') as number;
  const speedStep = getConfig('speedStep') as number;
  const startingBrakeCharges = getConfig('brakeCharges') as number;
  const brakeDuration = getConfig('brakeDuration') as number;
  const hazardWarningTime = getConfig('hazardWarningTime') as number;
  const scorePerFood = getConfig('scorePerFood') as number;

  // Grid layout geometry within canvas
  const cellSize = 28;
  const arenaPixelWidth = gridSize * cellSize; // 672
  const arenaPixelHeight = gridSize * cellSize; // 672
  const arenaX = Math.floor((canvasWidth - arenaPixelWidth) / 2); // 352
  const arenaY = Math.floor((canvasHeight - arenaPixelHeight) / 2); // 48

  if (!stepperRef.current) {
    const stepMs = getConfig('stepMs');
    const maxSubSteps = getConfig('maxSubSteps');
    stepperRef.current = createFixedStepper(stepMs, maxSubSteps);
  }

  // Persistent React State for HUD & Overlays
  const [gameState, setGameState] = useState<GameState>({
    status: 'START',
    score: 0,
    level: 1,
  });

  const [highScore, setHighScore] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('kinetic_serpent_highscore');
      return saved ? parseInt(saved, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });

  const [brakeChargesUI, setBrakeChargesUI] = useState<number>(startingBrakeCharges);
  const [isBrakingUI, setIsBrakingUI] = useState<boolean>(false);
  const [brakeTimeRemainingUI, setBrakeTimeRemainingUI] = useState<number>(0);
  const [coresCollectedUI, setCoresCollectedUI] = useState<number>(0);

  // Overlay & Audio Settings
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(false);
  const [isSfxMuted, setIsSfxMuted] = useState(false);

  // Webcam Pose Diagnostics (Supports actual webcam if user enables, plus auto-pose sensor fallback)
  const [webcamActive, setWebcamActive] = useState<boolean>(false);
  const [activeGesture, setActiveGesture] = useState<string>('NEUTRAL');
  const [poseConfidence, setPoseConfidence] = useState<number>(0.96);

  // Teachable Machine model (image or pose), loaded from a shareable model URL
  const [tmUrl, setTmUrl] = useState<string>(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('tm');
    if (fromQuery) return fromQuery;
    try {
      return localStorage.getItem('kinetic_serpent_tm_url') || DEFAULT_TM_MODEL_URL;
    } catch {
      return DEFAULT_TM_MODEL_URL;
    }
  });
  const [tmStatus, setTmStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [tmMessage, setTmMessage] = useState<string>('');
  const [tmTopLabel, setTmTopLabel] = useState<string>('');
  const [cameraError, setCameraError] = useState<string>('');
  // Debounced gesture from the camera, and which poses have passed the start-screen test
  const [tmLiveGesture, setTmLiveGesture] = useState<string>('NEUTRAL');
  const [poseTestPassed, setPoseTestPassed] = useState<Record<string, boolean>>({});
  const tmModelRef = useRef<{kind: 'image' | 'pose'; model: any} | null>(null);
  const tmPreviewCanvasRef = useRef<HTMLCanvasElement>(null);

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  useEffect(() => {
    (window as any).canHandleBackKey = gameState.status !== 'START';
  }, [gameState.status]);

  const inputRef = useInput(canvasRef, true, {
    width: canvasWidth,
    height: canvasHeight,
  });

  // --- High-Frequency Simulation State in Refs (Zero 60FPS bottlenecks) ---
  const snakeRef = useRef<{
    segments: GridCoord[];
    heading: Heading;
    desiredHeading: Heading;
    stepTimer: number;
    stepInterval: number;
    turnIndicators: TurnIndicator[];
  }>({
    segments: [
      {x: 12, y: 12},
      {x: 11, y: 12},
      {x: 10, y: 12},
      {x: 9, y: 12},
    ],
    heading: 0,
    desiredHeading: 0,
    stepTimer: 0,
    stepInterval: baseStepInterval,
    turnIndicators: [],
  });

  const foodRef = useRef<GridCoord>({x: 18, y: 12});
  const hazardsRef = useRef<HazardMine[]>([]);
  const nextHazardId = useRef(1);

  const brakeRef = useRef<{
    charges: number;
    active: boolean;
    timer: number;
    totalDuration: number;
  }>({
    charges: startingBrakeCharges,
    active: false,
    timer: 0,
    totalDuration: brakeDuration,
  });

  const particlesRef = useRef<Particle[]>([]);
  const screenShakeRef = useRef({amount: 0, decay: 8});
  const crtFlashRef = useRef<number>(0);
  const gameStatsRef = useRef({
    coresCollected: 0,
    score: 0,
  });

  // Turn edge detection refs
  const keyTurnLeftPressed = useRef(false);
  const keyTurnRightPressed = useRef(false);
  const keyShieldPressed = useRef(false);

  // Anti-jitter buffer for gesture processing (3-frame confirmation as per GDD)
  const poseBufferRef = useRef<{gesture: string; count: number}>({
    gesture: 'NEUTRAL',
    count: 0,
  });

  // Lifecycle reporting
  usePlaygroundGameLifecycle(gameState, sdk);

  // WebCam Stream Initializer
  const toggleWebcam = useCallback(async () => {
    if (webcamActive) {
      if (webcamVideoRef.current && webcamVideoRef.current.srcObject) {
        const stream = webcamVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
        webcamVideoRef.current.srcObject = null;
      }
      setWebcamActive(false);
      gameAudio.playCrispClick();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {width: {ideal: 320}, height: {ideal: 240}, facingMode: 'user'},
        });
        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = stream;
          webcamVideoRef.current.play();
        }
        setWebcamActive(true);
        setCameraError('');
        gameAudio.playConfirmSelect();
      } catch (err) {
        console.warn('Webcam permission not granted or unavailable:', err);
        const name = (err as Error)?.name;
        setCameraError(
          name === 'NotAllowedError'
            ? '鏡頭權限被拒絕。請點網址列左邊的圖示，允許使用相機後再試一次。'
            : name === 'NotFoundError'
            ? '找不到鏡頭，請確認電腦有接上相機。'
            : name === 'NotReadableError'
            ? '鏡頭正被其他程式使用中（例如視訊會議），請先關掉再試。'
            : '無法開啟鏡頭，請確認網址是 https 或 localhost。',
        );
        setWebcamActive(false);
        gameAudio.playErrorBuzz();
      }
    }
  }, [webcamActive]);

  // Clean up webcam on unmount
  useEffect(() => {
    return () => {
      if (webcamVideoRef.current && webcamVideoRef.current.srcObject) {
        const stream = webcamVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Place Food on empty tile
  const spawnFood = useCallback(() => {
    const occupied = new Set<string>();
    snakeRef.current.segments.forEach((seg) => occupied.add(`${seg.x},${seg.y}`));
    hazardsRef.current.forEach((h) => occupied.add(`${h.x},${h.y}`));

    const available: GridCoord[] = [];
    for (let gx = 1; gx < gridSize - 1; gx++) {
      for (let gy = 1; gy < gridSize - 1; gy++) {
        if (!occupied.has(`${gx},${gy}`)) {
          available.push({x: gx, y: gy});
        }
      }
    }

    if (available.length > 0) {
      const choice = available[Math.floor(Math.random() * available.length)];
      foodRef.current = choice;
    }
  }, [gridSize]);

  // Spawn dynamic Hazard Mine with 1s warning
  const spawnHazard = useCallback(() => {
    const occupied = new Set<string>();
    snakeRef.current.segments.forEach((seg) => occupied.add(`${seg.x},${seg.y}`));
    hazardsRef.current.forEach((h) => occupied.add(`${h.x},${h.y}`));
    occupied.add(`${foodRef.current.x},${foodRef.current.y}`);

    // Keep safe buffer of 2 cells from snake head
    const head = snakeRef.current.segments[0];
    const available: GridCoord[] = [];

    for (let gx = 1; gx < gridSize - 1; gx++) {
      for (let gy = 1; gy < gridSize - 1; gy++) {
        const dist = Math.abs(gx - head.x) + Math.abs(gy - head.y);
        if (dist > 2 && !occupied.has(`${gx},${gy}`)) {
          available.push({x: gx, y: gy});
        }
      }
    }

    if (available.length > 0) {
      const choice = available[Math.floor(Math.random() * available.length)];
      hazardsRef.current.push({
        id: nextHazardId.current++,
        x: choice.x,
        y: choice.y,
        isReady: false,
        spawnTimer: hazardWarningTime,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }
  }, [gridSize, hazardWarningTime]);

  // Turn Left (Relative: -90 deg counter-clockwise)
  const triggerTurnLeft = useCallback(() => {
    if (gameStateRef.current.status !== 'PLAYING' || isGameMenuOpen) return;
    const currentHeading = snakeRef.current.heading;
    const newHeading = ((currentHeading + 3) % 4) as Heading;
    snakeRef.current.desiredHeading = newHeading;

    const head = snakeRef.current.segments[0];
    snakeRef.current.turnIndicators.push({
      x: head.x,
      y: head.y,
      dir: 'left',
      alpha: 1.0,
    });
    setActiveGesture('LEAN_LEFT');
    gameAudio.playCrispClick();
  }, [isGameMenuOpen]);

  // Turn Right (Relative: +90 deg clockwise)
  const triggerTurnRight = useCallback(() => {
    if (gameStateRef.current.status !== 'PLAYING' || isGameMenuOpen) return;
    const currentHeading = snakeRef.current.heading;
    const newHeading = ((currentHeading + 1) % 4) as Heading;
    snakeRef.current.desiredHeading = newHeading;

    const head = snakeRef.current.segments[0];
    snakeRef.current.turnIndicators.push({
      x: head.x,
      y: head.y,
      dir: 'right',
      alpha: 1.0,
    });
    setActiveGesture('LEAN_RIGHT');
    gameAudio.playCrispClick();
  }, [isGameMenuOpen]);

  // Trigger Emergency Brake (Shield Freeze: 3s invulnerable halt)
  const triggerShieldBrake = useCallback(() => {
    if (gameStateRef.current.status !== 'PLAYING' || isGameMenuOpen) return;
    if (brakeRef.current.active) return;
    if (brakeRef.current.charges <= 0) {
      gameAudio.playErrorBuzz();
      return;
    }

    brakeRef.current.charges -= 1;
    brakeRef.current.active = true;
    brakeRef.current.timer = brakeRef.current.totalDuration;
    setBrakeChargesUI(brakeRef.current.charges);
    setIsBrakingUI(true);
    setBrakeTimeRemainingUI(brakeRef.current.totalDuration);
    setActiveGesture('SHIELD_FREEZE');
    gameAudio.playShieldBlock();
    gameAudio.playPowerupChime();

    // Spawn hexagonal pulse particles
    const head = snakeRef.current.segments[0];
    const px = arenaX + head.x * cellSize + cellSize / 2;
    const py = arenaY + head.y * cellSize + cellSize / 2;
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      particlesRef.current.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * 80,
        vy: Math.sin(angle) * 80,
        color: '#00f0ff',
        size: 4,
        alpha: 1,
        maxLife: 0.8,
        life: 0.8,
      });
    }
  }, [arenaX, arenaY, cellSize, isGameMenuOpen]);

  // Reset Game Simulation
  const initGame = useCallback(() => {
    const startX = Math.floor(gridSize / 2);
    const startY = Math.floor(gridSize / 2);

    snakeRef.current = {
      segments: [
        {x: startX, y: startY},
        {x: startX - 1, y: startY},
        {x: startX - 2, y: startY},
        {x: startX - 3, y: startY},
      ],
      heading: 0,
      desiredHeading: 0,
      stepTimer: 0,
      stepInterval: baseStepInterval,
      turnIndicators: [],
    };

    hazardsRef.current = [];
    nextHazardId.current = 1;

    brakeRef.current = {
      charges: startingBrakeCharges,
      active: false,
      timer: 0,
      totalDuration: brakeDuration,
    };

    particlesRef.current = [];
    screenShakeRef.current.amount = 0;
    crtFlashRef.current = 0;
    gameStatsRef.current = {
      coresCollected: 0,
      score: 0,
    };

    setBrakeChargesUI(startingBrakeCharges);
    setIsBrakingUI(false);
    setBrakeTimeRemainingUI(0);
    setCoresCollectedUI(0);
    setIsGameMenuOpen(false);
    setIsHowToPlayOpen(false);
    setActiveGesture('NEUTRAL');

    setGameState({
      status: 'PLAYING',
      score: 0,
      level: 1,
    });

    spawnFood();
    // Spawn 2 initial mines to set the neon perimeter mood
    spawnHazard();
    spawnHazard();

    if (sdk) {
      sdk.startGame();
    }
    gameAudio.playConfirmSelect();
  }, [baseStepInterval, brakeDuration, gridSize, sdk, spawnFood, spawnHazard, startingBrakeCharges]);

  // Auto-play support
  const hasAutoplayed = useRef(false);
  useEffect(() => {
    if (
      !hasAutoplayed.current &&
      new URLSearchParams(window.location.search).has('autoplay')
    ) {
      hasAutoplayed.current = true;
      initGame();
    }
  }, [initGame]);

  // Trigger Game Over
  const triggerGameOver = useCallback(
    (reason: string) => {
      gameAudio.playChiptuneExplosion();
      gameAudio.playDefeatMotif();
      screenShakeRef.current.amount = 22;
      crtFlashRef.current = 1.0;

      // Spawn fiery explosion particles at snake head
      const head = snakeRef.current.segments[0];
      const px = arenaX + head.x * cellSize + cellSize / 2;
      const py = arenaY + head.y * cellSize + cellSize / 2;

      for (let i = 0; i < 45; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 40 + Math.random() * 180;
        particlesRef.current.push({
          x: px,
          y: py,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          color: Math.random() > 0.4 ? '#ff0055' : '#00f0ff',
          size: 3 + Math.random() * 5,
          alpha: 1,
          maxLife: 1.2,
          life: 1.2,
        });
      }

      setGameState((prev) => {
        const finalScore = prev.score;
        if (finalScore > highScore) {
          setHighScore(finalScore);
          try {
            localStorage.setItem('kinetic_serpent_highscore', finalScore.toString());
          } catch {}
        }
        return {
          ...prev,
          status: 'GAME_OVER',
          deathReason: reason,
        };
      });
    },
    [arenaX, arenaY, cellSize, highScore],
  );

  // Global Keyboard listener for Left/Right relative turns, Shield brake, and Menu toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (gameStateRef.current.status === 'PLAYING') {
          setIsGameMenuOpen((prev) => {
            const next = !prev;
            if (next) gameAudio.playCrispClick();
            return next;
          });
        }
        return;
      }

      if (gameStateRef.current.status !== 'PLAYING' || isGameMenuOpen) return;

      if ((e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') && !keyTurnLeftPressed.current) {
        keyTurnLeftPressed.current = true;
        triggerTurnLeft();
      } else if (
        (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') &&
        !keyTurnRightPressed.current
      ) {
        keyTurnRightPressed.current = true;
        triggerTurnRight();
      } else if ((e.key === ' ' || e.key === 'Spacebar') && !keyShieldPressed.current) {
        keyShieldPressed.current = true;
        triggerShieldBrake();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keyTurnLeftPressed.current = false;
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keyTurnRightPressed.current = false;
      }
      if (e.key === ' ' || e.key === 'Spacebar') {
        keyShieldPressed.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isGameMenuOpen, triggerShieldBrake, triggerTurnLeft, triggerTurnRight]);

  // --- Teachable Machine integration ---
  // Latest trigger callbacks, so the prediction loop never calls stale closures
  const tmTriggersRef = useRef({triggerTurnLeft, triggerTurnRight, triggerShieldBrake});
  tmTriggersRef.current = {triggerTurnLeft, triggerTurnRight, triggerShieldBrake};

  const loadTmModel = useCallback(async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      setTmStatus('error');
      setTmMessage('請先貼上 Teachable Machine 模型網址');
      return;
    }
    const baseUrl = trimmed.replace(/(model\.json|metadata\.json)$/, '').replace(/\/?$/, '/');
    setTmStatus('loading');
    setTmMessage('載入模型中...');
    try {
      const metadata = await fetch(baseUrl + 'metadata.json').then((r) => {
        if (!r.ok) throw new Error(`metadata.json HTTP ${r.status}`);
        return r.json();
      });
      const kind: 'image' | 'pose' = String(metadata.packageName || '').includes('pose')
        ? 'pose'
        : 'image';

      // Both TM libraries are built against tfjs 1.3.1
      await loadScriptOnce('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js');
      if (kind === 'pose') {
        await loadScriptOnce(
          'https://cdn.jsdelivr.net/npm/@teachablemachine/pose@0.8.6/dist/teachablemachine-pose.min.js',
        );
      } else {
        await loadScriptOnce(
          'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js',
        );
      }
      const lib = kind === 'pose' ? (window as any).tmPose : (window as any).tmImage;
      const model = await lib.load(baseUrl + 'model.json', baseUrl + 'metadata.json');
      tmModelRef.current = {kind, model};

      const labels: string[] = model.getClassLabels();
      const unmapped = labels.filter((l) => labelToGesture(l) === 'NEUTRAL');
      setTmStatus('ready');
      setTmMessage(
        `${kind === 'pose' ? 'Pose' : 'Image'} 模型就緒｜類別：${labels.join(', ')}` +
          (unmapped.length ? `（${unmapped.join(', ')} 視為不動作）` : ''),
      );
      try {
        localStorage.setItem('kinetic_serpent_tm_url', baseUrl);
      } catch {}
    } catch (err) {
      console.warn('Teachable Machine model failed to load:', err);
      tmModelRef.current = null;
      setTmStatus('error');
      setTmMessage(`載入失敗：${(err as Error).message}`);
    }
  }, []);

  // Auto-load the remembered model the first time the camera is switched on
  useEffect(() => {
    if (webcamActive && tmStatus === 'idle' && tmUrl.trim()) loadTmModel(tmUrl);
  }, [webcamActive, tmStatus, tmUrl, loadTmModel]);

  // Prediction loop: dispatch a gesture once it is held for TM_CONFIRM_FRAMES confident frames
  useEffect(() => {
    if (!webcamActive || tmStatus !== 'ready') return;

    const work = document.createElement('canvas');
    work.width = 224;
    work.height = 224;
    const workCtx = work.getContext('2d')!;
    let lastFired = 'NEUTRAL';
    let busy = false;
    let cancelled = false;
    let rafId = 0;
    let lastRun = 0;

    const tick = async (now: number) => {
      rafId = requestAnimationFrame(tick);
      const video = webcamVideoRef.current;
      const tm = tmModelRef.current;
      if (busy || cancelled || !tm || !video || video.readyState < 2 || now - lastRun < TM_PREDICT_INTERVAL_MS) return;
      lastRun = now;
      busy = true;
      try {
        // Center square crop, mirrored like the Teachable Machine training webcam
        const side = Math.min(video.videoWidth, video.videoHeight);
        const sx = (video.videoWidth - side) / 2;
        const sy = (video.videoHeight - side) / 2;
        workCtx.save();
        workCtx.translate(224, 0);
        workCtx.scale(-1, 1);
        workCtx.drawImage(video, sx, sy, side, side, 0, 0, 224, 224);
        workCtx.restore();

        let predictions: {className: string; probability: number}[];
        let personVisible = true;
        if (tm.kind === 'pose') {
          const {pose, posenetOutput} = await tm.model.estimatePose(work);
          predictions = await tm.model.predict(posenetOutput);
          // Pose classifiers still guess a class on an empty frame; ignore those
          personVisible = !!pose && pose.score >= 0.3;
          const preview = tmPreviewCanvasRef.current;
          if (preview) {
            const pctx = preview.getContext('2d')!;
            pctx.drawImage(work, 0, 0, preview.width, preview.height);
            if (pose) {
              const scale = preview.width / 224;
              pctx.save();
              pctx.scale(scale, scale);
              (window as any).tmPose.drawKeypoints(pose.keypoints, 0.5, pctx);
              (window as any).tmPose.drawSkeleton(pose.keypoints, 0.5, pctx);
              pctx.restore();
            }
          }
        } else {
          predictions = await tm.model.predict(work);
          const preview = tmPreviewCanvasRef.current;
          if (preview) {
            preview.getContext('2d')!.drawImage(work, 0, 0, preview.width, preview.height);
          }
        }
        if (cancelled) return;

        const top = predictions.reduce((a, b) => (b.probability > a.probability ? b : a));
        setTmTopLabel(personVisible ? top.className : '（沒偵測到人）');
        setPoseConfidence(personVisible ? top.probability : 0);

        const candidate =
          personVisible && top.probability >= TM_MIN_CONFIDENCE ? labelToGesture(top.className) : 'NEUTRAL';
        const buffer = poseBufferRef.current;
        if (buffer.gesture === candidate) {
          buffer.count += 1;
        } else {
          buffer.gesture = candidate;
          buffer.count = 1;
        }

        // Fire once when a pose is held for 3 frames; must change pose before it fires again
        if (buffer.count === TM_CONFIRM_FRAMES && candidate !== lastFired) {
          lastFired = candidate;
          setTmLiveGesture(candidate);
          if (candidate !== 'NEUTRAL') {
            setPoseTestPassed((prev) => (prev[candidate] ? prev : {...prev, [candidate]: true}));
          }
          const triggers = tmTriggersRef.current;
          if (candidate === 'LEAN_LEFT') triggers.triggerTurnLeft();
          else if (candidate === 'LEAN_RIGHT') triggers.triggerTurnRight();
          else if (candidate === 'SHIELD_FREEZE') triggers.triggerShieldBrake();
          else if (!brakeRef.current.active) setActiveGesture('NEUTRAL');
        }
      } catch (err) {
        console.warn('Teachable Machine prediction failed:', err);
      } finally {
        busy = false;
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      poseBufferRef.current = {gesture: 'NEUTRAL', count: 0};
      setTmLiveGesture('NEUTRAL');
      setPoseTestPassed({});
    };
  }, [webcamActive, tmStatus]);

  // Main Physics & Logic Update Loop
  const update = (deltaTime: number) => {
    // Screen shake decay
    if (screenShakeRef.current.amount > 0) {
      screenShakeRef.current.amount = Math.max(
        0,
        screenShakeRef.current.amount - screenShakeRef.current.decay * deltaTime * 10,
      );
    }

    // CRT static decay
    if (crtFlashRef.current > 0) {
      crtFlashRef.current = Math.max(0, crtFlashRef.current - deltaTime * 1.5);
    }

    // Particles update
    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
      const p = particlesRef.current[i];
      p.life -= deltaTime;
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        particlesRef.current.splice(i, 1);
      }
    }

    // Turn indicator animations
    for (let i = snakeRef.current.turnIndicators.length - 1; i >= 0; i--) {
      const ind = snakeRef.current.turnIndicators[i];
      ind.alpha -= deltaTime * 2.5;
      if (ind.alpha <= 0) {
        snakeRef.current.turnIndicators.splice(i, 1);
      }
    }

    if (gameStateRef.current.status !== 'PLAYING' || isGameMenuOpen) {
      return;
    }

    // Hazard mines spawning timers
    hazardsRef.current.forEach((mine) => {
      mine.pulsePhase += deltaTime * 5;
      if (!mine.isReady) {
        mine.spawnTimer -= deltaTime;
        if (mine.spawnTimer <= 0) {
          mine.isReady = true;
          // Spawn little alert spark
          const px = arenaX + mine.x * cellSize + cellSize / 2;
          const py = arenaY + mine.y * cellSize + cellSize / 2;
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2;
            particlesRef.current.push({
              x: px,
              y: py,
              vx: Math.cos(ang) * 40,
              vy: Math.sin(ang) * 40,
              color: '#ff0055',
              size: 2.5,
              alpha: 1,
              maxLife: 0.5,
              life: 0.5,
            });
          }
        }
      }
    });

    // Brake freeze handling
    if (brakeRef.current.active) {
      brakeRef.current.timer -= deltaTime;
      setBrakeTimeRemainingUI(Math.max(0, brakeRef.current.timer));

      if (brakeRef.current.timer <= 0) {
        brakeRef.current.active = false;
        setIsBrakingUI(false);
        setActiveGesture('NEUTRAL');
      }
      return; // Serpent is frozen during Shield Brake!
    }

    // Advance snake grid advancement tick
    snakeRef.current.stepTimer += deltaTime;
    if (snakeRef.current.stepTimer >= snakeRef.current.stepInterval) {
      snakeRef.current.stepTimer = 0;

      // Apply buffered relative turn
      snakeRef.current.heading = snakeRef.current.desiredHeading;

      const head = snakeRef.current.segments[0];
      let nx = head.x;
      let ny = head.y;

      switch (snakeRef.current.heading) {
        case 0:
          nx += 1;
          break; // East
        case 1:
          ny += 1;
          break; // South
        case 2:
          nx -= 1;
          break; // West
        case 3:
          ny -= 1;
          break; // North
      }

      // Check Perimeter Wall Collision
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) {
        triggerGameOver('Perimeter Wall Breach');
        return;
      }

      // Check Tail Self-Collision
      const selfHit = snakeRef.current.segments.some((seg, idx) => {
        // Exclude the very last segment since it will advance unless eating
        if (idx === snakeRef.current.segments.length - 1) return false;
        return seg.x === nx && seg.y === ny;
      });

      if (selfHit) {
        triggerGameOver('Kinetic Tail Collision');
        return;
      }

      // Check Lethal Kinetic Hazard Mine Collision
      const mineHit = hazardsRef.current.find(
        (mine) => mine.isReady && mine.x === nx && mine.y === ny,
      );
      if (mineHit) {
        triggerGameOver('Kinetic Mine Detonation');
        return;
      }

      // Advance Body Segments
      const newHead: GridCoord = {x: nx, y: ny};
      snakeRef.current.segments.unshift(newHead);

      // Spawn chromatic trail particles behind tail
      const tail = snakeRef.current.segments[snakeRef.current.segments.length - 1];
      const tailPx = arenaX + tail.x * cellSize + cellSize / 2;
      const tailPy = arenaY + tail.y * cellSize + cellSize / 2;
      particlesRef.current.push({
        x: tailPx + (Math.random() - 0.5) * 6,
        y: tailPy + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 20,
        vy: (Math.random() - 0.5) * 20,
        color: '#00f0ff',
        size: 3,
        alpha: 0.8,
        maxLife: 0.6,
        life: 0.6,
      });

      // Check Food Core Eaten
      if (nx === foodRef.current.x && ny === foodRef.current.y) {
        gameStatsRef.current.coresCollected += 1;
        gameStatsRef.current.score += scorePerFood;

        const newScore = gameStatsRef.current.score;
        const newCount = gameStatsRef.current.coresCollected;

        setCoresCollectedUI(newCount);
        setGameState((prev) => ({
          ...prev,
          score: newScore,
          level: Math.floor(newCount / 5) + 1,
        }));

        gameAudio.playCoinPickup();

        // Speed up by speedStep (e.g. 0.2 = 20% faster) on every core, capped at minSpeed
        snakeRef.current.stepInterval = Math.max(
          minSpeed,
          snakeRef.current.stepInterval / (1 + speedStep),
        );

        if (newCount % 5 === 0) {
          // Bonus brake charge reward every 5 cores!
          if (brakeRef.current.charges < 5) {
            brakeRef.current.charges += 1;
            setBrakeChargesUI(brakeRef.current.charges);
            gameAudio.playPowerupChime();
          }
        }

        // Spawn core collection sparkle burst
        const foodPx = arenaX + nx * cellSize + cellSize / 2;
        const foodPy = arenaY + ny * cellSize + cellSize / 2;
        for (let i = 0; i < 18; i++) {
          const ang = (i / 18) * Math.PI * 2;
          particlesRef.current.push({
            x: foodPx,
            y: foodPy,
            vx: Math.cos(ang) * 90,
            vy: Math.sin(ang) * 90,
            color: '#00ff88',
            size: 3.5,
            alpha: 1,
            maxLife: 0.7,
            life: 0.7,
          });
        }

        // Relocate food & dynamically spawn new hazard mine
        spawnFood();
        spawnHazard();
      } else {
        // Tail pops if food was not eaten
        snakeRef.current.segments.pop();
      }
    }
  };

  // Rendering Loop
  const draw = (ctx: CanvasRenderingContext2D) => {
    prepareCanvas(ctx, canvasWidth, canvasHeight);

    // Apply Screen Shake
    ctx.save();
    if (screenShakeRef.current.amount > 0) {
      const shakeX = (Math.random() - 0.5) * screenShakeRef.current.amount;
      const shakeY = (Math.random() - 0.5) * screenShakeRef.current.amount;
      ctx.translate(shakeX, shakeY);
    }

    // 1. Draw Background
    drawBackground(
      ctx,
      assets['bg'],
      canvasWidth,
      canvasHeight,
      THEME.colors.bgDark,
    );

    // 2. Cyber Arena Floor Backdrop
    ctx.save();
    ctx.fillStyle = 'rgba(5, 10, 22, 0.88)';
    ctx.fillRect(arenaX, arenaY, arenaPixelWidth, arenaPixelHeight);

    // Subtle 24x24 coordinate mesh
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridSize; i++) {
      const px = arenaX + i * cellSize;
      const py = arenaY + i * cellSize;
      // Vertical line
      ctx.beginPath();
      ctx.moveTo(px, arenaY);
      ctx.lineTo(px, arenaY + arenaPixelHeight);
      ctx.stroke();
      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(arenaX, py);
      ctx.lineTo(arenaX + arenaPixelWidth, py);
      ctx.stroke();
    }

    // Glowing Arena Perimeter Borders & Hazard Warning Corners
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.strokeRect(arenaX, arenaY, arenaPixelWidth, arenaPixelHeight);
    ctx.shadowBlur = 0;

    // Corner Tech Brackets
    const bracketSize = 20;
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 3;
    // Top-Left
    ctx.beginPath();
    ctx.moveTo(arenaX, arenaY + bracketSize);
    ctx.lineTo(arenaX, arenaY);
    ctx.lineTo(arenaX + bracketSize, arenaY);
    ctx.stroke();
    // Top-Right
    ctx.beginPath();
    ctx.moveTo(arenaX + arenaPixelWidth - bracketSize, arenaY);
    ctx.lineTo(arenaX + arenaPixelWidth, arenaY);
    ctx.lineTo(arenaX + arenaPixelWidth, arenaY + bracketSize);
    ctx.stroke();
    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(arenaX, arenaY + arenaPixelHeight - bracketSize);
    ctx.lineTo(arenaX, arenaY + arenaPixelHeight);
    ctx.lineTo(arenaX + bracketSize, arenaY + arenaPixelHeight);
    ctx.stroke();
    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(arenaX + arenaPixelWidth - bracketSize, arenaY + arenaPixelHeight);
    ctx.lineTo(arenaX + arenaPixelWidth, arenaY + arenaPixelHeight);
    ctx.lineTo(arenaX + arenaPixelWidth, arenaY + arenaPixelHeight - bracketSize);
    ctx.stroke();
    ctx.restore();

    // 3. Draw Hazard Mines
    hazardsRef.current.forEach((mine) => {
      const mx = arenaX + mine.x * cellSize;
      const my = arenaY + mine.y * cellSize;

      if (!mine.isReady) {
        // Warning Flicker Hologram State (1s warning)
        ctx.save();
        const flicker = Math.sin(mine.pulsePhase * 3) > 0 ? 0.7 : 0.25;
        ctx.globalAlpha = flicker;
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 2;
        ctx.strokeRect(mx + 2, my + 2, cellSize - 4, cellSize - 4);

        // Warning Chevron exclamation
        ctx.fillStyle = '#ffb700';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', mx + cellSize / 2, my + cellSize / 2);

        // Pulsing warning ring
        const ringRad = 4 + (1 - mine.spawnTimer / hazardWarningTime) * 10;
        ctx.beginPath();
        ctx.arc(mx + cellSize / 2, my + cellSize / 2, Math.max(0, ringRad), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        // Active Lethal Mine
        ctx.save();
        // Pulsing Danger Glow
        const pulse = 0.8 + Math.sin(mine.pulsePhase) * 0.2;
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 10 * pulse;

        drawAsset(
          ctx,
          assets['hazardMine'],
          mx - 2,
          my - 2,
          cellSize + 4,
          cellSize + 4,
          (fbCtx) => {
            fbCtx.fillStyle = '#ff0055';
            fbCtx.fillRect(mx + 3, my + 3, cellSize - 6, cellSize - 6);
          },
        );
        ctx.restore();
      }
    });

    // 4. Draw Food Core
    ctx.save();
    const fx = arenaX + foodRef.current.x * cellSize;
    const fy = arenaY + foodRef.current.y * cellSize;
    const foodPulse = Math.sin(Date.now() / 150) * 2;

    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 15;
    drawAsset(
      ctx,
      assets['foodCore'],
      fx - foodPulse,
      fy - foodPulse,
      cellSize + foodPulse * 2,
      cellSize + foodPulse * 2,
      (fbCtx) => {
        fbCtx.fillStyle = '#00ff88';
        fbCtx.beginPath();
        fbCtx.arc(fx + cellSize / 2, fy + cellSize / 2, cellSize / 2 - 2, 0, Math.PI * 2);
        fbCtx.fill();
      },
    );
    ctx.restore();

    // 5. Draw Turn Assist Flash Indicators beneath Serpent Head
    snakeRef.current.turnIndicators.forEach((ind) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ind.alpha);
      const ix = arenaX + ind.x * cellSize + cellSize / 2;
      const iy = arenaY + ind.y * cellSize + cellSize / 2;
      ctx.fillStyle = '#00f0ff';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ix, iy, cellSize * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    // 6. Draw Serpent Body & Tail
    const segments = snakeRef.current.segments;
    for (let i = segments.length - 1; i >= 1; i--) {
      const seg = segments[i];
      const prevSeg = segments[i - 1];
      const sx = arenaX + seg.x * cellSize + cellSize / 2;
      const sy = arenaY + seg.y * cellSize + cellSize / 2;
      const px = arenaX + prevSeg.x * cellSize + cellSize / 2;
      const py = arenaY + prevSeg.y * cellSize + cellSize / 2;

      const progress = 1 - i / segments.length; // 0 near tail, 1 near head
      const nodeSize = 6 + progress * 6;

      ctx.save();
      // Glowing connector beam
      ctx.strokeStyle = `rgba(0, 240, 255, ${0.4 + progress * 0.5})`;
      ctx.lineWidth = 4 + progress * 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(px, py);
      ctx.stroke();

      // Cybernetic Node Core
      ctx.fillStyle = progress > 0.6 ? '#00f0ff' : '#00a8ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, nodeSize), 0, Math.PI * 2);
      ctx.fill();

      // Inner optic dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, nodeSize * 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 7. Draw Serpent Head (Rotated toward heading)
    if (segments.length > 0) {
      const head = segments[0];
      const hx = arenaX + head.x * cellSize + cellSize / 2;
      const hy = arenaY + head.y * cellSize + cellSize / 2;

      // Heading angles: 0 (East) = 0 rad, 1 (South) = PI/2, 2 (West) = PI, 3 (North) = -PI/2
      const headingAngle = (snakeRef.current.heading * Math.PI) / 2;

      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(headingAngle);

      // Asset serpent_head has aspect ratio 845 / 556 ≈ 1.52, facing Right
      const headW = cellSize * 1.5;
      const headH = cellSize * 1.0;

      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 14;

      drawAsset(
        ctx,
        assets['serpentHead'],
        -headW / 2,
        -headH / 2,
        headW,
        headH,
        (fbCtx) => {
          fbCtx.fillStyle = '#00f0ff';
          fbCtx.beginPath();
          fbCtx.moveTo(headW / 2, 0);
          fbCtx.lineTo(-headW / 2, -headH / 2);
          fbCtx.lineTo(-headW / 2, headH / 2);
          fbCtx.closePath();
          fbCtx.fill();
        },
      );
      ctx.restore();

      // 8. Draw Shield Freeze Aura if Braking Active
      if (brakeRef.current.active) {
        ctx.save();
        const shieldTime = brakeRef.current.timer;
        const totalDuration = brakeRef.current.totalDuration;
        const shieldRatio = shieldTime / totalDuration;
        const shieldSize = cellSize * 4.2;

        // Rotating Hexagonal Energy Shield
        ctx.translate(hx, hy);
        ctx.rotate(Date.now() / 400);

        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 24;
        ctx.globalAlpha = 0.85 + Math.sin(Date.now() / 100) * 0.15;

        drawAsset(
          ctx,
          assets['shieldBarrier'],
          -shieldSize / 2,
          -shieldSize / 2,
          shieldSize,
          shieldSize,
          (fbCtx) => {
            fbCtx.strokeStyle = '#00f0ff';
            fbCtx.lineWidth = 4;
            fbCtx.strokeRect(-shieldSize / 2, -shieldSize / 2, shieldSize, shieldSize);
          },
        );

        // Radial 3-Second Countdown Gauge
        ctx.restore();
        ctx.save();
        ctx.translate(hx, hy);
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, cellSize * 2.3, -Math.PI / 2, -Math.PI / 2 + shieldRatio * Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px Orbitron, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${shieldTime.toFixed(1)}s`, 0, -cellSize * 2.8);
        ctx.restore();
      }
    }

    // 9. Particles Render
    particlesRef.current.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 10. CRT Static Glitch overlay on Game Over crash
    if (crtFlashRef.current > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 0, 85, ${crtFlashRef.current * 0.25})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // CRT scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      for (let y = 0; y < canvasHeight; y += 4) {
        ctx.fillRect(0, y, canvasWidth, 2);
      }
      ctx.restore();
    }

    ctx.restore(); // Restore screen shake
  };

  // Keep latest update/draw in refs
  const updateRef = useRef(update);
  const drawRef = useRef(draw);
  updateRef.current = update;
  drawRef.current = draw;

  // Stepper Game Loop
  useEffect(() => {
    let raf = 0;
    const loop = (time: number) => {
      stepperRef.current?.(time, (dt) => updateRef.current(dt));
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) drawRef.current(ctx);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const isMusicPlaying =
    !['START', 'GAME_OVER', 'VICTORY'].includes(gameState.status) &&
    !isGameMenuOpen &&
    !isMusicMuted;

  // Teachable Machine model URL field (start screen + in-game camera panel)
  const tmUrlForm = (
    <form
      className="flex gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        loadTmModel(tmUrl);
      }}>
      <input
        value={tmUrl}
        onChange={(e) => setTmUrl(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="https://teachablemachine.withgoogle.com/models/xxxx/"
        className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-slate-200"
      />
      <button
        type="submit"
        disabled={tmStatus === 'loading'}
        className="px-2 py-1 rounded bg-cyan-500 text-black font-bold disabled:opacity-50">
        載入
      </button>
    </form>
  );

  const POSE_TESTS = [
    {gesture: 'LEAN_LEFT', label: '身體往左傾', action: '左轉'},
    {gesture: 'LEAN_RIGHT', label: '身體往右傾', action: '右轉'},
    {gesture: 'SHIELD_FREEZE', label: '雙手平行', action: '護盾煞車'},
  ];
  const allPoseTestsPassed = POSE_TESTS.every((t) => poseTestPassed[t.gesture]);
  const cameraModeReady = webcamActive && tmStatus === 'ready';

  return (
    <div
      className="fixed inset-0 overflow-hidden touch-none flex flex-col items-center justify-between bg-slate-950 text-white select-none"
      style={{fontFamily: THEME.fontFamily}}>
      {/* Background BGM Audio Player */}
      <BackgroundMusic url={BACKGROUND_MUSIC_URL} isPlaying={isMusicPlaying} isMuted={isMusicMuted} />

      {/* Hidden Video for Webcam tracking stream */}
      <video
        ref={webcamVideoRef}
        autoPlay
        playsInline
        muted
        className="absolute w-px h-px opacity-0 pointer-events-none"
      />

      {/* Teachable Machine control panel (shown while the camera is on) */}
      {webcamActive && gameState.status !== 'START' && (
        <div className="fixed right-3 top-16 z-40 w-64 p-3 bg-slate-900/95 border border-cyan-500/40 rounded-xl text-xs font-mono flex flex-col gap-2 shadow-[0_0_20px_#00f0ff33]">
          <div className="flex items-center justify-between">
            <span className="text-cyan-400 font-bold">TEACHABLE MACHINE</span>
            <span
              className={
                tmStatus === 'ready'
                  ? 'text-emerald-400'
                  : tmStatus === 'error'
                  ? 'text-red-400'
                  : 'text-slate-400'
              }>
              {tmStatus.toUpperCase()}
            </span>
          </div>
          <canvas
            ref={tmPreviewCanvasRef}
            width={160}
            height={160}
            className="w-40 h-40 self-center rounded border border-slate-700 bg-black"
          />
          {tmUrlForm}
          {tmMessage && <div className="text-[10px] text-slate-400 break-words">{tmMessage}</div>}
          {tmStatus === 'ready' && (
            <div className="flex justify-between">
              <span className="text-slate-400">{tmTopLabel || '-'}</span>
              <span className="text-emerald-400">{(poseConfidence * 100).toFixed(0)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Loading Overlay */}
      {!assetsReady && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 text-cyan-400">
          <div className="text-2xl font-black tracking-widest animate-pulse flex items-center gap-3">
            <Zap className="animate-spin text-cyan-400" /> INITIALIZING NEON GRID...
          </div>
        </div>
      )}

      {/* Top Dedicated Cyber HUD Header */}
      <header className="w-full h-14 md:h-16 px-4 md:px-8 bg-slate-950/90 border-b border-cyan-500/30 flex items-center justify-between shrink-0 z-20 backdrop-blur-md">
        {/* Left: Brand & Telemetry */}
        <div className="flex items-center gap-3 md:gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#00f0ff] animate-ping" />
            <h1 className="text-sm md:text-lg font-black tracking-widest text-cyan-400 uppercase">
              KINETIC SERPENT
            </h1>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs font-mono">
            <div className="bg-slate-900 border border-cyan-500/20 px-2.5 py-1 rounded text-cyan-300 flex items-center gap-1.5">
              <span className="text-slate-400">SCORE:</span>
              <span className="font-bold text-white text-sm">{gameState.score}</span>
            </div>
            <div className="bg-slate-900 border border-yellow-500/20 px-2.5 py-1 rounded text-yellow-300 flex items-center gap-1.5">
              <Trophy size={14} className="text-yellow-400" />
              <span className="text-slate-400">HIGH:</span>
              <span className="font-bold text-white text-sm">{highScore}</span>
            </div>
            <div className="bg-slate-900 border border-emerald-500/20 px-2.5 py-1 rounded text-emerald-300 flex items-center gap-1.5">
              <Sparkles size={14} className="text-emerald-400" />
              <span className="text-slate-400">CORES:</span>
              <span className="font-bold text-white text-sm">{coresCollectedUI}</span>
            </div>
          </div>
        </div>

        {/* Center: Shield Brake Capacity Diode Gauges */}
        <div className="flex items-center gap-2">
          <div className="text-[10px] md:text-xs font-mono text-cyan-300 flex items-center gap-1">
            <Shield size={14} className={isBrakingUI ? 'text-cyan-400 animate-spin' : 'text-slate-400'} />
            <span className="hidden md:inline">FREEZE BRAKES:</span>
          </div>
          <div className="flex items-center gap-1">
            {Array.from({length: 3}).map((_, i) => (
              <div
                key={i}
                className={`w-3.5 h-3.5 md:w-4 md:h-4 rounded border transition-all ${
                  i < brakeChargesUI
                    ? 'bg-cyan-400 border-cyan-300 shadow-[0_0_8px_#00f0ff]'
                    : 'bg-slate-900 border-slate-700 opacity-40'
                }`}
              />
            ))}
          </div>
          {isBrakingUI && (
            <span className="text-xs font-mono font-bold text-red-400 animate-pulse ml-1">
              [{brakeTimeRemainingUI.toFixed(1)}s]
            </span>
          )}
        </div>

        {/* Right: Controls, Pose Diagnostics, and Game Menu Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleWebcam}
            title={webcamActive ? 'Disable Webcam Pose Tracking' : 'Enable Webcam Pose Tracking'}
            className={`min-w-[40px] h-9 px-2.5 rounded border text-xs font-mono flex items-center gap-1.5 transition-all ${
              webcamActive
                ? 'bg-cyan-950/80 border-cyan-400 text-cyan-300 shadow-[0_0_10px_#00f0ff44]'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}>
            <Camera size={14} />
            <span className="hidden lg:inline">{webcamActive ? 'CAM ACTIVE' : 'CAM SENSOR'}</span>
          </button>

          {/* Reserved Menu Trigger (Top-Right) */}
          <button
            onClick={() => {
              setIsGameMenuOpen(true);
              gameAudio.playCrispClick();
            }}
            className="min-w-[48px] min-h-[48px] px-3.5 rounded-lg bg-cyan-950/60 border border-cyan-400/50 hover:bg-cyan-500 hover:text-black transition-all flex items-center justify-center gap-1.5 text-xs font-bold text-cyan-300"
            aria-label="Open Game Menu">
            <Menu size={18} />
            <span className="hidden sm:inline">MENU</span>
          </button>
        </div>
      </header>

      {/* Main Play Area with Responsive Left/Right Cyber Panels on Widescreen */}
      <main className="flex-1 w-full min-h-0 relative flex items-center justify-center px-2 py-1">
        {/* Left Cyber Sidebar: Telemetry & Movement Radar (Desktop / Landscape) */}
        <div className="hidden 2xl:flex flex-col gap-3 w-64 p-3 bg-slate-900/60 border border-cyan-500/20 rounded-xl backdrop-blur-sm z-10 shrink-0 text-xs font-mono">
          <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
            <span className="text-cyan-400 font-bold flex items-center gap-1.5">
              <Activity size={14} /> SERPENT TELEMETRY
            </span>
            <span className="text-[10px] text-emerald-400">ONLINE</span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Grid Arena:</span>
              <span className="text-cyan-300">24 x 24 Orthogonal</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Heading Vector:</span>
              <span className="text-white font-bold">
                {snakeRef.current.heading === 0 && '0° [EAST]'}
                {snakeRef.current.heading === 1 && '90° [SOUTH]'}
                {snakeRef.current.heading === 2 && '180° [WEST]'}
                {snakeRef.current.heading === 3 && '270° [NORTH]'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Kinetic Tail:</span>
              <span className="text-cyan-300">{snakeRef.current.segments.length} Nodes</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Step Interval:</span>
              <span className="text-emerald-400">{(snakeRef.current.stepInterval * 1000).toFixed(0)} ms</span>
            </div>
          </div>

          <div className="mt-2 p-2 bg-slate-950/80 border border-slate-800 rounded">
            <span className="text-[11px] text-yellow-400 font-bold block mb-1">RELATIVE STEERING:</span>
            <p className="text-[10px] text-slate-300 leading-relaxed">
              Turns rotate 90° relative to your current forward heading.
            </p>
          </div>
        </div>

        {/* Central Game Canvas Container */}
        <div className="flex-1 h-full min-h-0 flex items-center justify-center relative">
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            style={{
              aspectRatio: `${canvasWidth} / ${canvasHeight}`,
              width: `min(100%, calc(100vh * ${canvasWidth} / ${canvasHeight}))`,
            }}
            className="h-auto max-w-full max-h-full drop-shadow-[0_0_30px_rgba(0,240,255,0.25)] rounded-lg"
          />
        </div>

        {/* Right Cyber Sidebar: AI Posture & Anti-Jitter Diagnostics */}
        <div className="hidden 2xl:flex flex-col gap-3 w-64 p-3 bg-slate-900/60 border border-cyan-500/20 rounded-xl backdrop-blur-sm z-10 shrink-0 text-xs font-mono">
          <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
            <span className="text-cyan-400 font-bold flex items-center gap-1.5">
              <Zap size={14} /> AI POSTURE PIPELINE
            </span>
            <span className="text-[10px] text-cyan-300">{TM_CONFIRM_FRAMES}-FRAME BUFFER</span>
          </div>

          {/* Active Gesture Pill */}
          <div className="p-2.5 bg-slate-950/80 border border-cyan-500/30 rounded-lg flex flex-col items-center gap-1">
            <span className="text-[10px] text-slate-400">DETECTED POSE:</span>
            <span
              className={`text-sm font-black tracking-wider ${
                activeGesture === 'LEAN_LEFT'
                  ? 'text-cyan-400'
                  : activeGesture === 'LEAN_RIGHT'
                  ? 'text-cyan-400'
                  : activeGesture === 'SHIELD_FREEZE'
                  ? 'text-purple-400'
                  : 'text-emerald-400'
              }`}>
              {activeGesture}
            </span>
          </div>

          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">Confidence:</span>
              <span className="text-emerald-400">{(poseConfidence * 100).toFixed(0)}% (&gt;{TM_MIN_CONFIDENCE * 100}% thresh)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Sensor Mode:</span>
              <span className="text-cyan-300">{webcamActive ? 'Live Webcam' : 'Direct Keyboard/Touch'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Anti-Jitter:</span>
              <span className="text-emerald-400">Active (Debounced)</span>
            </div>
          </div>

          {/* Body Lean Visual Bar */}
          <div className="mt-1">
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>LEAN L</span>
              <span>CENTER</span>
              <span>LEAN R</span>
            </div>
            <div className="w-full h-3 bg-slate-950 rounded-full border border-slate-700 relative overflow-hidden flex items-center">
              <div
                className="w-4 h-full bg-cyan-400 rounded-full shadow-[0_0_8px_#00f0ff] transition-all duration-75"
                style={{
                  marginLeft:
                    activeGesture === 'LEAN_LEFT'
                      ? '4px'
                      : activeGesture === 'LEAN_RIGHT'
                      ? 'calc(100% - 20px)'
                      : 'calc(50% - 8px)',
                }}
              />
            </div>
          </div>

          <div className="p-2 bg-slate-950/80 border border-slate-800 rounded text-[10px] text-slate-400">
            Arms Parallel or Spacebar triggers 3s Emergency Freeze Barrier.
          </div>
        </div>
      </main>

      {/* Touch Mobile Controls (Rendered for mobile/touch screens) */}
      {isMobile && gameState.status === 'PLAYING' && !isGameMenuOpen && (
        <div className="w-full px-8 py-3 bg-slate-950/80 border-t border-cyan-500/20 flex items-center justify-between shrink-0 z-30 select-none touch-none">
          {/* Left Turn Button */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              triggerTurnLeft();
            }}
            className="w-16 h-16 rounded-2xl bg-cyan-950/90 border-2 border-cyan-400 text-cyan-300 active:bg-cyan-400 active:text-black shadow-[0_0_15px_rgba(0,240,255,0.4)] flex flex-col items-center justify-center transition-transform active:scale-95"
            aria-label="Turn Left 90 degrees">
            <ChevronLeft size={28} />
            <span className="text-[10px] font-bold">TURN L</span>
          </button>

          {/* Shield Brake Button */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              triggerShieldBrake();
            }}
            disabled={brakeChargesUI <= 0 || isBrakingUI}
            className={`w-20 h-16 rounded-2xl border-2 flex flex-col items-center justify-center transition-transform active:scale-95 ${
              isBrakingUI
                ? 'bg-purple-950 border-purple-400 text-purple-300 animate-pulse'
                : brakeChargesUI > 0
                ? 'bg-cyan-950/90 border-cyan-400 text-cyan-300 active:bg-cyan-400 active:text-black shadow-[0_0_15px_rgba(0,240,255,0.4)]'
                : 'bg-slate-900 border-slate-700 text-slate-600 opacity-50'
            }`}
            aria-label="Emergency Shield Brake">
            <Shield size={22} />
            <span className="text-[10px] font-bold">FREEZE ({brakeChargesUI})</span>
          </button>

          {/* Right Turn Button */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              triggerTurnRight();
            }}
            className="w-16 h-16 rounded-2xl bg-cyan-950/90 border-2 border-cyan-400 text-cyan-300 active:bg-cyan-400 active:text-black shadow-[0_0_15px_rgba(0,240,255,0.4)] flex flex-col items-center justify-center transition-transform active:scale-95"
            aria-label="Turn Right 90 degrees">
            <ChevronRight size={28} />
            <span className="text-[10px] font-bold">TURN R</span>
          </button>
        </div>
      )}

      {/* --- START MENU OVERLAY --- */}
      {gameState.status === 'START' && (
        <div className="absolute inset-0 z-50 overflow-y-auto touch-auto bg-slate-950/85 backdrop-blur-sm">
          <div className="min-h-full flex items-center justify-center p-4">
            <div className="w-full max-w-4xl bg-slate-900/95 border-2 border-cyan-400/80 rounded-2xl p-5 md:p-8 shadow-[0_0_40px_rgba(0,240,255,0.3)]">
              {/* Title */}
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-14 h-14 mb-3 rounded-full bg-cyan-500/20 border border-cyan-400 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_#00f0ff]">
                  <Zap size={32} />
                </div>
                <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 tracking-wider">
                  KINETIC SERPENT
                </h1>
                <p className="mt-1 text-base md:text-lg font-bold text-cyan-200">體感貪吃蛇</p>
                {highScore > 0 && (
                  <p className="mt-2 text-xs font-mono text-yellow-400 flex items-center gap-1.5">
                    <Trophy size={14} /> 最高分 {highScore}
                  </p>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                {/* Left: how to play + actions */}
                <div className="flex flex-col gap-4">
                  <div className="bg-slate-950/80 border border-cyan-500/30 rounded-xl p-4 text-sm text-slate-300 space-y-2">
                    <div className="flex items-center gap-2 text-cyan-400 font-bold">
                      <Shield size={16} /> 怎麼玩
                    </div>
                    <p>吃掉發光的能量核心得分，避開紅色地雷、牆壁和自己的身體。</p>
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="text-left font-normal py-1">動作</th>
                          <th className="text-left font-normal">體感</th>
                          <th className="text-left font-normal">鍵盤</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="py-1 text-cyan-300">左轉</td>
                          <td>身體往左傾</td>
                          <td>← / A</td>
                        </tr>
                        <tr>
                          <td className="py-1 text-cyan-300">右轉</td>
                          <td>身體往右傾</td>
                          <td>→ / D</td>
                        </tr>
                        <tr>
                          <td className="py-1 text-purple-300">護盾煞車</td>
                          <td>雙手平行</td>
                          <td>空白鍵</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="text-[11px] text-slate-500">
                      轉彎是相對蛇頭方向轉 90°。護盾會讓蛇停住 {brakeDuration} 秒，共 {startingBrakeCharges} 次。
                    </p>
                  </div>

                  <button
                    onClick={toggleWebcam}
                    className={`w-full py-3 px-6 rounded-xl border-2 font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95 ${
                      webcamActive
                        ? 'border-slate-600 text-slate-300 hover:border-slate-400'
                        : 'border-cyan-400 text-cyan-300 hover:bg-cyan-400/10'
                    }`}>
                    {webcamActive ? <CameraOff size={20} /> : <Camera size={20} />}
                    {webcamActive ? '關閉鏡頭' : '連接鏡頭'}
                  </button>

                  <button
                    onClick={initGame}
                    autoFocus
                    className="w-full py-4 px-8 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black text-lg md:text-xl tracking-wider shadow-[0_0_25px_rgba(0,240,255,0.6)] hover:brightness-110 active:scale-95 transition-all flex flex-col items-center justify-center">
                    <span className="flex items-center gap-3">
                      <Play size={24} /> 開始遊戲
                    </span>
                    <span className="text-xs font-bold opacity-70">
                      {cameraModeReady ? '體感模式（鍵盤也能用）' : '鍵盤模式'}
                    </span>
                  </button>
                </div>

                {/* Right: camera test */}
                <div className="bg-slate-950/80 border border-cyan-500/30 rounded-xl p-4 flex flex-col gap-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-cyan-400 font-bold flex items-center gap-2">
                      <Camera size={16} /> 鏡頭測試
                    </span>
                    <span
                      className={`text-xs font-mono ${
                        !webcamActive
                          ? 'text-slate-500'
                          : tmStatus === 'ready'
                          ? 'text-emerald-400'
                          : tmStatus === 'error'
                          ? 'text-red-400'
                          : 'text-yellow-300'
                      }`}>
                      {!webcamActive
                        ? '未連接'
                        : tmStatus === 'ready'
                        ? '就緒'
                        : tmStatus === 'error'
                        ? '錯誤'
                        : '載入模型中...'}
                    </span>
                  </div>

                  {webcamActive ? (
                    <>
                      <div className="relative self-center">
                        <canvas
                          ref={tmPreviewCanvasRef}
                          width={224}
                          height={224}
                          className="w-48 h-48 md:w-56 md:h-56 rounded-lg border border-slate-700 bg-black"
                        />
                        {tmStatus === 'ready' && (
                          <div className="absolute bottom-1 left-1 right-1 px-2 py-1 rounded bg-black/70 text-xs font-mono flex justify-between">
                            <span className="truncate text-slate-200">{tmTopLabel || '-'}</span>
                            <span className="text-emerald-400 ml-2">
                              {(poseConfidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </div>

                      {tmStatus === 'ready' ? (
                        <>
                          <p className="text-xs text-slate-400">依序做出下面的姿勢，偵測到就會打勾：</p>
                          <ul className="space-y-1.5">
                            {POSE_TESTS.map((t) => {
                              const passed = !!poseTestPassed[t.gesture];
                              const live = tmLiveGesture === t.gesture;
                              return (
                                <li
                                  key={t.gesture}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                                    live
                                      ? 'border-cyan-400 bg-cyan-400/15'
                                      : passed
                                      ? 'border-emerald-500/50 bg-emerald-500/10'
                                      : 'border-slate-700'
                                  }`}>
                                  {passed ? (
                                    <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                                  ) : (
                                    <Circle size={18} className="text-slate-600 shrink-0" />
                                  )}
                                  <span className="flex-1">{t.label}</span>
                                  <span className="text-xs text-slate-400">→ {t.action}</span>
                                </li>
                              );
                            })}
                          </ul>
                          {allPoseTestsPassed && (
                            <p className="text-center text-emerald-400 font-bold">全部通過！可以開始遊戲了</p>
                          )}
                        </>
                      ) : (
                        tmMessage && <p className="text-xs text-slate-400 break-words">{tmMessage}</p>
                      )}
                    </>
                  ) : (
                    <div className="flex-1 min-h-[12rem] flex flex-col items-center justify-center gap-2 text-center text-slate-500 border border-dashed border-slate-700 rounded-lg p-4">
                      <Camera size={36} />
                      <p>按「連接鏡頭」用身體控制蛇</p>
                      <p className="text-xs">站在鏡頭前，讓上半身完整入鏡</p>
                      {cameraError && (
                        <p className="mt-2 text-xs text-red-400 flex items-start gap-1.5 text-left">
                          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {cameraError}
                        </p>
                      )}
                    </div>
                  )}

                  <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer select-none">進階：更換 Teachable Machine 模型</summary>
                    <div className="mt-2 space-y-1.5">
                      {tmUrlForm}
                      {tmStatus === 'ready' && tmMessage && (
                        <p className="text-[10px] break-words">{tmMessage}</p>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- GAME OVER OVERLAY --- */}
      {gameState.status === 'GAME_OVER' && (
        <MenuOverlay tone="danger" zIndex={50}>
          <div className="w-full max-w-md bg-slate-950/95 border-2 border-red-500 rounded-2xl p-6 md:p-8 shadow-[0_0_50px_rgba(255,0,85,0.4)] flex flex-col items-center text-center">
            <div className="w-14 h-14 mb-3 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center text-red-400 shadow-[0_0_20px_#ff0055]">
              <AlertTriangle size={32} />
            </div>

            <h1 className="text-3xl md:text-5xl font-black text-red-500 tracking-wider mb-1">
              SYSTEM CRITICAL
            </h1>
            <p className="text-xs md:text-sm text-red-300/80 font-mono mb-4">
              {gameState.deathReason || 'Serpent Structural Integrity Lost'}
            </p>

            <div className="w-full bg-slate-900/90 border border-red-500/30 rounded-xl p-4 mb-6 font-mono text-center space-y-2">
              <div className="text-slate-400 text-xs">FINAL SCORE</div>
              <div className="text-3xl font-black text-white">{gameState.score}</div>
              <div className="text-xs text-yellow-400 flex items-center justify-center gap-1.5 pt-1 border-t border-slate-800">
                <Trophy size={14} /> RECORD HIGH: {highScore}
              </div>
            </div>

            <button
              onClick={initGame}
              autoFocus
              className="w-full py-3.5 px-8 rounded-xl bg-red-500 hover:bg-red-400 text-black font-black text-lg tracking-wider shadow-[0_0_25px_rgba(255,0,85,0.6)] active:scale-95 transition-all flex items-center justify-center gap-2">
              <RotateCw size={22} /> RE-ENGAGE (SPACE)
            </button>
          </div>
        </MenuOverlay>
      )}

      {/* --- GAME MENU OVERLAY (Mandatory Architecture) --- */}
      {isGameMenuOpen && (
        <MenuOverlay tone="neutral" zIndex={60}>
          <div className="w-full max-w-md bg-slate-900/95 border-2 border-cyan-400/80 rounded-2xl p-6 shadow-[0_0_40px_rgba(0,240,255,0.3)] flex flex-col items-center text-center font-mono">
            <h2 className="text-2xl md:text-3xl font-black text-cyan-400 mb-6 flex items-center gap-2">
              <Menu size={24} /> GAME MENU
            </h2>

            <div className="w-full space-y-3 mb-6">
              {/* Resume */}
              <button
                onClick={() => {
                  setIsGameMenuOpen(false);
                  gameAudio.playCrispClick();
                }}
                autoFocus
                className="w-full py-3 px-4 rounded-xl bg-cyan-400 text-slate-950 font-bold hover:bg-cyan-300 transition-all flex items-center justify-center gap-2">
                <Play size={18} /> RESUME
              </button>

              {/* Sound Effects Toggle */}
              <button
                onClick={() => {
                  const muted = gameAudio.toggleMute();
                  setIsSfxMuted(muted);
                }}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 border border-slate-700 hover:border-cyan-400/50 text-white font-bold transition-all flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {isSfxMuted ? <VolumeX size={18} className="text-red-400" /> : <Volume2 size={18} className="text-cyan-400" />}
                  SOUND EFFECTS (SFX)
                </span>
                <span className={isSfxMuted ? 'text-red-400' : 'text-emerald-400'}>
                  {isSfxMuted ? 'MUTED' : 'ENABLED'}
                </span>
              </button>

              {/* Music Toggle */}
              <button
                onClick={() => {
                  setIsMusicMuted((prev) => !prev);
                  gameAudio.playCrispClick();
                }}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 border border-slate-700 hover:border-cyan-400/50 text-white font-bold transition-all flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {isMusicMuted ? <VolumeX size={18} className="text-red-400" /> : <Volume2 size={18} className="text-cyan-400" />}
                  CYBER GROOVE BGM
                </span>
                <span className={isMusicMuted ? 'text-red-400' : 'text-emerald-400'}>
                  {isMusicMuted ? 'MUTED' : 'ENABLED'}
                </span>
              </button>

              {/* How To Play */}
              <button
                onClick={() => {
                  setIsHowToPlayOpen(true);
                  gameAudio.playCrispClick();
                }}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 border border-slate-700 hover:border-cyan-400/50 text-white font-bold transition-all flex items-center justify-center gap-2">
                <HelpCircle size={18} /> HOW TO PLAY GUIDE
              </button>

              {/* Try Level Again */}
              <button
                onClick={() => {
                  initGame();
                }}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 border border-slate-700 hover:border-yellow-400/50 text-yellow-300 font-bold transition-all flex items-center justify-center gap-2">
                <RotateCw size={18} /> RESTART ARENA
              </button>

              {/* Quit to Menu */}
              <button
                onClick={() => {
                  setIsGameMenuOpen(false);
                  setIsHowToPlayOpen(false);
                  setGameState((prev) => ({...prev, status: 'START'}));
                  gameAudio.playCrispClick();
                }}
                className="w-full py-3 px-4 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 hover:bg-red-900 transition-all flex items-center justify-center gap-2">
                <X size={18} /> QUIT TO MAIN MENU
              </button>
            </div>
          </div>
        </MenuOverlay>
      )}

      {/* --- HOW TO PLAY GUIDE OVERLAY --- */}
      {isHowToPlayOpen && (
        <MenuOverlay tone="neutral" zIndex={70}>
          <div className="w-full max-w-md bg-slate-900/98 border-2 border-cyan-400 rounded-2xl p-6 shadow-2xl flex flex-col font-mono text-left">
            <div className="flex items-center justify-between border-b border-cyan-500/30 pb-3 mb-4">
              <h2 className="text-xl font-black text-cyan-400 flex items-center gap-2">
                <HelpCircle size={20} /> HOW TO PLAY
              </h2>
              <button
                onClick={() => {
                  setIsHowToPlayOpen(false);
                  gameAudio.playCrispClick();
                }}
                className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white"
                aria-label="Close guide">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-200 leading-relaxed overflow-y-auto max-h-[60vh] pr-1">
              <div>
                <span className="text-cyan-400 font-bold block mb-1">1. RELATIVE STEERING</span>
                The cyber serpent glides continuously. Commands are relative to the serpent's perspective:
                <ul className="list-disc pl-5 mt-1 space-y-0.5 text-slate-300">
                  <li><strong>Turn Left:</strong> 90° counter-clockwise relative to current heading.</li>
                  <li><strong>Turn Right:</strong> 90° clockwise relative to current heading.</li>
                  <li><strong>Neutral:</strong> Serpent continues straight forward.</li>
                </ul>
              </div>

              <div>
                <span className="text-purple-400 font-bold block mb-1">2. EMERGENCY SHIELD BRAKE</span>
                When trapped in tight corridors or box traps, trigger Shield Brake (Arms Parallel / Spacebar / Virtual Freeze):
                <ul className="list-disc pl-5 mt-1 space-y-0.5 text-slate-300">
                  <li>Serpent halts in place for 3 full seconds.</li>
                  <li>Generates an invulnerable hexagonal forcefield dome.</li>
                  <li>Consumes 1 brake charge. Replenishes with energy cores!</li>
                </ul>
              </div>

              <div>
                <span className="text-red-400 font-bold block mb-1">3. HAZARDS & FAIRNESS</span>
                Consuming green Energy Cores spawns red Kinetic Mines. Mines flicker with a 1-second warning ring before turning lethal. Contact with active mines, perimeter walls, or self-tail terminates the run.
              </div>
            </div>

            <button
              onClick={() => {
                setIsHowToPlayOpen(false);
                gameAudio.playCrispClick();
              }}
              className="mt-6 w-full py-3 rounded-xl bg-cyan-400 text-slate-950 font-bold hover:bg-cyan-300 transition-all flex items-center justify-center gap-2">
              <CheckCircle2 size={18} /> GOT IT, RETURN TO GAME
            </button>
          </div>
        </MenuOverlay>
      )}
    </div>
  );
}
