/**
 * Generic 3D card table scene for casino games.
 *
 * Renders fixed card slots and animates deal/reveal for slot sets.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Card } from '../../../types';
import { playSfx } from '../../../services/sfx';
import Card3D from './Card3D';
import { CardSlotConfig, CARD_SCENE_CONFIG } from './cardLayouts';

const DEAL_INTERVAL_MS = 130;
const DEAL_DURATION_MS = 560;
const DEAL_ARC_HEIGHT = 0.5;
const REVEAL_DELAY_MS = 160;
const REVEAL_STAGGER_MS = 130;
const FLIP_DURATION_MS = 420;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type CardSlotInfo = {
  id: string;
  position: THREE.Vector3;
  rotation: THREE.Euler;
};

type CardRig = {
  slot: CardSlotInfo;
  sequenceIndex: number;
  ref: React.RefObject<THREE.Group>;
  mode: 'deal' | 'reveal' | 'static';
  dealStartMs: number | null;
  flipStartMs: number | null;
  dealt: boolean;
  flipProgress: number;
  sfxPlayed: boolean;
  startPos: THREE.Vector3;
  startRot: THREE.Euler;
  workPos: THREE.Vector3;
  workRot: THREE.Euler;
};

interface CardTableScene3DProps {
  slots: CardSlotConfig[];
  dealOrder: string[];
  cardsById: Record<string, Card | null>;
  dealId: number;
  dealSlots: string[];
  revealSlots: string[];
  isAnimating: boolean;
  onAnimationComplete?: () => void;
  isMobile?: boolean;
  fullscreen?: boolean;
  skipRequested?: boolean;
  tableSize?: { width: number; depth: number; y: number };
  cardSize?: [number, number, number];
}

const SHOE_POSITION = new THREE.Vector3(3.35, 0.62, 0.2);
const SHOE_ROTATION = new THREE.Euler(-Math.PI / 2 + 0.45, Math.PI / 2, 0);

const buildSlotInfo = (slots: CardSlotConfig[]) =>
  slots.map((slot) => ({
    id: slot.id,
    position: new THREE.Vector3(...slot.position),
    rotation: new THREE.Euler(...(slot.rotation ?? [CARD_SCENE_CONFIG.baseRotationX, 0, 0])),
  }));

function CardTableScene({
  slots,
  dealOrder,
  cardsById,
  dealId,
  dealSlots,
  revealSlots,
  isAnimating,
  onAnimationComplete,
  isMobile,
  fullscreen,
  skipRequested,
  tableSize,
  cardSize,
}: CardTableScene3DProps) {
  const { camera, invalidate } = useThree();
  const slotInfos = useMemo(() => buildSlotInfo(slots), [slots]);
  const slotMap = useMemo(() => new Map(slotInfos.map((slot) => [slot.id, slot])), [slotInfos]);
  const orderMap = useMemo(() => new Map(dealOrder.map((id, idx) => [id, idx])), [dealOrder]);
  const cardRefs = useMemo(() => slotInfos.map(() => React.createRef<THREE.Group>()), [slotInfos]);
  const rigsRef = useRef<CardRig[]>([]);
  const cardsByIdRef = useRef(cardsById);
  const animationCompleteRef = useRef(false);
  const skipHandledRef = useRef(false);

  useEffect(() => {
    cardsByIdRef.current = cardsById;
  }, [cardsById]);

  const tableConfig = {
    width: tableSize?.width ?? CARD_SCENE_CONFIG.table.width,
    depth: tableSize?.depth ?? CARD_SCENE_CONFIG.table.depth,
    y: tableSize?.y ?? CARD_SCENE_CONFIG.table.y,
  };
  const resolvedCardSize = cardSize ?? CARD_SCENE_CONFIG.cardSize;

  if (rigsRef.current.length === 0) {
    rigsRef.current = slotInfos.map((slot, index) => {
      const sequenceIndex = orderMap.get(slot.id) ?? index;
      return {
        slot,
        sequenceIndex,
        ref: cardRefs[index],
        mode: 'static',
        dealStartMs: null,
        flipStartMs: null,
        dealt: false,
        flipProgress: 0,
        sfxPlayed: false,
        startPos: new THREE.Vector3(
          SHOE_POSITION.x,
          SHOE_POSITION.y + sequenceIndex * 0.02,
          SHOE_POSITION.z
        ),
        startRot: new THREE.Euler(
          SHOE_ROTATION.x,
          SHOE_ROTATION.y,
          SHOE_ROTATION.z + sequenceIndex * 0.05
        ),
        workPos: new THREE.Vector3(),
        workRot: new THREE.Euler(),
      };
    });
  }

  useEffect(() => {
    camera.position.set(0, fullscreen ? 4.4 : 4.1, fullscreen ? 5.4 : 5.0);
    camera.fov = fullscreen ? 40 : 44;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    invalidate();
  }, [camera, fullscreen, invalidate]);

  useEffect(() => {
    if (!isAnimating) {
      rigsRef.current.forEach((rig) => {
        const card = cardsByIdRef.current[rig.slot.id];
        if (!rig.ref.current) return;
        rig.ref.current.visible = Boolean(card);
        if (!card) return;
        rig.ref.current.position.copy(rig.slot.position);
        const flip = card.isHidden ? Math.PI : 0;
        rig.ref.current.rotation.set(
          rig.slot.rotation.x + flip,
          rig.slot.rotation.y,
          rig.slot.rotation.z
        );
        rig.flipProgress = card.isHidden ? 0 : 1;
      });
      invalidate();
    }
  }, [isAnimating, invalidate]);

  useEffect(() => {
    if (!isAnimating) return;
    const now = performance.now();
    animationCompleteRef.current = false;
    skipHandledRef.current = false;
    const dealSet = new Set(dealSlots);
    const revealSet = new Set(revealSlots);

    rigsRef.current.forEach((rig) => {
      const card = cardsByIdRef.current[rig.slot.id];
      const isDeal = dealSet.has(rig.slot.id);
      const isReveal = revealSet.has(rig.slot.id);
      rig.mode = isDeal ? 'deal' : isReveal ? 'reveal' : 'static';
      rig.dealStartMs = isDeal ? now + rig.sequenceIndex * DEAL_INTERVAL_MS : null;
      rig.flipStartMs = isReveal ? now + REVEAL_DELAY_MS + rig.sequenceIndex * REVEAL_STAGGER_MS : null;
      rig.dealt = !isDeal;
      rig.flipProgress = isDeal || isReveal ? 0 : card && !card.isHidden ? 1 : 0;
      rig.sfxPlayed = false;
      if (!rig.ref.current) return;
      rig.ref.current.visible = Boolean(card) || isDeal || isReveal;
      if (rig.mode === 'static' && card) {
        const flip = card.isHidden ? Math.PI : 0;
        rig.ref.current.position.copy(rig.slot.position);
        rig.ref.current.rotation.set(
          rig.slot.rotation.x + flip,
          rig.slot.rotation.y,
          rig.slot.rotation.z
        );
      }
    });
  }, [dealId, dealSlots, revealSlots, isAnimating]);

  useEffect(() => {
    if (!isAnimating || !skipRequested || skipHandledRef.current) return;
    skipHandledRef.current = true;
    rigsRef.current.forEach((rig) => {
      const card = cardsByIdRef.current[rig.slot.id];
      if (!rig.ref.current) return;
      if (!card) {
        rig.ref.current.visible = false;
        return;
      }
      rig.ref.current.visible = true;
      rig.ref.current.position.copy(rig.slot.position);
      const flip = card.isHidden ? Math.PI : 0;
      rig.ref.current.rotation.set(
        rig.slot.rotation.x + flip,
        rig.slot.rotation.y,
        rig.slot.rotation.z
      );
      rig.flipProgress = card.isHidden ? 0 : 1;
    });
    animationCompleteRef.current = true;
    onAnimationComplete?.();
    invalidate();
  }, [isAnimating, skipRequested, onAnimationComplete, invalidate]);

  useFrame(() => {
    if (!isAnimating || animationCompleteRef.current) return;
    const now = performance.now();
    let allDone = true;
    let anyActive = false;

    rigsRef.current.forEach((rig) => {
      const card = cardsByIdRef.current[rig.slot.id];
      if (!rig.ref.current) return;
      if (rig.mode === 'static') {
        rig.ref.current.visible = Boolean(card);
        return;
      }
      anyActive = true;
      rig.ref.current.visible = Boolean(card) || rig.mode !== 'static';

      const startPos = rig.startPos;
      const startRot = rig.startRot;

      if (rig.mode === 'deal') {
        let dealProgress = 0;
        if (rig.dealStartMs !== null) {
          dealProgress = Math.min(1, Math.max(0, (now - rig.dealStartMs) / DEAL_DURATION_MS));
          if (dealProgress < 1) allDone = false;
        } else {
          allDone = false;
        }

        const eased = easeOutCubic(dealProgress);
        const arc = Math.sin(dealProgress * Math.PI) * DEAL_ARC_HEIGHT;
        const pos = rig.workPos.lerpVectors(startPos, rig.slot.position, eased);
        pos.y += arc;

        const rot = rig.workRot.set(
          THREE.MathUtils.lerp(startRot.x, rig.slot.rotation.x, eased),
          THREE.MathUtils.lerp(startRot.y, rig.slot.rotation.y, eased),
          THREE.MathUtils.lerp(startRot.z, rig.slot.rotation.z, eased)
        );

        if (!rig.sfxPlayed && dealProgress > 0.12) {
          rig.sfxPlayed = true;
          void playSfx('deal');
        }

        if (dealProgress >= 1 && !rig.dealt) {
          rig.dealt = true;
        }

        if (rig.dealt && card && !card.isHidden && rig.flipStartMs === null) {
          rig.flipStartMs = now + REVEAL_DELAY_MS + rig.sequenceIndex * REVEAL_STAGGER_MS;
        }

        if (rig.flipStartMs !== null) {
          const flipProgress = Math.min(1, Math.max(0, (now - rig.flipStartMs) / FLIP_DURATION_MS));
          rig.flipProgress = easeInOutCubic(flipProgress);
          if (flipProgress < 1) allDone = false;
        } else if (card && !card.isHidden) {
          allDone = false;
        }

        const flipAngle = (1 - rig.flipProgress) * Math.PI;
        rig.ref.current.position.copy(pos);
        rig.ref.current.rotation.set(rot.x + flipAngle, rot.y, rot.z);
        return;
      }

      if (rig.mode === 'reveal') {
        const cardVisible = Boolean(card) && !card?.isHidden;
        if (!cardVisible) {
          rig.ref.current.position.copy(rig.slot.position);
          rig.ref.current.rotation.set(rig.slot.rotation.x + Math.PI, rig.slot.rotation.y, rig.slot.rotation.z);
          return;
        }

        if (rig.flipStartMs === null) {
          rig.flipStartMs = now + REVEAL_DELAY_MS + rig.sequenceIndex * REVEAL_STAGGER_MS;
        }
        const flipProgress = Math.min(1, Math.max(0, (now - rig.flipStartMs) / FLIP_DURATION_MS));
        rig.flipProgress = easeInOutCubic(flipProgress);
        if (flipProgress < 1) allDone = false;
        const flipAngle = (1 - rig.flipProgress) * Math.PI;
        rig.ref.current.position.copy(rig.slot.position);
        rig.ref.current.rotation.set(
          rig.slot.rotation.x + flipAngle,
          rig.slot.rotation.y,
          rig.slot.rotation.z
        );
      }
    });

    if (anyActive && allDone && !animationCompleteRef.current) {
      animationCompleteRef.current = true;
      onAnimationComplete?.();
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.4}
        castShadow={!isMobile}
        shadow-mapSize-width={isMobile ? 512 : 1024}
        shadow-mapSize-height={isMobile ? 512 : 1024}
      />
      <pointLight position={[-3, 3, -2]} intensity={0.35} color="#00ff88" />
      <pointLight position={[0, 3.2, 4.2]} intensity={0.3} color="#f8c07a" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, tableConfig.y - 0.02, 0]} receiveShadow>
        <planeGeometry args={[tableConfig.width, tableConfig.depth]} />
        <meshStandardMaterial color="#10141b" roughness={0.9} metalness={0.05} />
      </mesh>

      <mesh position={[0, tableConfig.y - 0.03, 0]} receiveShadow>
        <boxGeometry args={[tableConfig.width + 0.5, 0.08, tableConfig.depth + 0.5]} />
        <meshStandardMaterial color="#0b0f13" roughness={0.95} metalness={0.05} />
      </mesh>

      <mesh position={[SHOE_POSITION.x, SHOE_POSITION.y - 0.05, SHOE_POSITION.z]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.85, 0.45, 1.2]} />
        <meshStandardMaterial color="#111827" roughness={0.6} metalness={0.15} />
      </mesh>

      {slotInfos.map((slot, idx) => (
        <Card3D
          key={slot.id}
          ref={cardRefs[idx]}
          card={cardsById[slot.id] ?? null}
          size={resolvedCardSize}
        />
      ))}
    </>
  );
}

export const CardTableScene3D: React.FC<CardTableScene3DProps> = ({
  slots,
  dealOrder,
  cardsById,
  dealId,
  dealSlots,
  revealSlots,
  isAnimating,
  onAnimationComplete,
  isMobile = false,
  fullscreen = false,
  skipRequested,
  tableSize,
  cardSize,
}) => {
  const [sceneReady, setSceneReady] = useState(false);

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
        camera={{ position: [0, 4.1, 5.0], fov: fullscreen ? 40 : 44 }}
      >
        <Suspense fallback={null}>
          <CardTableScene
            slots={slots}
            dealOrder={dealOrder}
            cardsById={cardsById}
            dealId={dealId}
            dealSlots={dealSlots}
            revealSlots={revealSlots}
            isAnimating={isAnimating}
            onAnimationComplete={onAnimationComplete}
            isMobile={isMobile}
            fullscreen={fullscreen}
            skipRequested={skipRequested}
            tableSize={tableSize}
            cardSize={cardSize}
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

export default CardTableScene3D;
