/**
 * 3D Sic Bo Scene - Triple dice roll with chain-resolved values.
 */
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics, RigidBody, CuboidCollider, interactionGroups } from '@react-three/rapier';
import * as THREE from 'three';
import { PhysicsDice, PhysicsDiceRef } from './PhysicsDice';

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
const COMPLETE_DELAY_MS = 600;

interface SicBoScene3DProps {
  targetValues?: [number, number, number];
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

function DiceScene({
  targetValues,
  isAnimating,
  onAnimationComplete,
  isMobile,
  skipRequested,
}: {
  targetValues?: [number, number, number];
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
  const hasThrown = useRef(false);
  const completionRef = useRef(false);
  const skipHandledRef = useRef(false);

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
  }, [isAnimating]);

  useEffect(() => {
    if (isAnimating && !hasThrown.current) {
      hasThrown.current = true;
      setSettled([false, false, false]);
      diceRefs.forEach((ref) => ref.current?.reset());

      setTimeout(() => {
        const power = 1.45 + Math.random() * 0.35;
        diceRefs.forEach((ref, index) => {
          const dir = { x: (Math.random() - 0.5) * 0.35, z: -1 };
          const downwardImpulse = -1.0 - Math.random() * 0.35;
          ref.current?.throw(power, dir, downwardImpulse + index * -0.1);
        });
      }, 50);
    }

    if (!isAnimating) {
      hasThrown.current = false;
    }
  }, [isAnimating]);

  const handleRest = useCallback((idx: number) => {
    setSettled((prev) => {
      const next = [...prev] as [boolean, boolean, boolean];
      next[idx] = true;
      return next;
    });
  }, []);

  useEffect(() => {
    if (settled.every(Boolean) && isAnimating) {
      finishAnimation(COMPLETE_DELAY_MS);
    }
  }, [settled, isAnimating, finishAnimation]);

  useEffect(() => {
    if (!isAnimating || !skipRequested || skipHandledRef.current) return;
    if (!targetValues || targetValues.length !== 3) return;
    skipHandledRef.current = true;
    diceRefs.forEach((ref) => ref.current?.forceSettle());
    setSettled([true, true, true]);
    finishAnimation(200);
  }, [isAnimating, skipRequested, targetValues, finishAnimation]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[3, 6, 4]}
        intensity={1.4}
        castShadow={!isMobile}
        shadow-mapSize-width={isMobile ? 512 : 1024}
        shadow-mapSize-height={isMobile ? 512 : 1024}
      />
      <pointLight position={[-2, 3, 2]} intensity={0.35} color="#00ff88" />

      <Physics
        gravity={[0, -24, 0]}
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
          ref={diceRefs[0]}
          position={[-DICE_SPREAD_X, DICE_START_Y, DICE_START_Z]}
          targetValue={targetValues?.[0]}
          onRest={() => handleRest(0)}
          index={0}
          size={DICE_SIZE}
          settleBounds={SETTLE_BOUNDS}
          collisionGroups={DICE_COLLISION_GROUP}
        />
        <PhysicsDice
          ref={diceRefs[1]}
          position={[0, DICE_START_Y + 0.1, DICE_START_Z - DICE_SPREAD_Z]}
          targetValue={targetValues?.[1]}
          onRest={() => handleRest(1)}
          index={1}
          size={DICE_SIZE}
          settleBounds={SETTLE_BOUNDS}
          collisionGroups={DICE_COLLISION_GROUP}
        />
        <PhysicsDice
          ref={diceRefs[2]}
          position={[DICE_SPREAD_X, DICE_START_Y, DICE_START_Z]}
          targetValue={targetValues?.[2]}
          onRest={() => handleRest(2)}
          index={2}
          size={DICE_SIZE}
          settleBounds={SETTLE_BOUNDS}
          collisionGroups={DICE_COLLISION_GROUP}
        />
      </Physics>
    </>
  );
}

export const SicBoScene3D: React.FC<SicBoScene3DProps> = ({
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
          camera.position.copy(CAMERA_POS);
          camera.fov = CAMERA_FOV;
          camera.lookAt(0, 0, 0);
          setSceneReady(true);
        }}
        shadows={!isMobile}
        camera={{ position: [CAMERA_POS.x, CAMERA_POS.y, CAMERA_POS.z], fov: CAMERA_FOV }}
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
