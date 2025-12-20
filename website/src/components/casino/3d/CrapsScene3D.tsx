/**
 * 3D Craps Scene
 *
 * Complete 3D dice rolling experience with:
 * - Physics-based dice using Rapier
 * - Power meter (desktop) or slingshot (mobile) controls
 * - Chain state synchronization
 * - Performance optimizations
 */
import React, { Suspense, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics, RigidBody } from '@react-three/rapier';
import { Environment, PerspectiveCamera, ContactShadows } from '@react-three/drei';
import { PhysicsDice, PhysicsDiceRef } from './PhysicsDice';
import { PowerMeter } from './PowerMeter';
import { Slingshot } from './Slingshot';

interface CrapsScene3DProps {
  /** Target dice values from blockchain [die1, die2] */
  targetValues?: [number, number];
  /** Whether a roll is pending (waiting for chain response) */
  isRolling?: boolean;
  /** Callback when dice animation completes */
  onAnimationComplete?: (values: [number, number]) => void;
  /** Callback to trigger the actual chain roll */
  onRollTrigger?: () => void;
  /** Mobile mode uses slingshot instead of power meter */
  isMobile?: boolean;
}

// Table surface component
function TableSurface() {
  return (
    <RigidBody type="fixed" position={[0, -0.5, 0]} friction={0.8}>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
    </RigidBody>
  );
}

// Back wall to keep dice from flying away
function BackWall() {
  return (
    <RigidBody type="fixed" position={[0, 1, -3]}>
      <mesh visible={false}>
        <boxGeometry args={[10, 4, 0.2]} />
      </mesh>
    </RigidBody>
  );
}

// Side walls
function SideWalls() {
  return (
    <>
      <RigidBody type="fixed" position={[-3, 1, 0]}>
        <mesh visible={false}>
          <boxGeometry args={[0.2, 4, 10]} />
        </mesh>
      </RigidBody>
      <RigidBody type="fixed" position={[3, 1, 0]}>
        <mesh visible={false}>
          <boxGeometry args={[0.2, 4, 10]} />
        </mesh>
      </RigidBody>
    </>
  );
}

export const CrapsScene3D: React.FC<CrapsScene3DProps> = ({
  targetValues,
  isRolling = false,
  onAnimationComplete,
  onRollTrigger,
  isMobile = false,
}) => {
  const dice1Ref = useRef<PhysicsDiceRef>(null);
  const dice2Ref = useRef<PhysicsDiceRef>(null);
  const [showControls, setShowControls] = useState(true);
  const [diceResults, setDiceResults] = useState<[number | null, number | null]>([null, null]);
  const [animationState, setAnimationState] = useState<'idle' | 'throwing' | 'settling'>('idle');

  // Reset dice when target values change (new roll from chain)
  useEffect(() => {
    if (targetValues && animationState === 'throwing') {
      // Chain has responded, dice will now target these values
      setAnimationState('settling');
    }
  }, [targetValues, animationState]);

  // Handle dice rest
  const handleDice1Rest = useCallback((value: number) => {
    setDiceResults((prev) => [value, prev[1]]);
  }, []);

  const handleDice2Rest = useCallback((value: number) => {
    setDiceResults((prev) => [prev[0], value]);
  }, []);

  // Check if both dice have settled
  useEffect(() => {
    if (diceResults[0] !== null && diceResults[1] !== null && animationState === 'settling') {
      setAnimationState('idle');
      setShowControls(true);
      onAnimationComplete?.([diceResults[0], diceResults[1]]);
    }
  }, [diceResults, animationState, onAnimationComplete]);

  // Throw dice with given power and direction
  const throwDice = useCallback(
    (power: number, direction: { x: number; z: number } = { x: 0, z: -1 }) => {
      if (animationState !== 'idle') return;

      setShowControls(false);
      setAnimationState('throwing');
      setDiceResults([null, null]);

      // Reset and throw both dice
      dice1Ref.current?.reset();
      dice2Ref.current?.reset();

      // Small delay then throw
      setTimeout(() => {
        dice1Ref.current?.throw(power, direction);
        dice2Ref.current?.throw(power, direction);

        // Trigger the chain roll
        onRollTrigger?.();
      }, 100);
    },
    [animationState, onRollTrigger]
  );

  // Handle power meter release
  const handlePowerRelease = useCallback(
    (power: number) => {
      throwDice(Math.max(0.2, power), { x: 0, z: -1 });
    },
    [throwDice]
  );

  // Handle slingshot fling
  const handleFling = useCallback(
    (power: number, direction: { x: number; z: number }) => {
      throwDice(Math.max(0.2, power), direction);
    },
    [throwDice]
  );

  return (
    <div className="relative w-full h-64 sm:h-80">
      {/* 3D Canvas */}
      <Canvas
        shadows
        dpr={[1, 1.5]} // Cap DPR for performance
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={null}>
          {/* Camera */}
          <PerspectiveCamera makeDefault position={[0, 4, 5]} fov={45} />

          {/* Lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight
            position={[5, 10, 5]}
            intensity={1}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <pointLight position={[-3, 3, 2]} intensity={0.3} color="#00ff41" />

          {/* Physics World */}
          <Physics gravity={[0, -20, 0]} timeStep={1 / 60}>
            {/* Table and walls */}
            <TableSurface />
            <BackWall />
            <SideWalls />

            {/* Dice */}
            <PhysicsDice
              ref={dice1Ref}
              position={[-0.6, 2, 2]}
              targetValue={targetValues?.[0]}
              onRest={handleDice1Rest}
              index={0}
            />
            <PhysicsDice
              ref={dice2Ref}
              position={[0.6, 2, 2]}
              targetValue={targetValues?.[1]}
              onRest={handleDice2Rest}
              index={1}
            />
          </Physics>

          {/* Soft shadows under dice */}
          <ContactShadows
            position={[0, -0.49, 0]}
            opacity={0.5}
            scale={10}
            blur={2}
            far={4}
          />

          {/* Simple environment for reflections */}
          <Environment preset="night" />
        </Suspense>
      </Canvas>

      {/* Overlay Controls */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-4">
        {isMobile ? (
          <Slingshot
            active={showControls && animationState === 'idle'}
            onFling={handleFling}
            size={160}
          />
        ) : (
          <PowerMeter
            active={showControls && animationState === 'idle'}
            onRelease={handlePowerRelease}
          />
        )}
      </div>

      {/* Status overlay */}
      {animationState === 'throwing' && !targetValues && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2">
          <div className="px-4 py-2 bg-terminal-black/80 border border-terminal-green/50 rounded">
            <span className="text-xs font-mono text-terminal-green animate-pulse">
              AWAITING CHAIN...
            </span>
          </div>
        </div>
      )}

      {animationState === 'settling' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2">
          <div className="px-4 py-2 bg-terminal-black/80 border border-terminal-green/50 rounded">
            <span className="text-xs font-mono text-terminal-green">ROLLING...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CrapsScene3D;
