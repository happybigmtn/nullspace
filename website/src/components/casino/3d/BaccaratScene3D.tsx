/**
 * 3D Baccarat Scene - Kinematic deal with bezier arcs.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, RigidBody, CuboidCollider, interactionGroups } from '@react-three/rapier';
import { ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '../../../types';
import CasinoEnvironment from './CasinoEnvironment';
import LightingRig from './environments/LightingRig';
import BaccaratDealer, { CardSlot } from './BaccaratDealer';
import PerformanceOverlay from './PerformanceOverlay';
import PerformanceSampler from './PerformanceSampler';

const TABLE_CONFIG = {
  width: 14,
  depth: 8,
  surfaceY: 0,
};

const CARD_SIZE: [number, number, number] = [2.5, 3.5, 0.06];
const CARD_SHINGLE = 0.75;
const CARD_LIFT = CARD_SIZE[2] / 2;

const SHOE_POSITION = new THREE.Vector3(-6.2, 0.6, -1.5);
const SHOE_EXIT = new THREE.Vector3(-5.65, 1.05, -1.45);
const SHOE_ROTATION = new THREE.Euler(0, Math.PI / 2, 0);
const CARD_START_ROTATION = new THREE.Euler(
  -Math.PI / 2 + THREE.MathUtils.degToRad(12),
  THREE.MathUtils.degToRad(15),
  THREE.MathUtils.degToRad(45)
);

const BASE_ROTATION = new THREE.Euler(-Math.PI / 2, 0, 0);
const PLAYER_BASE = new THREE.Vector3(-2.8, CARD_LIFT, 1.1);
const BANKER_BASE = new THREE.Vector3(2.8, CARD_LIFT, 1.1);

const CARD_COLLISION_GROUP = interactionGroups(0b0001, 0b0001);

interface BaccaratScene3DProps {
  playerCards: Card[];
  bankerCards: Card[];
  targetKey: string;
  dealId: number;
  isAnimating: boolean;
  onAnimationComplete?: () => void;
  isMobile?: boolean;
  fullscreen?: boolean;
  skipRequested?: boolean;
}

const buildSlots = () => {
  const slots: CardSlot[] = [];
  for (let i = 0; i < 3; i += 1) {
    slots.push({
      id: `player-${i}`,
      hand: 'player',
      index: i,
      targetPosition: new THREE.Vector3(
        PLAYER_BASE.x + i * CARD_SHINGLE,
        PLAYER_BASE.y,
        PLAYER_BASE.z
      ),
      targetRotation: new THREE.Euler(BASE_ROTATION.x, 0, 0),
    });
    slots.push({
      id: `banker-${i}`,
      hand: 'banker',
      index: i,
      targetPosition: new THREE.Vector3(
        BANKER_BASE.x + i * CARD_SHINGLE,
        BANKER_BASE.y,
        BANKER_BASE.z
      ),
      targetRotation: new THREE.Euler(BASE_ROTATION.x, 0, 0),
    });
  }
  return slots;
};

const createLabelTexture = (label: string, color: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '700 32px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
};

const ZoneLabel: React.FC<{ label: string; color: string; position: [number, number, number] }> = ({
  label,
  color,
  position,
}) => {
  const texture = useMemo(() => createLabelTexture(label, color), [label, color]);
  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[2.6, 0.7]} />
      <meshStandardMaterial map={texture} transparent opacity={0.65} />
    </mesh>
  );
};

const DynamicContactShadows: React.FC<{
  positionsRef: React.MutableRefObject<Map<string, THREE.Vector3>>;
}> = ({ positionsRef }) => {
  const [shadow, setShadow] = useState({ opacity: 0.6, blur: 2.2 });
  const lastUpdateRef = useRef(0);

  useFrame(() => {
    const now = performance.now();
    if (now - lastUpdateRef.current < 90) return;
    let maxY = TABLE_CONFIG.surfaceY;
    positionsRef.current.forEach((pos) => {
      maxY = Math.max(maxY, pos.y);
    });
    const height = Math.max(0, maxY - TABLE_CONFIG.surfaceY);
    const opacity = THREE.MathUtils.clamp(0.9 - height * 0.28, 0.2, 0.8);
    const blur = THREE.MathUtils.clamp(1.2 + height * 1.15, 0.9, 4.2);
    if (Math.abs(opacity - shadow.opacity) > 0.02 || Math.abs(blur - shadow.blur) > 0.08) {
      setShadow({ opacity, blur });
    }
    lastUpdateRef.current = now;
  });

  return (
    <ContactShadows
      position={[0, TABLE_CONFIG.surfaceY + 0.02, 0]}
      scale={[TABLE_CONFIG.width, TABLE_CONFIG.depth]}
      opacity={shadow.opacity}
      blur={shadow.blur}
      far={8}
      resolution={512}
    />
  );
};

const TableCamera: React.FC<{ fullscreen?: boolean }> = ({ fullscreen }) => {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, fullscreen ? 5.8 : 5.2, fullscreen ? 9.4 : 8.6);
    camera.lookAt(0, TABLE_CONFIG.surfaceY, 0);
    (camera as THREE.PerspectiveCamera).fov = fullscreen ? 42 : 46;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [camera, fullscreen]);
  return null;
};

const TableSurface = () => (
  <>
    {/* Table surface - pure black */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TABLE_CONFIG.surfaceY - 0.01, 0]} receiveShadow>
      <planeGeometry args={[TABLE_CONFIG.width, TABLE_CONFIG.depth]} />
      <meshStandardMaterial color="#000000" roughness={0.95} metalness={0.0} />
    </mesh>
    {/* Table rail - black */}
    <mesh position={[0, TABLE_CONFIG.surfaceY - 0.05, 0]} receiveShadow>
      <boxGeometry args={[TABLE_CONFIG.width + 0.5, 0.08, TABLE_CONFIG.depth + 0.5]} />
      <meshStandardMaterial color="#050505" roughness={0.8} metalness={0.1} />
    </mesh>
  </>
);

const Shoe = () => (
  <mesh position={[SHOE_POSITION.x, SHOE_POSITION.y, SHOE_POSITION.z]} rotation={SHOE_ROTATION} castShadow>
    <boxGeometry args={[1.6, 0.9, 2.4]} />
    <meshStandardMaterial color="#0a0a0a" roughness={0.6} metalness={0.2} />
  </mesh>
);

const TableCollider = () => (
  <RigidBody type="fixed" userData={{ type: 'table' }} position={[0, TABLE_CONFIG.surfaceY - 0.05, 0]}>
    <CuboidCollider
      args={[TABLE_CONFIG.width / 2, 0.05, TABLE_CONFIG.depth / 2]}
      friction={1}
      restitution={0}
      collisionGroups={CARD_COLLISION_GROUP}
    />
  </RigidBody>
);

function BaccaratScene({
  playerCards,
  bankerCards,
  targetKey,
  dealId,
  isAnimating,
  onAnimationComplete,
  skipRequested,
  fullscreen,
}: BaccaratScene3DProps) {
  const slots = useMemo(() => buildSlots(), []);
  const positionsRef = useRef<Map<string, THREE.Vector3>>(new Map());

  return (
    <>
      {/* Pure black void */}
      <color attach="background" args={['#000000']} />
      <CasinoEnvironment />
      <TableCamera fullscreen={fullscreen} />
      <LightingRig
        preset="vip"
        enableShadows={false}
        keyPosition={[3, 6, 4]}
        fillPosition={[0, 4, 2]}
      />

      {/* No table - cards float in void, but invisible collider for physics */}

      <Physics gravity={[0, -9.8, 0]} timeStep={1 / 60}>
        <TableCollider />
        <BaccaratDealer
          playerCards={playerCards}
          bankerCards={bankerCards}
          targetKey={targetKey}
          dealId={dealId}
          isAnimating={isAnimating}
          skipRequested={skipRequested}
          shoeExit={SHOE_EXIT}
          shoeRotation={CARD_START_ROTATION}
          cardSize={CARD_SIZE}
          slots={slots}
          collisionGroups={CARD_COLLISION_GROUP}
          positionsRef={positionsRef}
          onSequenceComplete={onAnimationComplete}
        />
      </Physics>
    </>
  );
}

export const BaccaratScene3D: React.FC<BaccaratScene3DProps> = ({
  playerCards,
  bankerCards,
  targetKey,
  dealId,
  isAnimating,
  onAnimationComplete,
  isMobile = false,
  fullscreen = false,
  skipRequested,
}) => {
  const [sceneReady, setSceneReady] = useState(false);

  return (
    <div className="relative w-full h-full min-h-[320px]">
      <Canvas
        dpr={isMobile ? 1 : [1, 1.5]}
        frameloop={isAnimating ? 'always' : 'demand'}
        gl={{ antialias: !isMobile, alpha: true, powerPreference: isMobile ? 'low-power' : 'high-performance' }}
        onCreated={() => setSceneReady(true)}
        shadows={!isMobile}
        camera={{ position: [0, 5.2, 8.6], fov: fullscreen ? 42 : 46 }}
      >
        <Suspense fallback={null}>
          <PerformanceOverlay />
          <PerformanceSampler game="baccarat" />
          <BaccaratScene
            playerCards={playerCards}
            bankerCards={bankerCards}
            targetKey={targetKey}
            dealId={dealId}
            isAnimating={isAnimating}
            onAnimationComplete={onAnimationComplete}
            fullscreen={fullscreen}
            skipRequested={skipRequested}
          />
        </Suspense>
      </Canvas>

      {!sceneReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-terminal-dim/50">
          <div className="w-8 h-8 border-2 border-terminal-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
};

export default BaccaratScene3D;
