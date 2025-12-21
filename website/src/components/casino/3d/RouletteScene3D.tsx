/**
 * 3D Roulette Scene - Wheel spin with ball settle
 *
 * Wheel + ball animation that eases to the chain-resolved number.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ROULETTE_NUMBERS, getRouletteColor } from '../../../utils/gameUtils';

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

const WHEEL_BASE_COLOR = '#0b0c12';
const WHEEL_RING_COLOR = '#111827';
const WHEEL_INNER_COLOR = '#0f172a';

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

const pocketAngle = (index: number) => (index / POCKET_COUNT) * TWO_PI;

type SpinPhase = 'idle' | 'cruise' | 'settle';

interface SpinState {
  active: boolean;
  phase: SpinPhase;
  startMs: number;
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
  ctx.fillStyle = 'rgba(8, 10, 15, 0.88)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, TWO_PI);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0, 255, 136, 0.35)';
  ctx.lineWidth = size * 0.04;
  ctx.stroke();

  const color = value === 0
    ? '#22c55e'
    : getRouletteColor(value) === 'RED'
      ? '#ef4444'
      : '#f8fafc';
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.floor(size * 0.48)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), size / 2, size / 2 + size * 0.02);

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

  const pocketData = useMemo(() => {
    return ROULETTE_NUMBERS.map((num, index) => {
      const angle = pocketAngle(index);
      const color = num === 0
        ? '#16a34a'
        : getRouletteColor(num) === 'RED'
          ? '#ef4444'
          : '#111827';
      return {
        num,
        angle,
        color,
        position: new THREE.Vector3(
          Math.sin(angle) * POCKET_RADIUS,
          WHEEL_HEIGHT / 2 + POCKET_HEIGHT / 2,
          Math.cos(angle) * POCKET_RADIUS
        ),
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
    const baseDuration = 3800 + Math.random() * 800;
    const wheelDirection: 1 | -1 = 1;
    const ballDirection: 1 | -1 = -1;
    targetRef.current = null;
    spinStateRef.current = {
      active: true,
      phase: 'cruise',
      startMs: now,
      durationMs: baseDuration,
      wheelAngle: spinStateRef.current.wheelAngle,
      ballAngle: spinStateRef.current.ballAngle,
      wheelSpeed: (3.2 + Math.random() * 1.2) * wheelDirection,
      ballSpeed: (6.4 + Math.random() * 1.6) * ballDirection,
      targetNumber: null,
      targetLocked: false,
      settleStartMs: 0,
      settleDurationMs: 1200,
      wheelFromAngle: 0,
      wheelToAngle: 0,
      ballFromAngle: 0,
      ballToAngle: 0,
    };
  }, [isAnimating]);

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
        const extraWheelRevs = 2 + Math.floor(Math.random() * 2);
        const extraBallRevs = 3 + Math.floor(Math.random() * 2);
        const wheelDelta = deltaForDirection(state.wheelAngle, targetAngle, wheelDirection) + (extraWheelRevs * TWO_PI * wheelDirection);
        const ballDelta = deltaForDirection(state.ballAngle, targetAngle, ballDirection) + (extraBallRevs * TWO_PI * ballDirection);

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

    if (wheelRef.current) {
      wheelRef.current.rotation.y = state.wheelAngle;
    }

    if (ballRef.current) {
      const x = Math.sin(state.ballAngle) * ballRadius;
      const z = Math.cos(state.ballAngle) * ballRadius;
      ballRef.current.position.set(x, ballHeight, z);
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
            <meshStandardMaterial color={pocket.color} roughness={0.5} metalness={0.1} />
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
  const spinStateRef = useRef<SpinState>({
    active: false,
    phase: 'idle',
    startMs: 0,
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
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[4, 6, 3]}
            intensity={1.35}
            castShadow={!isMobile}
            shadow-mapSize-width={isMobile ? 512 : 1024}
            shadow-mapSize-height={isMobile ? 512 : 1024}
          />
          <pointLight position={[-3, 3, -2]} intensity={0.35} color="#00ff88" />

          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.18, 0]} receiveShadow>
            <circleGeometry args={[3.8, isMobile ? 32 : 48]} />
            <meshStandardMaterial color="#0b0f13" roughness={0.9} metalness={0.05} />
          </mesh>

          <RouletteCameraRig spinStateRef={spinStateRef} ballRef={ballRef} />
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
