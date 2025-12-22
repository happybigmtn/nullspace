/**
 * 3D Sic Bo Scene - Triple dice roll with chain-resolved values.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, RigidBody, CuboidCollider, interactionGroups } from '@react-three/rapier';
import * as THREE from 'three';
import { PhysicsDice, PhysicsDiceRef } from './PhysicsDice';
import { createRoundRng } from './engine';
import CasinoEnvironment from './CasinoEnvironment';
import LightingRig from './environments/LightingRig';
import { LIGHTING_PRESETS } from './materials/MaterialConfig';
import ResultPulse from './ResultPulse';
import ShooterArm, { type ShooterArmState } from './ShooterArm';
import PyramidWallCollider from './PyramidWallCollider';
import CasinoPostProcessing from './post/CasinoPostProcessing';
import AmbientSoundscape from './audio/AmbientSoundscape';
import PerformanceOverlay from './PerformanceOverlay';
import PerformanceSampler from './PerformanceSampler';

const TABLE_CONFIG = {
  width: 5.0,
  depth: 3.6,
  surfaceY: -0.5,
  wallHeight: 4.6,
  wallThickness: 0.8,
  wallInset: 0,
};

const TABLE_HALF_WIDTH = TABLE_CONFIG.width / 2;
const TABLE_HALF_DEPTH = TABLE_CONFIG.depth / 2;
const WALL_X = TABLE_HALF_WIDTH - TABLE_CONFIG.wallInset;
const WALL_Z = TABLE_HALF_DEPTH - TABLE_CONFIG.wallInset;
const WALL_Y = TABLE_CONFIG.surfaceY + TABLE_CONFIG.wallHeight / 2;
const DICE_COLLISION_GROUP = interactionGroups(0b0001, 0b0001);
const CATCH_FLOOR_SIZE = 32;
const CATCH_FLOOR_THICKNESS = 0.6;
const TABLE_COLLIDER_THICKNESS = 0.2;

const DICE_SIZE = 0.55;
const DICE_START_Y = 2.6;
const DICE_START_Z = WALL_Z - 0.7;
const DICE_SPREAD_X = 0.5;
const DICE_SPREAD_Z = 0.35;
const SETTLE_BOUNDS = {
  minX: -TABLE_HALF_WIDTH + DICE_SIZE / 2,
  maxX: TABLE_HALF_WIDTH - DICE_SIZE / 2,
  minZ: -TABLE_HALF_DEPTH + DICE_SIZE / 2,
  maxZ: TABLE_HALF_DEPTH - DICE_SIZE / 2,
  settleY: TABLE_CONFIG.surfaceY + DICE_SIZE / 2,
};

const CAMERA_POS = new THREE.Vector3(0, 4.4, 5.6);
const CAMERA_FOV = 46;
const CAMERA_SETTLE_FOV = 40;
const CAMERA_SETTLE_DURATION_MS = 900;
const CAMERA_ORBIT_RADIUS = 0.35;
const CAMERA_ORBIT_ECCENTRICITY = 0.6;
const COMPLETE_DELAY_MS = 600;

const MAGNET_ANCHOR_Z = 0.85;
const MAGNET_DURATION_MS = 900;
const MAGNET_LOCK_EPS = 0.02;
const SHOOTER_SWING_DURATION_MS = 620;
const SHOOTER_YAW_RANGE = 0.2;
const SHOOTER_PITCH_BASE = -0.2;
const SHOOTER_PITCH_RANGE = 0.08;
const PYRAMID_SIZE = 0.22;
const PYRAMID_DEPTH = 0.17;
const TRIANGLE_OFFSETS: Array<[number, number, number]> = [
  [0, 0, DICE_SIZE * 0.7],
  [-DICE_SIZE * 0.65, 0, -DICE_SIZE * 0.38],
  [DICE_SIZE * 0.65, 0, -DICE_SIZE * 0.38],
];

interface SicBoScene3DProps {
  targetValues?: [number, number, number];
  resultId?: number;
  isAnimating: boolean;
  onRoll?: () => void;
  onAnimationComplete?: () => void;
  isMobile?: boolean;
  fullscreen?: boolean;
  skipRequested?: boolean;
}

function Table() {
  return (
    <mesh
      position={[0, TABLE_CONFIG.surfaceY, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      visible={false}
    >
      <planeGeometry args={[TABLE_CONFIG.width + TABLE_CONFIG.wallThickness, TABLE_CONFIG.depth + TABLE_CONFIG.wallThickness]} />
      <meshStandardMaterial color="#1a1a2e" />
    </mesh>
  );
}

function TableCollider() {
  return (
    <RigidBody
      type="fixed"
      position={[0, TABLE_CONFIG.surfaceY - TABLE_COLLIDER_THICKNESS / 2, 0]}
    >
      <CuboidCollider
        args={[TABLE_CONFIG.width / 2, TABLE_COLLIDER_THICKNESS / 2, TABLE_CONFIG.depth / 2]}
        friction={1.6}
        restitution={0.05}
        collisionGroups={DICE_COLLISION_GROUP}
      />
    </RigidBody>
  );
}

function CatchFloor() {
  return (
    <RigidBody
      type="fixed"
      position={[0, TABLE_CONFIG.surfaceY - CATCH_FLOOR_THICKNESS / 2, 0]}
    >
      <CuboidCollider
        args={[CATCH_FLOOR_SIZE / 2, CATCH_FLOOR_THICKNESS / 2, CATCH_FLOOR_SIZE / 2]}
        friction={1}
        restitution={0.05}
        collisionGroups={DICE_COLLISION_GROUP}
      />
    </RigidBody>
  );
}

function Walls() {
  const backWallInnerZ = -WALL_Z + TABLE_CONFIG.wallThickness / 2;
  return (
    <>
      <RigidBody type="fixed" position={[0, WALL_Y, -WALL_Z]}>
        <CuboidCollider
          args={[TABLE_CONFIG.width / 2, TABLE_CONFIG.wallHeight / 2, TABLE_CONFIG.wallThickness / 2]}
          restitution={1.1}
          friction={0.55}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </RigidBody>
      <PyramidWallCollider
        width={TABLE_CONFIG.width}
        height={TABLE_CONFIG.wallHeight}
        pyramidSize={PYRAMID_SIZE}
        pyramidDepth={PYRAMID_DEPTH}
        position={[0, WALL_Y, backWallInnerZ + PYRAMID_DEPTH / 2]}
        collisionGroups={DICE_COLLISION_GROUP}
      />
      <RigidBody type="fixed" position={[-WALL_X, WALL_Y, 0]}>
        <CuboidCollider
          args={[TABLE_CONFIG.wallThickness / 2, TABLE_CONFIG.wallHeight / 2, TABLE_CONFIG.depth / 2]}
          restitution={0.25}
          friction={0.9}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </RigidBody>
      <RigidBody type="fixed" position={[WALL_X, WALL_Y, 0]}>
        <CuboidCollider
          args={[TABLE_CONFIG.wallThickness / 2, TABLE_CONFIG.wallHeight / 2, TABLE_CONFIG.depth / 2]}
          restitution={0.25}
          friction={0.9}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </RigidBody>
      <RigidBody type="fixed" position={[0, WALL_Y, WALL_Z]}>
        <CuboidCollider
          args={[TABLE_CONFIG.width / 2, TABLE_CONFIG.wallHeight / 2, TABLE_CONFIG.wallThickness / 2]}
          restitution={0.2}
          friction={0.9}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </RigidBody>
      <RigidBody
        type="fixed"
        position={[0, TABLE_CONFIG.surfaceY + TABLE_CONFIG.wallHeight + TABLE_CONFIG.wallThickness / 2, 0]}
      >
        <CuboidCollider
          args={[TABLE_CONFIG.width / 2, TABLE_CONFIG.wallThickness / 2, TABLE_CONFIG.depth / 2]}
          restitution={0.05}
          friction={0.8}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </RigidBody>
    </>
  );
}

function SicBoCameraRig({
  isSettled,
  diceCenter,
}: {
  isSettled: boolean;
  diceCenter: React.MutableRefObject<THREE.Vector3>;
}) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3());
  const orbitPos = useRef(new THREE.Vector3());
  const settlePos = useRef(new THREE.Vector3(0, 4.8, 4.7));
  const smoothLookAt = useRef(new THREE.Vector3(0, 0, 0));
  const settleStartMs = useRef<number | null>(null);
  const orbitAngle = useRef(0);

  useFrame((_, delta) => {
    const lerpSpeed = 1 - Math.exp(-3.2 * delta);
    let settleProgress = 0;

    if (!isSettled) {
      orbitAngle.current = (orbitAngle.current + 0.3 * delta) % (Math.PI * 2);
      settleStartMs.current = null;
    } else {
      if (settleStartMs.current === null) {
        settleStartMs.current = performance.now();
      }
      const elapsed = performance.now() - settleStartMs.current;
      settleProgress = Math.min(1, elapsed / CAMERA_SETTLE_DURATION_MS);
    }

    orbitPos.current.set(
      Math.cos(orbitAngle.current) * CAMERA_ORBIT_RADIUS,
      CAMERA_POS.y,
      CAMERA_POS.z + Math.sin(orbitAngle.current) * CAMERA_ORBIT_RADIUS * CAMERA_ORBIT_ECCENTRICITY
    );
    targetPos.current.copy(orbitPos.current).lerp(settlePos.current, settleProgress);

    camera.position.lerp(targetPos.current, lerpSpeed);
    smoothLookAt.current.lerp(diceCenter.current, lerpSpeed);
    const targetFov = THREE.MathUtils.lerp(CAMERA_FOV, CAMERA_SETTLE_FOV, settleProgress);
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, lerpSpeed);
    camera.updateProjectionMatrix();
    camera.lookAt(smoothLookAt.current);
  });

  return null;
}

function DiceScene({
  targetValues,
  resultId,
  isAnimating,
  onAnimationComplete,
  isMobile,
  skipRequested,
}: {
  targetValues?: [number, number, number];
  resultId?: number;
  isAnimating: boolean;
  onAnimationComplete?: () => void;
  isMobile?: boolean;
  skipRequested?: boolean;
}) {
  const diceRefs = [
    useRef<PhysicsDiceRef>(null),
    useRef<PhysicsDiceRef>(null),
    useRef<PhysicsDiceRef>(null),
  ];
  const [settled, setSettled] = useState<[boolean, boolean, boolean]>([false, false, false]);
  const [pulseId, setPulseId] = useState(0);
  const [triplePulseId, setTriplePulseId] = useState(0);
  const hasThrown = useRef(false);
  const completionRef = useRef(false);
  const skipHandledRef = useRef(false);
  const pulseTriggeredRef = useRef(false);
  const tripleTriggeredRef = useRef(false);
  const throwTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dicePositions = useRef([
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const magnetizedPositions = useRef([
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const magnetTargets = useRef([
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const magnetOffsets = useRef(
    TRIANGLE_OFFSETS.map((offset) => new THREE.Vector3(offset[0], offset[1], offset[2]))
  );
  const magnetStartMs = useRef<number | null>(null);
  const magnetLocked = useRef(false);
  const magnetAnchor = useRef(new THREE.Vector3(0, SETTLE_BOUNDS.settleY, 0));
  const rngRef = useRef<ReturnType<typeof createRoundRng> | null>(null);
  const diceCenter = useRef(new THREE.Vector3(0, 0, 0));
  const diceCenterTarget = useRef(new THREE.Vector3(0, 0, 0));
  const armState = useRef<ShooterArmState>({
    yaw: 0,
    pitch: SHOOTER_PITCH_BASE,
    swingStartMs: null,
  });
  const shooterOrigin = useMemo(
    () => [0, DICE_START_Y + 0.1, DICE_START_Z + 0.35] as [number, number, number],
    []
  );

  const finishAnimation = useCallback((delayMs: number) => {
    if (completionRef.current) return;
    completionRef.current = true;
    setTimeout(() => {
      onAnimationComplete?.();
    }, delayMs);
  }, [onAnimationComplete]);

  useEffect(() => {
    if (!isAnimating) return;
    completionRef.current = false;
    skipHandledRef.current = false;
    pulseTriggeredRef.current = false;
    tripleTriggeredRef.current = false;
  }, [isAnimating]);

  useEffect(() => {
    const edgePad = DICE_SIZE * 0.8;
    const clampedZ = Math.min(
      SETTLE_BOUNDS.maxZ - edgePad,
      Math.max(SETTLE_BOUNDS.minZ + edgePad, MAGNET_ANCHOR_Z)
    );
    magnetAnchor.current.set(0, SETTLE_BOUNDS.settleY, clampedZ);
  }, []);

  useEffect(() => {
    if (isAnimating && !hasThrown.current) {
      hasThrown.current = true;
      rngRef.current = createRoundRng('sicbo', typeof resultId === 'number' ? resultId : 0);
      setSettled([false, false, false]);
      diceRefs.forEach((ref) => ref.current?.reset());

      if (throwTimeoutRef.current) {
        clearTimeout(throwTimeoutRef.current);
      }
      throwTimeoutRef.current = setTimeout(() => {
        const rng = rngRef.current ?? createRoundRng('sicbo', typeof resultId === 'number' ? resultId : 0);
        const yaw = rng.range(-SHOOTER_YAW_RANGE, SHOOTER_YAW_RANGE);
        const pitch = SHOOTER_PITCH_BASE - rng.range(0, SHOOTER_PITCH_RANGE);
        armState.current = {
          yaw,
          pitch,
          swingStartMs: performance.now(),
        };

        const power = 1.45 + rng.next() * 0.35;
        const baseDir = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw)).normalize();

        diceRefs.forEach((ref, index) => {
          const dir = {
            x: baseDir.x + (rng.next() - 0.5) * 0.1,
            z: baseDir.z + (rng.next() - 0.5) * 0.1,
          };
          const downwardImpulse = -1.0 - rng.next() * 0.35 + pitch * 0.6;
          const randomSource = () => rng.next();
          ref.current?.throw(power, dir, downwardImpulse + index * -0.1, randomSource);
        });
      }, 50);
    }

    if (!isAnimating) {
      hasThrown.current = false;
      armState.current.swingStartMs = null;
    }
  }, [isAnimating, resultId]);

  useEffect(() => {
    return () => {
      if (throwTimeoutRef.current) {
        clearTimeout(throwTimeoutRef.current);
      }
    };
  }, []);

  const handleRest = useCallback((idx: number) => {
    setSettled((prev) => {
      const next = [...prev] as [boolean, boolean, boolean];
      next[idx] = true;
      return next;
    });
  }, []);

  const restHandlers = useMemo(
    () => [
      () => handleRest(0),
      () => handleRest(1),
      () => handleRest(2),
    ],
    [handleRest]
  );

  useEffect(() => {
    if (settled.every(Boolean) && isAnimating) {
      finishAnimation(COMPLETE_DELAY_MS);
    }
  }, [settled, isAnimating, finishAnimation]);

  const isTriple = Boolean(
    targetValues &&
    targetValues.length === 3 &&
    targetValues[0] === targetValues[1] &&
    targetValues[1] === targetValues[2]
  );

  useEffect(() => {
    if (!isAnimating || pulseTriggeredRef.current) return;
    if (!settled.every(Boolean)) return;
    pulseTriggeredRef.current = true;
    setPulseId((prev) => prev + 1);
  }, [isAnimating, settled]);

  useEffect(() => {
    if (!isAnimating || tripleTriggeredRef.current) return;
    if (!settled.every(Boolean) || !isTriple) return;
    tripleTriggeredRef.current = true;
    setTriplePulseId((prev) => prev + 1);
  }, [isAnimating, settled, isTriple]);

  useEffect(() => {
    if (!isAnimating || !skipRequested || skipHandledRef.current) return;
    if (!targetValues || targetValues.length !== 3) return;
    skipHandledRef.current = true;
    diceRefs.forEach((ref) => ref.current?.forceSettle());
    setSettled([true, true, true]);
    finishAnimation(200);
  }, [isAnimating, skipRequested, targetValues, finishAnimation]);

  useFrame(() => {
    let allPositionsReady = true;
    diceRefs.forEach((ref, idx) => {
      const hasPos = ref.current?.getPosition(dicePositions.current[idx]) ?? false;
      if (!hasPos) {
        allPositionsReady = false;
      }
    });
    if (!allPositionsReady) return;

    const now = performance.now();
    const allSettled = settled.every(Boolean);

    if (allSettled) {
      if (magnetStartMs.current === null) {
        magnetStartMs.current = now;
        magnetLocked.current = false;
      }

      const magnetProgress = Math.min(1, (now - magnetStartMs.current) / MAGNET_DURATION_MS);
      if (!magnetLocked.current) {
        const eased = 1 - Math.pow(1 - magnetProgress, 3);
        const lerpFactor = 0.12 + eased * 0.35;
        let maxDist = 0;

        magnetOffsets.current.forEach((offset, idx) => {
          magnetTargets.current[idx].copy(magnetAnchor.current).add(offset);
          magnetTargets.current[idx].set(
            Math.min(SETTLE_BOUNDS.maxX, Math.max(SETTLE_BOUNDS.minX, magnetTargets.current[idx].x)),
            SETTLE_BOUNDS.settleY,
            Math.min(SETTLE_BOUNDS.maxZ, Math.max(SETTLE_BOUNDS.minZ, magnetTargets.current[idx].z))
          );

          magnetizedPositions.current[idx].lerpVectors(
            dicePositions.current[idx],
            magnetTargets.current[idx],
            lerpFactor
          );

          maxDist = Math.max(
            maxDist,
            magnetizedPositions.current[idx].distanceTo(magnetTargets.current[idx])
          );

          diceRefs[idx].current?.nudgeTo(magnetizedPositions.current[idx]);
          dicePositions.current[idx].copy(magnetizedPositions.current[idx]);
        });

        if (magnetProgress > 0.9 && maxDist < MAGNET_LOCK_EPS) {
          magnetLocked.current = true;
          diceRefs.forEach((ref) => ref.current?.lock());
        }
      }
    } else {
      magnetStartMs.current = null;
      magnetLocked.current = false;
    }

    diceCenterTarget.current
      .copy(dicePositions.current[0])
      .add(dicePositions.current[1])
      .add(dicePositions.current[2])
      .multiplyScalar(1 / 3);

    if (allSettled) {
      diceCenter.current.copy(diceCenterTarget.current);
    } else {
      diceCenter.current.lerp(diceCenterTarget.current, 0.15);
    }
  });

  return (
    <>
      <CasinoEnvironment />
      <SicBoCameraRig isSettled={settled.every(Boolean)} diceCenter={diceCenter} />
      <ResultPulse
        trigger={pulseId}
        positionRef={diceCenter}
        radius={0.26}
        thickness={0.12}
        maxScale={3.6}
        yOffset={0.04}
      />
      <ResultPulse
        trigger={triplePulseId}
        positionRef={diceCenter}
        color="#facc15"
        radius={0.32}
        thickness={0.18}
        maxScale={4.2}
        yOffset={0.05}
      />
      <LightingRig preset="casino" isMobile={isMobile} />

      <Physics
        gravity={[0, -25, 0]}
        timeStep={isMobile ? 1 / 45 : 1 / 60}
        maxCcdSubsteps={isMobile ? 2 : 4}
        numSolverIterations={isMobile ? 6 : 8}
        numInternalPgsIterations={isMobile ? 1 : 2}
        updateLoop="independent"
      >
        <Table />
        <TableCollider />
        <CatchFloor />
        <Walls />
        <ShooterArm
          origin={shooterOrigin}
          stateRef={armState}
          swingDurationMs={SHOOTER_SWING_DURATION_MS}
          enabled={!isMobile}
        />
        <PhysicsDice
          ref={diceRefs[0]}
          position={[-DICE_SPREAD_X, DICE_START_Y, DICE_START_Z]}
          targetValue={targetValues?.[0]}
          onRest={restHandlers[0]}
          index={0}
          size={DICE_SIZE}
          settleBounds={SETTLE_BOUNDS}
          collisionGroups={DICE_COLLISION_GROUP}
          soundEnabled={!isMobile}
          soundMaterial="plastic"
        />
        <PhysicsDice
          ref={diceRefs[1]}
          position={[0, DICE_START_Y + 0.1, DICE_START_Z - DICE_SPREAD_Z]}
          targetValue={targetValues?.[1]}
          onRest={restHandlers[1]}
          index={1}
          size={DICE_SIZE}
          settleBounds={SETTLE_BOUNDS}
          collisionGroups={DICE_COLLISION_GROUP}
          soundEnabled={!isMobile}
          soundMaterial="plastic"
        />
        <PhysicsDice
          ref={diceRefs[2]}
          position={[DICE_SPREAD_X, DICE_START_Y, DICE_START_Z]}
          targetValue={targetValues?.[2]}
          onRest={restHandlers[2]}
          index={2}
          size={DICE_SIZE}
          settleBounds={SETTLE_BOUNDS}
          collisionGroups={DICE_COLLISION_GROUP}
          soundEnabled={!isMobile}
          soundMaterial="plastic"
        />
      </Physics>
    </>
  );
}

export const SicBoScene3D: React.FC<SicBoScene3DProps> = ({
  targetValues,
  resultId,
  isAnimating,
  onRoll,
  onAnimationComplete,
  isMobile = false,
  skipRequested,
}) => {
  const [sceneReady, setSceneReady] = useState(false);
  const lightingPreset = LIGHTING_PRESETS.casino;

  return (
    <div className="relative w-full h-full min-h-[320px]">
      <AmbientSoundscape profile="casino" enabled={!isMobile} />
      <Canvas
        dpr={isMobile ? 1 : [1, 1.75]}
        frameloop={isAnimating ? 'always' : 'demand'}
        gl={{ antialias: !isMobile, alpha: true, powerPreference: isMobile ? 'low-power' : 'high-performance' }}
        onCreated={({ camera }) => {
          camera.position.copy(CAMERA_POS);
          camera.fov = CAMERA_FOV;
          camera.lookAt(0, 0, 0);
          setSceneReady(true);
        }}
        shadows={!isMobile}
        camera={{ position: [CAMERA_POS.x, CAMERA_POS.y, CAMERA_POS.z], fov: CAMERA_FOV }}
      >
        <Suspense fallback={null}>
          <PerformanceOverlay />
          <PerformanceSampler game="sicbo" />
          <DiceScene
            targetValues={targetValues}
            resultId={resultId}
            isAnimating={isAnimating}
            onAnimationComplete={onAnimationComplete}
            isMobile={isMobile}
            skipRequested={skipRequested}
          />
          <CasinoPostProcessing
            enabled={!isMobile}
            bloomIntensity={lightingPreset.bloomIntensity}
            bloomThreshold={1.1}
            toneMappingExposure={lightingPreset.exposure}
          />
        </Suspense>
      </Canvas>

      {!sceneReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-terminal-dim/50">
          <div className="w-8 h-8 border-2 border-terminal-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isAnimating && onRoll && sceneReady && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <button
            type="button"
            onClick={onRoll}
            className="px-6 py-3 bg-terminal-green text-black font-mono font-bold text-sm
                       rounded-lg hover:bg-terminal-green/90 active:scale-95 transition-all
                       shadow-lg shadow-terminal-green/30"
          >
            ROLL
          </button>
        </div>
      )}

      {isAnimating && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2">
          <span className="text-sm font-mono text-terminal-green animate-pulse font-bold tracking-wider">
            ROLLING...
          </span>
        </div>
      )}
    </div>
  );
};

export default SicBoScene3D;
