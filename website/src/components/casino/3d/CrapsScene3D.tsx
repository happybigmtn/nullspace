/**
 * 3D Craps Scene - Full Window Animation
 *
 * Covers the entire main sub-window with physics-based dice animation.
 * Dice settle to blockchain-resolved values with camera animation.
 */
import React, { Suspense, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, RigidBody, CuboidCollider, interactionGroups } from '@react-three/rapier';
import * as THREE from 'three';
import { PhysicsDice, PhysicsDiceRef } from './PhysicsDice';

const TABLE_CONFIG = {
  width: 5.6,
  depth: 3.6,
  surfaceY: -0.5,
  wallHeight: 5,
  wallThickness: 0.8,
  wallInset: 0,
};

const TABLE_HALF_WIDTH = TABLE_CONFIG.width / 2;
const TABLE_HALF_DEPTH = TABLE_CONFIG.depth / 2;
const WALL_X = TABLE_HALF_WIDTH - TABLE_CONFIG.wallInset;
const WALL_Z = TABLE_HALF_DEPTH - TABLE_CONFIG.wallInset;
const WALL_Y = TABLE_CONFIG.surfaceY + TABLE_CONFIG.wallHeight / 2;
const DICE_COLLISION_GROUP = interactionGroups(0b0001, 0b0001);
const CATCH_FLOOR_SIZE = 40;
const CATCH_FLOOR_THICKNESS = 0.6;
const TABLE_COLLIDER_THICKNESS = 0.2;

const DICE_SIZE = 0.6;
const DICE_START_Y = 2.7;
const DICE_START_Z = WALL_Z - 0.8;
const DICE_SPREAD_X = 0.45;
const SETTLE_BOUNDS = {
  minX: -TABLE_HALF_WIDTH + DICE_SIZE / 2,
  maxX: TABLE_HALF_WIDTH - DICE_SIZE / 2,
  minZ: -TABLE_HALF_DEPTH + DICE_SIZE / 2,
  maxZ: TABLE_HALF_DEPTH - DICE_SIZE / 2,
  settleY: TABLE_CONFIG.surfaceY + DICE_SIZE / 2,
};
const MAGNET_ANCHOR_Z = 1.1;
const MAGNET_SEPARATION = DICE_SIZE * 1.15;
const MAGNET_LOCK_EPS = 0.015;

const CAMERA_ROLL_RADIUS = WALL_Z + 2.4;
const CAMERA_ROLL_HEIGHT = 4.3;
const CAMERA_ORBIT_ECCENTRICITY = 0.85;
const CAMERA_TOPDOWN_HEIGHT = 4.7;
const CAMERA_ROLL_FOV = 52;
const CAMERA_SETTLE_FOV = 38;
const CAMERA_SETTLE_DURATION_MS = 1000;

interface CrapsScene3DProps {
  targetValues?: [number, number];
  isAnimating: boolean;
  onRoll?: () => void;
  onAnimationComplete?: () => void;
  isMobile?: boolean;
  fullscreen?: boolean;
  skipRequested?: boolean;
}

// Table surface - raised up for visibility
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
        friction={1.8}
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

// Walls to contain dice
function Walls() {
  return (
    <>
      {/* Back wall */}
      <RigidBody type="fixed" position={[0, WALL_Y, -WALL_Z]}>
        <CuboidCollider
          args={[TABLE_CONFIG.width / 2, TABLE_CONFIG.wallHeight / 2, TABLE_CONFIG.wallThickness / 2]}
          restitution={1.15}
          friction={0.5}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </RigidBody>
      {/* Left wall */}
      <RigidBody type="fixed" position={[-WALL_X, WALL_Y, 0]}>
        <CuboidCollider
          args={[TABLE_CONFIG.wallThickness / 2, TABLE_CONFIG.wallHeight / 2, TABLE_CONFIG.depth / 2]}
          restitution={0.25}
          friction={0.9}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </RigidBody>
      {/* Right wall */}
      <RigidBody type="fixed" position={[WALL_X, WALL_Y, 0]}>
        <CuboidCollider
          args={[TABLE_CONFIG.wallThickness / 2, TABLE_CONFIG.wallHeight / 2, TABLE_CONFIG.depth / 2]}
          restitution={0.25}
          friction={0.9}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </RigidBody>
      {/* Front wall */}
      <RigidBody type="fixed" position={[0, WALL_Y, WALL_Z]}>
        <CuboidCollider
          args={[TABLE_CONFIG.width / 2, TABLE_CONFIG.wallHeight / 2, TABLE_CONFIG.wallThickness / 2]}
          restitution={0.2}
          friction={0.9}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </RigidBody>
      {/* Ceiling to keep dice from escaping the table volume */}
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

// Animated camera that transitions from angled to top-down
function AnimatedCamera({
  isSettled,
  diceCenter
}: {
  isSettled: boolean;
  diceCenter: React.MutableRefObject<THREE.Vector3>;
}) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3());
  const targetLookAt = useRef(new THREE.Vector3());
  const smoothLookAt = useRef(new THREE.Vector3(0, 0, 0));
  const rollUp = useRef(new THREE.Vector3(0, 1, 0));
  const topDownUp = useRef(new THREE.Vector3(0, 0, -1));
  const rollFov = useRef(CAMERA_ROLL_FOV);
  const settleFov = useRef(CAMERA_SETTLE_FOV);
  const orbitAngle = useRef(0);
  const settleStartMs = useRef<number | null>(null);
  const orbitPos = useRef(new THREE.Vector3());
  const topDownPos = useRef(new THREE.Vector3());
  const rollTarget = useRef(new THREE.Vector3());
  const upTarget = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const lerpSpeed = 3.2 * delta;
    const orbitSpeed = 0.35;
    let settleProgress = 0;

    if (!isSettled) {
      orbitAngle.current = (orbitAngle.current + orbitSpeed * delta) % (Math.PI * 2);
      settleStartMs.current = null;
    } else {
      if (settleStartMs.current === null) {
        settleStartMs.current = performance.now();
      }
      const elapsed = performance.now() - settleStartMs.current;
      settleProgress = Math.min(1, elapsed / CAMERA_SETTLE_DURATION_MS);
    }

    orbitPos.current.set(
      Math.cos(orbitAngle.current) * CAMERA_ROLL_RADIUS,
      CAMERA_ROLL_HEIGHT,
      Math.sin(orbitAngle.current) * CAMERA_ROLL_RADIUS * CAMERA_ORBIT_ECCENTRICITY
    );
    topDownPos.current.set(
      diceCenter.current.x,
      diceCenter.current.y + CAMERA_TOPDOWN_HEIGHT,
      diceCenter.current.z
    );
    targetPos.current.copy(orbitPos.current).lerp(topDownPos.current, settleProgress);

    rollTarget.current.set(diceCenter.current.x, 0, diceCenter.current.z);
    targetLookAt.current.copy(rollTarget.current).lerp(diceCenter.current, settleProgress);

    camera.position.lerp(targetPos.current, lerpSpeed);
    upTarget.current.copy(rollUp.current).lerp(topDownUp.current, settleProgress).normalize();
    camera.up.lerp(upTarget.current, lerpSpeed).normalize();
    const targetFov = THREE.MathUtils.lerp(rollFov.current, settleFov.current, settleProgress);
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, lerpSpeed);

    // Smoothly rotate to look at target
    smoothLookAt.current.lerp(targetLookAt.current, lerpSpeed);
    if (settleProgress > 0.98) {
      camera.position.copy(topDownPos.current);
      camera.up.copy(topDownUp.current);
      smoothLookAt.current.copy(diceCenter.current);
      camera.fov = settleFov.current;
    }
    camera.updateProjectionMatrix();
    camera.lookAt(smoothLookAt.current);
  });

  return null;
}

// Inner scene component that has access to Three.js context
function DiceScene({
  targetValues,
  isAnimating,
  onAnimationComplete,
  isMobile,
  skipRequested,
}: {
  targetValues?: [number, number];
  isAnimating: boolean;
  onAnimationComplete?: () => void;
  isMobile?: boolean;
  skipRequested?: boolean;
}) {
  const dice1Ref = useRef<PhysicsDiceRef>(null);
  const dice2Ref = useRef<PhysicsDiceRef>(null);
  const [settled, setSettled] = useState<[boolean, boolean]>([false, false]);
  const [cameraSettled, setCameraSettled] = useState(false);
  const hasThrown = useRef(false);
  const completionRef = useRef(false);
  const skipHandledRef = useRef(false);
  const diceCenter = useRef(new THREE.Vector3(0, 0, 0));
  const diceCenterTarget = useRef(new THREE.Vector3(0, 0, 0));
  const dice1Pos = useRef(new THREE.Vector3());
  const dice2Pos = useRef(new THREE.Vector3());
  const magnetizedDice1 = useRef(new THREE.Vector3());
  const magnetizedDice2 = useRef(new THREE.Vector3());
  const magnetOffset = useRef(new THREE.Vector3());
  const magnetDelta = useRef(new THREE.Vector3());
  const magnetStartMs = useRef<number | null>(null);
  const magnetLocked = useRef(false);
  const magnetAnchor = useRef(new THREE.Vector3(0, SETTLE_BOUNDS.settleY, 0));

  useEffect(() => {
    if (!isAnimating) return;
    completionRef.current = false;
    skipHandledRef.current = false;
  }, [isAnimating]);

  const finishAnimation = useCallback((delayMs: number) => {
    if (completionRef.current) return;
    completionRef.current = true;
    setTimeout(() => {
      onAnimationComplete?.();
    }, delayMs);
  }, [onAnimationComplete]);

  useEffect(() => {
    const halfOffset = MAGNET_SEPARATION / 2;
    const clampedZ = Math.min(
      SETTLE_BOUNDS.maxZ - halfOffset,
      Math.max(SETTLE_BOUNDS.minZ + halfOffset, MAGNET_ANCHOR_Z)
    );
    magnetAnchor.current.set(0, SETTLE_BOUNDS.settleY, clampedZ);
  }, []);

  // Throw dice when animation starts
  useEffect(() => {
    if (isAnimating && !hasThrown.current) {
      hasThrown.current = true;
      setSettled([false, false]);
      setCameraSettled(false);
      diceCenter.current.set(0, DICE_START_Y, DICE_START_Z);

      // Reset dice positions
      dice1Ref.current?.reset();
      dice2Ref.current?.reset();

      // Throw after a frame to ensure physics is ready
      setTimeout(() => {
        // Stronger, downward-biased toss from the shooter toward the table
        const power = 1.5 + Math.random() * 0.35;
        // Throw toward back wall (negative Z is away from camera)
        const dir = { x: (Math.random() - 0.5) * 0.22, z: -1 };
        const downwardImpulse = -1.1 - Math.random() * 0.35;
        dice1Ref.current?.throw(power, dir, downwardImpulse);
        dice2Ref.current?.throw(power, dir, downwardImpulse);
      }, 50);
    }

    if (!isAnimating) {
      hasThrown.current = false;
    }

  }, [isAnimating]);

  const handleDice1Rest = useCallback(() => {
    setSettled(prev => [true, prev[1]]);
  }, []);

  const handleDice2Rest = useCallback(() => {
    setSettled(prev => [prev[0], true]);
  }, []);

  // Complete when both settled and camera has animated
  useEffect(() => {
    if (settled[0] && settled[1] && isAnimating) {
      // Start camera transition
      setCameraSettled(true);

      // Wait for camera to settle before completing
      finishAnimation(CAMERA_SETTLE_DURATION_MS);
    }
  }, [settled, isAnimating, finishAnimation]);

  useEffect(() => {
    if (!isAnimating || !skipRequested || skipHandledRef.current) return;
    if (!targetValues || targetValues.length !== 2) return;
    skipHandledRef.current = true;
    dice1Ref.current?.forceSettle();
    dice2Ref.current?.forceSettle();
    setSettled([true, true]);
    setCameraSettled(true);
    finishAnimation(200);
  }, [isAnimating, skipRequested, targetValues, finishAnimation]);

  // Track dice positions for camera targeting
  useFrame(() => {
    if (!dice1Ref.current || !dice2Ref.current) return;
    const hasDice1 = dice1Ref.current.getPosition(dice1Pos.current);
    const hasDice2 = dice2Ref.current.getPosition(dice2Pos.current);
    if (!hasDice1 || !hasDice2) return;

    const now = performance.now();
    let magnetProgress = 0;
    if (cameraSettled) {
      if (magnetStartMs.current === null) {
        magnetStartMs.current = now;
        magnetLocked.current = false;
      }
      magnetProgress = Math.min(1, (now - magnetStartMs.current) / CAMERA_SETTLE_DURATION_MS);
    } else {
      magnetStartMs.current = null;
      magnetLocked.current = false;
    }

    const baseCenter = diceCenterTarget.current.copy(dice1Pos.current).add(dice2Pos.current).multiplyScalar(0.5);
    if (magnetProgress > 0 && !magnetLocked.current) {
      const halfOffset = MAGNET_SEPARATION / 2;
      magnetOffset.current.set(halfOffset, 0, 0);
      magnetizedDice1.current.copy(magnetAnchor.current).add(magnetOffset.current);
      magnetizedDice2.current.copy(magnetAnchor.current).sub(magnetOffset.current);
      magnetizedDice1.current.set(
        Math.min(SETTLE_BOUNDS.maxX, Math.max(SETTLE_BOUNDS.minX, magnetizedDice1.current.x)),
        SETTLE_BOUNDS.settleY,
        Math.min(SETTLE_BOUNDS.maxZ, Math.max(SETTLE_BOUNDS.minZ, magnetizedDice1.current.z))
      );
      magnetizedDice2.current.set(
        Math.min(SETTLE_BOUNDS.maxX, Math.max(SETTLE_BOUNDS.minX, magnetizedDice2.current.x)),
        SETTLE_BOUNDS.settleY,
        Math.min(SETTLE_BOUNDS.maxZ, Math.max(SETTLE_BOUNDS.minZ, magnetizedDice2.current.z))
      );

      const eased = 1 - Math.pow(1 - magnetProgress, 3);
      const lerpFactor = 0.12 + eased * 0.35;
      magnetizedDice1.current.lerpVectors(dice1Pos.current, magnetizedDice1.current, lerpFactor);
      magnetizedDice2.current.lerpVectors(dice2Pos.current, magnetizedDice2.current, lerpFactor);
      const distToTarget =
        dice1Pos.current.distanceTo(magnetizedDice1.current) +
        dice2Pos.current.distanceTo(magnetizedDice2.current);

      dice1Ref.current.nudgeTo(magnetizedDice1.current);
      dice2Ref.current.nudgeTo(magnetizedDice2.current);
      dice1Pos.current.copy(magnetizedDice1.current);
      dice2Pos.current.copy(magnetizedDice2.current);

      if (magnetProgress > 0.9 && distToTarget < MAGNET_LOCK_EPS) {
        magnetLocked.current = true;
        dice1Ref.current.lock();
        dice2Ref.current.lock();
      }
    }

    diceCenterTarget.current.copy(dice1Pos.current).add(dice2Pos.current).multiplyScalar(0.5);
    if (cameraSettled) {
      diceCenter.current.copy(diceCenterTarget.current);
    } else {
      diceCenter.current.lerp(diceCenterTarget.current, 0.15);
    }
  });

  return (
    <>
      <AnimatedCamera isSettled={cameraSettled} diceCenter={diceCenter} />

      <ambientLight intensity={0.6} />
      <directionalLight
        position={[3, 8, 5]}
        intensity={1.5}
        castShadow={!isMobile}
        shadow-mapSize-width={isMobile ? 512 : 1024}
        shadow-mapSize-height={isMobile ? 512 : 1024}
      />
      <pointLight position={[-2, 3, 2]} intensity={0.4} color="#00ff88" />

      <Physics
        gravity={[0, -25, 0]}
        timeStep={isMobile ? 1 / 45 : 1 / 60}
        maxCcdSubsteps={4}
        numSolverIterations={8}
        numInternalPgsIterations={2}
        updateLoop="independent"
      >
        <Table />
        <TableCollider />
        <CatchFloor />
        <Walls />
        <PhysicsDice
          ref={dice1Ref}
          position={[-DICE_SPREAD_X, DICE_START_Y, DICE_START_Z]}
          targetValue={targetValues?.[0]}
          onRest={handleDice1Rest}
          index={0}
          size={DICE_SIZE}
          settleBounds={SETTLE_BOUNDS}
          collisionGroups={DICE_COLLISION_GROUP}
        />
        <PhysicsDice
          ref={dice2Ref}
          position={[DICE_SPREAD_X, DICE_START_Y, DICE_START_Z]}
          targetValue={targetValues?.[1]}
          onRest={handleDice2Rest}
          index={1}
          size={DICE_SIZE}
          settleBounds={SETTLE_BOUNDS}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </Physics>
    </>
  );
}

export const CrapsScene3D: React.FC<CrapsScene3DProps> = ({
  targetValues,
  isAnimating,
  onRoll,
  onAnimationComplete,
  isMobile = false,
  skipRequested,
}) => {
  const [sceneReady, setSceneReady] = useState(false);

  return (
    <div className="relative w-full h-full min-h-[320px]">
      <Canvas
        dpr={isMobile ? 1 : [1, 1.75]}
        frameloop={isAnimating ? 'always' : 'demand'}
        gl={{ antialias: !isMobile, alpha: true, powerPreference: isMobile ? 'low-power' : 'high-performance' }}
        onCreated={({ camera }) => {
          camera.up.set(0, 1, 0);
          camera.lookAt(0, 0, 0);
          setSceneReady(true);
        }}
        shadows={!isMobile}
        camera={{ position: [0, CAMERA_ROLL_HEIGHT, CAMERA_ROLL_RADIUS], fov: CAMERA_ROLL_FOV }}
      >
        <Suspense fallback={null}>
          <DiceScene
            targetValues={targetValues}
            isAnimating={isAnimating}
            onAnimationComplete={onAnimationComplete}
            isMobile={isMobile}
            skipRequested={skipRequested}
          />
        </Suspense>
      </Canvas>

      {/* Loading indicator */}
      {!sceneReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-terminal-dim/50">
          <div className="w-8 h-8 border-2 border-terminal-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Roll button */}
      {!isAnimating && onRoll && sceneReady && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <button
            type="button"
            onClick={onRoll}
            className="px-6 py-3 bg-terminal-green text-black font-mono font-bold text-sm
                       rounded-lg hover:bg-terminal-green/90 active:scale-95 transition-all
                       shadow-lg shadow-terminal-green/30"
          >
            ROLL DICE
          </button>
        </div>
      )}

      {/* Animation indicator */}
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

export default CrapsScene3D;
