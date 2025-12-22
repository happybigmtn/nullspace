/**
 * 3D Roulette Scene - Wheel spin with ball settle
 *
 * Wheel + ball animation that eases to the chain-resolved number.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import * as THREE from 'three';
import { ROULETTE_NUMBERS, getRouletteColor } from '../../../utils/gameUtils';
import CasinoEnvironment from './CasinoEnvironment';
import { createRoundRng, generateRoundSeed } from './engine';
import LightingRig from './environments/LightingRig';
import { LIGHTING_PRESETS } from './materials/MaterialConfig';
import {
  ATTRACTOR_PRESETS,
  ROULETTE_GEOMETRY,
  buildRoulettePockets,
  calculateAttractorForce,
  computeRouletteLaunch,
  getPocketAngle,
} from './physics';
import RouletteColliders from './RouletteColliders';
import CasinoPostProcessing from './post/CasinoPostProcessing';

const TWO_PI = Math.PI * 2;
const POCKET_COUNT = ROULETTE_NUMBERS.length;

const WHEEL_RADIUS = 2.8;
const WHEEL_HEIGHT = 0.4;
const INNER_RADIUS = 2.0;
const POCKET_RADIUS = 2.16;
const POCKET_DEPTH = 0.18;
const POCKET_HEIGHT = 0.09;
const NUMBER_RING_RADIUS = 1.52;
const NUMBER_HEIGHT = 0.3;
const BALL_OUTER_RADIUS = 2.5;
const BALL_INNER_RADIUS = 1.95;
const BALL_HEIGHT_START = 0.32;
const BALL_HEIGHT_END = 0.14;

const WHEEL_BASE_COLOR = '#050508';
const WHEEL_RING_COLOR = '#0a0a10';
const WHEEL_INNER_COLOR = '#080810';

// Neon pocket colors
const NEON_RED = '#cc1111';
const NEON_GREEN = '#00aa44';
const POCKET_BLACK = '#0a0a0f';

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const normalizeAngle = (angle: number) => ((angle % TWO_PI) + TWO_PI) % TWO_PI;

const deltaForDirection = (from: number, to: number, direction: 1 | -1) => {
  const fromNorm = normalizeAngle(from);
  const toNorm = normalizeAngle(to);
  let delta = toNorm - fromNorm;
  if (direction > 0 && delta < 0) delta += TWO_PI;
  if (direction < 0 && delta > 0) delta -= TWO_PI;
  return delta;
};

const pocketAngle = (index: number) => getPocketAngle(index, POCKET_COUNT);

type SpinPhase = 'idle' | 'cruise' | 'settle';

interface SpinState {
  active: boolean;
  phase: SpinPhase;
  startMs: number;
  seed: number;
  durationMs: number;
  wheelAngle: number;
  ballAngle: number;
  wheelSpeed: number;
  ballSpeed: number;
  targetNumber: number | null;
  targetLocked: boolean;
  settleStartMs: number;
  settleDurationMs: number;
  wheelFromAngle: number;
  wheelToAngle: number;
  ballFromAngle: number;
  ballToAngle: number;
  extraWheelRevs: number;
  extraBallRevs: number;
}

interface RouletteScene3DProps {
  targetNumber?: number | null;
  resultId?: number;
  isAnimating: boolean;
  onSpin?: () => void;
  onAnimationComplete?: () => void;
  isMobile?: boolean;
  fullscreen?: boolean;
  skipRequested?: boolean;
}

const createNumberTexture = (value: number, size: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.clearRect(0, 0, size, size);

  // Neon colored numbers matching pocket colors
  const color = value === 0
    ? '#00ff88'  // Bright green for 0
    : getRouletteColor(value) === 'RED'
      ? '#ff3333'  // Bright red
      : '#ffffff'; // White for black pockets

  // Add glow effect
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.15;

  ctx.fillStyle = color;
  ctx.font = `700 ${Math.floor(size * 0.55)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), size / 2, size / 2);

  // Second pass for brighter center
  ctx.shadowBlur = size * 0.05;
  ctx.fillText(String(value), size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
};

function RouletteWheel({
  targetNumber,
  resultId,
  isAnimating,
  onAnimationComplete,
  isMobile,
  spinStateRef,
  ballRef,
  skipRequested,
}: {
  targetNumber?: number | null;
  resultId?: number;
  isAnimating: boolean;
  onAnimationComplete?: () => void;
  isMobile?: boolean;
  spinStateRef: React.MutableRefObject<SpinState>;
  ballRef: React.MutableRefObject<THREE.Mesh | null>;
  skipRequested?: boolean;
}) {
  const wheelRef = useRef<THREE.Group>(null);
  const targetRef = useRef<number | null>(null);
  const skipHandledRef = useRef(false);
  const lastBallPos = useRef(new THREE.Vector3());
  const lastBallVel = useRef(new THREE.Vector3());
  const currentBallPos = useRef(new THREE.Vector3());
  const targetBallPos = useRef(new THREE.Vector3());
  const forceVec = useRef(new THREE.Vector3());

  const pocketData = useMemo(() => {
    const pockets = buildRoulettePockets(
      ROULETTE_NUMBERS,
      POCKET_RADIUS,
      WHEEL_HEIGHT / 2 + POCKET_HEIGHT / 2
    );
    return pockets.map((pocket) => {
      // Neon terminal colors - bright accents on dark base
      const color = pocket.number === 0
        ? NEON_GREEN
        : getRouletteColor(pocket.number) === 'RED'
          ? NEON_RED
          : POCKET_BLACK;
      return {
        num: pocket.number,
        angle: pocket.angle,
        color,
        position: pocket.position,
      };
    });
  }, []);

  const numberTextures = useMemo(() => {
    const size = isMobile ? 96 : 128;
    return ROULETTE_NUMBERS.map((num) => createNumberTexture(num, size));
  }, [isMobile]);

  useEffect(() => {
    return () => {
      numberTextures.forEach((texture) => texture.dispose());
    };
  }, [numberTextures]);

  useEffect(() => {
    if (typeof targetNumber === 'number') {
      targetRef.current = targetNumber;
    }
  }, [targetNumber, resultId]);

  useEffect(() => {
    const state = spinStateRef.current;
    if (state.active || typeof targetNumber !== 'number') return;
    const targetIndex = ROULETTE_NUMBERS.indexOf(targetNumber);
    const targetAngle = pocketAngle(targetIndex < 0 ? 0 : targetIndex);
    state.ballAngle = targetAngle;
    if (wheelRef.current) {
      wheelRef.current.rotation.y = state.wheelAngle;
    }
    if (ballRef.current) {
      const x = Math.sin(targetAngle) * BALL_INNER_RADIUS;
      const z = Math.cos(targetAngle) * BALL_INNER_RADIUS;
      ballRef.current.position.set(x, BALL_HEIGHT_END, z);
    }
  }, [resultId, targetNumber]);

  useEffect(() => {
    if (!isAnimating) return;
    const now = performance.now();
    skipHandledRef.current = false;
    const roundId = typeof resultId === 'number' ? resultId : 0;
    const rng = createRoundRng('roulette', roundId);
    const seed = generateRoundSeed('roulette', roundId);
    const launch = computeRouletteLaunch(rng);
    targetRef.current = null;
    spinStateRef.current = {
      active: true,
      phase: 'cruise',
      startMs: now,
      seed,
      durationMs: launch.durationMs,
      wheelAngle: spinStateRef.current.wheelAngle,
      ballAngle: spinStateRef.current.ballAngle,
      wheelSpeed: launch.wheelSpeed,
      ballSpeed: launch.ballSpeed,
      targetNumber: null,
      targetLocked: false,
      settleStartMs: 0,
      settleDurationMs: 1200,
      wheelFromAngle: 0,
      wheelToAngle: 0,
      ballFromAngle: 0,
      ballToAngle: 0,
      extraWheelRevs: launch.extraWheelRevs,
      extraBallRevs: launch.extraBallRevs,
    };
  }, [isAnimating, resultId]);

  useFrame((_, delta) => {
    const state = spinStateRef.current;
    if (!state.active) return;

    const now = performance.now();

    if (skipRequested && !skipHandledRef.current && targetRef.current !== null) {
      const targetIndex = ROULETTE_NUMBERS.indexOf(targetRef.current);
      const targetAngle = pocketAngle(targetIndex < 0 ? 0 : targetIndex);
      const wheelDirection: 1 | -1 = state.wheelSpeed >= 0 ? 1 : -1;
      const ballDirection: 1 | -1 = state.ballSpeed >= 0 ? 1 : -1;
      skipHandledRef.current = true;
      state.phase = 'settle';
      state.targetNumber = targetRef.current;
      state.targetLocked = true;
      state.settleStartMs = now;
      state.settleDurationMs = 350;
      state.wheelFromAngle = state.wheelAngle;
      state.ballFromAngle = state.ballAngle;
      state.wheelToAngle = state.wheelAngle + deltaForDirection(state.wheelAngle, targetAngle, wheelDirection);
      state.ballToAngle = state.ballAngle + deltaForDirection(state.ballAngle, targetAngle, ballDirection);
    }

    if (state.phase === 'cruise') {
      state.wheelAngle += state.wheelSpeed * delta;
      state.ballAngle += state.ballSpeed * delta;

      if (!state.targetLocked && targetRef.current !== null) {
        state.targetNumber = targetRef.current;
        state.targetLocked = true;
        const plannedSettleStart = state.startMs + state.durationMs - state.settleDurationMs;
        state.settleStartMs = Math.max(plannedSettleStart, now);
        if (now > plannedSettleStart) {
          state.durationMs = state.settleStartMs + state.settleDurationMs - state.startMs;
        }
      }

      if (state.targetLocked && now >= state.settleStartMs) {
        const targetIndex = ROULETTE_NUMBERS.indexOf(state.targetNumber ?? 0);
        const targetAngle = pocketAngle(targetIndex < 0 ? 0 : targetIndex);
        const wheelDirection: 1 | -1 = state.wheelSpeed >= 0 ? 1 : -1;
        const ballDirection: 1 | -1 = state.ballSpeed >= 0 ? 1 : -1;
        const wheelDelta =
          deltaForDirection(state.wheelAngle, targetAngle, wheelDirection) +
          (state.extraWheelRevs * TWO_PI * wheelDirection);
        const ballDelta =
          deltaForDirection(state.ballAngle, targetAngle, ballDirection) +
          (state.extraBallRevs * TWO_PI * ballDirection);

        state.phase = 'settle';
        state.settleStartMs = now;
        state.wheelFromAngle = state.wheelAngle;
        state.wheelToAngle = state.wheelAngle + wheelDelta;
        state.ballFromAngle = state.ballAngle;
        state.ballToAngle = state.ballAngle + ballDelta;
      }
    }

    let ballRadius = BALL_OUTER_RADIUS;
    let ballHeight = BALL_HEIGHT_START;

    if (state.phase === 'settle') {
      const progress = Math.min(1, (now - state.settleStartMs) / state.settleDurationMs);
      const eased = easeOutCubic(progress);
      state.wheelAngle = THREE.MathUtils.lerp(state.wheelFromAngle, state.wheelToAngle, eased);
      state.ballAngle = THREE.MathUtils.lerp(state.ballFromAngle, state.ballToAngle, eased);
      ballRadius = THREE.MathUtils.lerp(BALL_OUTER_RADIUS, BALL_INNER_RADIUS, eased);
      ballHeight = THREE.MathUtils.lerp(BALL_HEIGHT_START, BALL_HEIGHT_END, eased);

      if (progress >= 1) {
        state.active = false;
        state.phase = 'idle';
        onAnimationComplete?.();
      }
    }

    const x = Math.sin(state.ballAngle) * ballRadius;
    const z = Math.cos(state.ballAngle) * ballRadius;
    currentBallPos.current.set(x, ballHeight, z);
    if (delta > 0) {
      lastBallVel.current
        .copy(currentBallPos.current)
        .sub(lastBallPos.current)
        .multiplyScalar(1 / delta);
    }
    lastBallPos.current.copy(currentBallPos.current);

    if (state.phase === 'settle' && state.targetNumber !== null) {
      const targetIndex = ROULETTE_NUMBERS.indexOf(state.targetNumber);
      const targetAngle = pocketAngle(targetIndex < 0 ? 0 : targetIndex);
      targetBallPos.current.set(
        Math.sin(targetAngle) * BALL_INNER_RADIUS,
        ballHeight,
        Math.cos(targetAngle) * BALL_INNER_RADIUS
      );

      const guidance = calculateAttractorForce(
        currentBallPos.current,
        lastBallVel.current,
        {
          targetPosition: targetBallPos.current,
          phase: 'settle',
          heightGate: ROULETTE_GEOMETRY.RIM_HEIGHT,
          noiseOffset: state.seed * 0.001,
        },
        ATTRACTOR_PRESETS.ROULETTE_BALL,
        state.seed,
        (now - state.startMs) / 1000,
        forceVec.current
      );

      if (guidance) {
        currentBallPos.current.addScaledVector(guidance, delta * 0.02);
        state.ballAngle = Math.atan2(
          currentBallPos.current.x,
          currentBallPos.current.z
        );
        ballRadius = Math.max(
          BALL_INNER_RADIUS,
          Math.min(
            BALL_OUTER_RADIUS,
            Math.sqrt(
              currentBallPos.current.x * currentBallPos.current.x +
                currentBallPos.current.z * currentBallPos.current.z
            )
          )
        );
      }
    }

    if (wheelRef.current) {
      wheelRef.current.rotation.y = state.wheelAngle;
    }

    if (ballRef.current) {
      ballRef.current.position.set(
        currentBallPos.current.x,
        currentBallPos.current.y,
        currentBallPos.current.z
      );
    }
  });

  return (
    <group>
      <group ref={wheelRef}>
        <mesh castShadow={!isMobile} receiveShadow>
          <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_HEIGHT, isMobile ? 32 : 48]} />
          <meshStandardMaterial color={WHEEL_BASE_COLOR} roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh position={[0, WHEEL_HEIGHT * 0.3, 0]}>
          <cylinderGeometry args={[INNER_RADIUS, INNER_RADIUS, WHEEL_HEIGHT * 0.55, isMobile ? 28 : 40]} />
          <meshStandardMaterial color={WHEEL_INNER_COLOR} roughness={0.55} metalness={0.2} />
        </mesh>
        <mesh position={[0, WHEEL_HEIGHT * 0.45, 0]}>
          <cylinderGeometry args={[WHEEL_RADIUS * 0.92, WHEEL_RADIUS * 0.92, WHEEL_HEIGHT * 0.2, isMobile ? 24 : 36]} />
          <meshStandardMaterial color={WHEEL_RING_COLOR} roughness={0.4} metalness={0.35} />
        </mesh>
        {pocketData.map((pocket) => (
          <mesh
            key={pocket.num}
            position={pocket.position}
            rotation={[0, pocket.angle, 0]}
            castShadow={!isMobile}
          >
            <boxGeometry args={[POCKET_DEPTH, POCKET_HEIGHT, POCKET_DEPTH * 1.6]} />
            <meshBasicMaterial color={pocket.color} />
          </mesh>
        ))}
        {pocketData.map((pocket, index) => (
          <sprite
            key={`label-${pocket.num}`}
            position={[
              Math.sin(pocket.angle) * NUMBER_RING_RADIUS,
              NUMBER_HEIGHT,
              Math.cos(pocket.angle) * NUMBER_RING_RADIUS,
            ]}
            scale={[0.36, 0.36, 1]}
          >
            <spriteMaterial
              map={numberTextures[index]}
              transparent
              depthWrite={false}
            />
          </sprite>
        ))}
        <mesh ref={ballRef} castShadow={!isMobile}>
          <sphereGeometry args={[0.1, isMobile ? 12 : 18, isMobile ? 12 : 18]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.1} />
        </mesh>
      </group>
    </group>
  );
}

function RouletteCameraRig({
  spinStateRef,
  ballRef,
}: {
  spinStateRef: React.MutableRefObject<SpinState>;
  ballRef: React.MutableRefObject<THREE.Mesh | null>;
}) {
  const baseCameraPos = useRef(new THREE.Vector3(0, 4.9, 6.0));
  const zoomValueRef = useRef(0);
  const zoomHoldUntilRef = useRef<number | null>(null);
  const ballWorldRef = useRef(new THREE.Vector3());
  const lookAtRef = useRef(new THREE.Vector3(0, 0.12, 0));
  const desiredPosRef = useRef(new THREE.Vector3());
  const centerRef = useRef(new THREE.Vector3(0, 0, 0));
  const radialRef = useRef(new THREE.Vector3());
  const closePosRef = useRef(new THREE.Vector3());
  const closeOffsetRef = useRef(new THREE.Vector3(0, 1.1, 0));

  useFrame(({ camera }) => {
    const state = spinStateRef.current;
    const now = performance.now();
    if (state.phase === 'settle' && state.active) {
      zoomHoldUntilRef.current = now + 900;
    }

    const holdActive = zoomHoldUntilRef.current !== null && now < zoomHoldUntilRef.current;
    const zoomTarget = state.phase === 'settle' || holdActive ? 1 : 0;
    zoomValueRef.current = THREE.MathUtils.lerp(zoomValueRef.current, zoomTarget, 0.08);
    const zoom = zoomValueRef.current;

    desiredPosRef.current.copy(baseCameraPos.current);
    lookAtRef.current.set(0, 0.12, 0);

    if (ballRef.current) {
      ballRef.current.getWorldPosition(ballWorldRef.current);
      radialRef.current.copy(ballWorldRef.current).sub(centerRef.current);
      radialRef.current.y = 0;
      if (radialRef.current.lengthSq() > 0.0001) {
        radialRef.current.normalize();
      }
      closePosRef.current.copy(ballWorldRef.current);
      closePosRef.current.add(radialRef.current.multiplyScalar(1.55));
      closePosRef.current.add(closeOffsetRef.current);
      desiredPosRef.current.lerp(closePosRef.current, zoom);
      lookAtRef.current.lerp(ballWorldRef.current, zoom);
    }

    camera.position.lerp(desiredPosRef.current, 0.12);
    camera.lookAt(lookAtRef.current);
  });

  return null;
}

export const RouletteScene3D: React.FC<RouletteScene3DProps> = ({
  targetNumber,
  resultId,
  isAnimating,
  onSpin,
  onAnimationComplete,
  isMobile = false,
  skipRequested,
}) => {
  const [sceneReady, setSceneReady] = useState(false);
  const lightingPreset = LIGHTING_PRESETS.casino;
  const spinStateRef = useRef<SpinState>({
    active: false,
    phase: 'idle',
    startMs: 0,
    seed: 0,
    durationMs: 0,
    wheelAngle: 0,
    ballAngle: 0,
    wheelSpeed: 0,
    ballSpeed: 0,
    targetNumber: null,
    targetLocked: false,
    settleStartMs: 0,
    settleDurationMs: 0,
    wheelFromAngle: 0,
    wheelToAngle: 0,
    ballFromAngle: 0,
    ballToAngle: 0,
    extraWheelRevs: 0,
    extraBallRevs: 0,
  });
  const ballRef = useRef<THREE.Mesh | null>(null);

  return (
    <div className="relative w-full h-full min-h-[320px]">
      <Canvas
        dpr={isMobile ? 1 : [1, 1.75]}
        frameloop={isAnimating ? 'always' : 'demand'}
        gl={{ antialias: !isMobile, alpha: true, powerPreference: isMobile ? 'low-power' : 'high-performance' }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 0, 0);
          setSceneReady(true);
        }}
        shadows={!isMobile}
        camera={{ position: [0, 4.9, 6.0], fov: 46 }}
      >
        <Suspense fallback={null}>
          {/* Dark terminal background */}
          <color attach="background" args={['#030306']} />
          <CasinoEnvironment />

          <LightingRig
            preset="casino"
            isMobile={isMobile}
            accentLights={[
              { position: [2, 3, -2], intensity: lightingPreset.fillLightIntensity * 0.8 },
            ]}
          />

          {/* Dark floor under wheel */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.18, 0]} receiveShadow>
            <circleGeometry args={[3.8, isMobile ? 32 : 48]} />
            <meshStandardMaterial color="#050508" roughness={0.95} metalness={0.02} />
          </mesh>

          <RouletteCameraRig spinStateRef={spinStateRef} ballRef={ballRef} />
          <Physics
            gravity={[0, -9.81, 0]}
            timeStep={isMobile ? 1 / 45 : 1 / 60}
            maxCcdSubsteps={4}
            numSolverIterations={8}
            numInternalPgsIterations={2}
            updateLoop="independent"
          >
            <RouletteColliders pocketCount={POCKET_COUNT} />
            <CasinoPostProcessing
              enabled={!isMobile}
              bloomIntensity={lightingPreset.bloomIntensity}
              bloomThreshold={1.05}
              toneMappingExposure={lightingPreset.exposure}
            >
              <RouletteWheel
                targetNumber={targetNumber}
                resultId={resultId}
                isAnimating={isAnimating}
                onAnimationComplete={onAnimationComplete}
                isMobile={isMobile}
                spinStateRef={spinStateRef}
                ballRef={ballRef}
                skipRequested={skipRequested}
              />
            </CasinoPostProcessing>
          </Physics>
        </Suspense>
      </Canvas>

      {!sceneReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-terminal-dim/50">
          <div className="w-8 h-8 border-2 border-terminal-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isAnimating && onSpin && sceneReady && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <button
            type="button"
            onClick={onSpin}
            className="px-6 py-3 bg-terminal-green text-black font-mono font-bold text-sm
                       rounded-lg hover:bg-terminal-green/90 active:scale-95 transition-all
                       shadow-lg shadow-terminal-green/30"
          >
            SPIN
          </button>
        </div>
      )}

      {isAnimating && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2">
          <span className="text-sm font-mono text-terminal-green animate-pulse font-bold tracking-wider">
            SPINNING...
          </span>
        </div>
      )}
    </div>
  );
};

export default RouletteScene3D;
