/**
 * 3D Baccarat Scene - Card deal + reveal synchronized to chain state.
 *
 * Cards deal face-down from the shoe, then flip to the chain-resolved faces.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Card } from '../../../types';
import { playSfx } from '../../../services/sfx';
import Card3D from './Card3D';

type HandSide = 'player' | 'banker';

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

const TABLE_WIDTH = 8;
const TABLE_DEPTH = 6;
const TABLE_Y = -0.2;

const CARD_SIZE: [number, number, number] = [1.45, 2.15, 0.04];
const CARD_SPACING = 1.55;
const HAND_Z_OFFSET = 1.85;
const BASE_ROTATION_X = -Math.PI / 2 + 0.45;

const SHOE_POSITION = new THREE.Vector3(3.0, 0.55, 0.0);
const SHOE_ROTATION = new THREE.Euler(-Math.PI / 2 + 0.4, Math.PI / 2, 0);

const DEAL_INTERVAL_MS = 220;
const DEAL_DURATION_MS = 520;
const DEAL_ARC_HEIGHT = 0.35;
const REVEAL_DELAY_MS = 140;
const REVEAL_STAGGER_MS = 120;
const FLIP_DURATION_MS = 320;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const DEAL_ORDER: Array<{ hand: HandSide; index: number }> = [
  { hand: 'player', index: 0 },
  { hand: 'banker', index: 0 },
  { hand: 'player', index: 1 },
  { hand: 'banker', index: 1 },
  { hand: 'player', index: 2 },
  { hand: 'banker', index: 2 },
];

type SlotInfo = {
  id: string;
  hand: HandSide;
  index: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
};

type CardRig = {
  slot: SlotInfo;
  sequenceIndex: number;
  ref: React.RefObject<THREE.Group>;
  active: boolean;
  dealStartMs: number | null;
  flipStartMs: number | null;
  dealt: boolean;
  flipProgress: number;
  hasTarget: boolean;
  sfxPlayed: boolean;
  startPos: THREE.Vector3;
  startRot: THREE.Euler;
  workPos: THREE.Vector3;
  workRot: THREE.Euler;
};

const buildSlots = (): SlotInfo[] => {
  const slots: SlotInfo[] = [];
  const playerZ = HAND_Z_OFFSET;
  const bankerZ = -HAND_Z_OFFSET;
  for (let i = 0; i < 3; i += 1) {
    const x = (i - 1) * CARD_SPACING;
    const baseRotation = new THREE.Euler(BASE_ROTATION_X, 0, (i - 1) * 0.08);
    slots.push({
      id: `player-${i}`,
      hand: 'player',
      index: i,
      position: new THREE.Vector3(x, TABLE_Y + CARD_SIZE[2] / 2 + 0.06, playerZ),
      rotation: baseRotation,
    });
    slots.push({
      id: `banker-${i}`,
      hand: 'banker',
      index: i,
      position: new THREE.Vector3(x, TABLE_Y + CARD_SIZE[2] / 2 + 0.06, bankerZ),
      rotation: new THREE.Euler(BASE_ROTATION_X, 0, -(i - 1) * 0.08),
    });
  }
  return slots;
};

const getCardForSlot = (cards: Card[], index: number) => (index < cards.length ? cards[index] : null);

function BaccaratTableScene({
  playerCards,
  bankerCards,
  targetKey,
  dealId,
  isAnimating,
  onAnimationComplete,
  fullscreen,
  isMobile,
  skipRequested,
}: BaccaratScene3DProps) {
  const { camera, invalidate } = useThree();
  const slots = useMemo(() => buildSlots(), []);
  const slotMap = useMemo(() => new Map(slots.map((slot) => [slot.id, slot])), [slots]);
  const cardRefs = useMemo(
    () => DEAL_ORDER.map(() => React.createRef<THREE.Group>()),
    []
  );
  const cardIds = useMemo(
    () => DEAL_ORDER.map((entry) => `${entry.hand}-${entry.index}`),
    []
  );
  const [cardFaces, setCardFaces] = useState<Array<Card | null>>(() => DEAL_ORDER.map(() => null));
  const rigsRef = useRef<CardRig[]>([]);
  const skipHandledRef = useRef(false);
  const dealStateRef = useRef({
    dealStartMs: 0,
    targetReady: false,
    animationComplete: false,
  });

  if (rigsRef.current.length === 0) {
    rigsRef.current = DEAL_ORDER.map((entry, sequenceIndex) => {
      const slotId = `${entry.hand}-${entry.index}`;
      const slot = slotMap.get(slotId)!;
      return {
        slot,
        sequenceIndex,
        ref: cardRefs[sequenceIndex],
        active: false,
        dealStartMs: null,
        flipStartMs: null,
        dealt: false,
        flipProgress: 0,
        hasTarget: false,
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
    camera.position.set(0, fullscreen ? 4.3 : 4.0, fullscreen ? 5.3 : 4.9);
    camera.fov = fullscreen ? 40 : 44;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    invalidate();
  }, [camera, fullscreen, invalidate]);

  useEffect(() => {
    if (!isAnimating) return;
    skipHandledRef.current = false;
    const now = performance.now();
    dealStateRef.current = {
      dealStartMs: now,
      targetReady: false,
      animationComplete: false,
    };
    rigsRef.current.forEach((rig) => {
      rig.active = rig.sequenceIndex < 4;
      rig.dealStartMs = rig.active ? now + rig.sequenceIndex * DEAL_INTERVAL_MS : null;
      rig.flipStartMs = null;
      rig.dealt = false;
      rig.flipProgress = 0;
      rig.hasTarget = false;
      rig.sfxPlayed = false;
      if (rig.ref.current) {
        rig.ref.current.visible = rig.active;
      }
    });
    setCardFaces(DEAL_ORDER.map(() => null));
  }, [dealId, isAnimating]);

  useEffect(() => {
    skipHandledRef.current = false;
  }, [dealId]);

  useEffect(() => {
    const hasTargets = targetKey !== '';
    dealStateRef.current.targetReady = hasTargets;

    const safePlayerCards = hasTargets ? playerCards : [];
    const safeBankerCards = hasTargets ? bankerCards : [];

    const nextFaces = DEAL_ORDER.map((entry) => {
      const source = entry.hand === 'player' ? safePlayerCards : safeBankerCards;
      return getCardForSlot(source, entry.index);
    });
    setCardFaces(nextFaces);

    const now = performance.now();
    const dealBase = dealStateRef.current.dealStartMs || now;
    const activeOrder = DEAL_ORDER.filter((entry) => {
      const count = entry.hand === 'player' ? safePlayerCards.length : safeBankerCards.length;
      return entry.index < count;
    });
    const activeIndexMap = new Map(
      activeOrder.map((entry, index) => [`${entry.hand}-${entry.index}`, index])
    );
    rigsRef.current.forEach((rig) => {
      const targetCard =
        rig.slot.hand === 'player'
          ? getCardForSlot(safePlayerCards, rig.slot.index)
          : getCardForSlot(safeBankerCards, rig.slot.index);
      rig.hasTarget = Boolean(targetCard);
      if (rig.sequenceIndex >= 4) {
        rig.active = Boolean(targetCard);
        if (rig.active && rig.dealStartMs === null) {
          const activeIndex = activeIndexMap.get(rig.slot.id) ?? rig.sequenceIndex;
          rig.dealStartMs = Math.max(now, dealBase + activeIndex * DEAL_INTERVAL_MS);
        }
      }
      if (!rig.active && rig.ref.current) {
        rig.ref.current.visible = false;
      }
    });

    if (!isAnimating) {
      rigsRef.current.forEach((rig) => {
        if (!rig.ref.current) return;
        const targetCard =
          rig.slot.hand === 'player'
            ? getCardForSlot(safePlayerCards, rig.slot.index)
            : getCardForSlot(safeBankerCards, rig.slot.index);
        rig.active = Boolean(targetCard);
        rig.dealStartMs = null;
        rig.flipStartMs = null;
        rig.dealt = true;
        rig.flipProgress = rig.active ? 1 : 0;
        rig.hasTarget = rig.active;
        rig.ref.current.visible = rig.active;
        if (!rig.active) return;
        rig.ref.current.position.copy(rig.slot.position);
        rig.ref.current.rotation.set(
          rig.slot.rotation.x,
          rig.slot.rotation.y,
          rig.slot.rotation.z
        );
      });
      invalidate();
    }
  }, [playerCards, bankerCards, targetKey, isAnimating, invalidate]);

  useEffect(() => {
    if (!isAnimating || !skipRequested || skipHandledRef.current) return;
    if (targetKey === '' || dealStateRef.current.animationComplete) return;
    skipHandledRef.current = true;

    rigsRef.current.forEach((rig) => {
      const targetCard =
        rig.slot.hand === 'player'
          ? getCardForSlot(playerCards, rig.slot.index)
          : getCardForSlot(bankerCards, rig.slot.index);
      rig.active = Boolean(targetCard);
      rig.dealStartMs = null;
      rig.flipStartMs = null;
      rig.dealt = rig.active;
      rig.flipProgress = rig.active ? 1 : 0;
      rig.hasTarget = rig.active;
      rig.sfxPlayed = true;
      if (!rig.ref.current) return;
      rig.ref.current.visible = rig.active;
      if (!rig.active) return;
      rig.ref.current.position.copy(rig.slot.position);
      rig.ref.current.rotation.set(
        rig.slot.rotation.x,
        rig.slot.rotation.y,
        rig.slot.rotation.z
      );
    });

    dealStateRef.current.targetReady = true;
    dealStateRef.current.animationComplete = true;
    onAnimationComplete?.();
    invalidate();
  }, [isAnimating, skipRequested, targetKey, playerCards, bankerCards, onAnimationComplete, invalidate]);

  useFrame(() => {
    if (!isAnimating) return;
    const now = performance.now();
    let allDone = true;
    let anyActive = false;

    rigsRef.current.forEach((rig) => {
      if (!rig.active || !rig.ref.current) return;
      anyActive = true;
      rig.ref.current.visible = true;

      const startPos = rig.startPos;
      const startRot = rig.startRot;

      let dealProgress = 0;
      if (rig.dealStartMs !== null) {
        dealProgress = Math.min(1, Math.max(0, (now - rig.dealStartMs) / DEAL_DURATION_MS));
        if (dealProgress < 1) {
          allDone = false;
        }
      } else {
        allDone = false;
      }

      const easedDeal = easeOutCubic(dealProgress);
      const arc = Math.sin(dealProgress * Math.PI) * DEAL_ARC_HEIGHT;
      const targetPos = rig.slot.position;
      const pos = rig.workPos.lerpVectors(startPos, targetPos, easedDeal);
      pos.y += arc;

      const rot = rig.workRot.set(
        THREE.MathUtils.lerp(startRot.x, rig.slot.rotation.x, easedDeal),
        THREE.MathUtils.lerp(startRot.y, rig.slot.rotation.y, easedDeal),
        THREE.MathUtils.lerp(startRot.z, rig.slot.rotation.z, easedDeal)
      );

      if (!rig.sfxPlayed && dealProgress > 0.1) {
        rig.sfxPlayed = true;
        void playSfx('deal');
      }

      if (dealProgress >= 1 && !rig.dealt) {
        rig.dealt = true;
      }

      if (rig.dealt && rig.hasTarget && rig.flipStartMs === null) {
        rig.flipStartMs = now + REVEAL_DELAY_MS + rig.sequenceIndex * REVEAL_STAGGER_MS;
      }

      if (rig.flipStartMs !== null) {
        const flipProgress = Math.min(1, Math.max(0, (now - rig.flipStartMs) / FLIP_DURATION_MS));
        rig.flipProgress = easeInOutCubic(flipProgress);
        if (flipProgress < 1) {
          allDone = false;
        }
      } else if (rig.hasTarget) {
        allDone = false;
      }

      const flipAngle = (1 - rig.flipProgress) * Math.PI;
      rig.ref.current.position.copy(pos);
      rig.ref.current.rotation.set(rot.x + flipAngle, rot.y, rot.z);
    });

    if (dealStateRef.current.targetReady && anyActive && allDone && !dealStateRef.current.animationComplete) {
      dealStateRef.current.animationComplete = true;
      onAnimationComplete?.();
    }
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.35}
        castShadow={!isMobile}
        shadow-mapSize-width={isMobile ? 512 : 1024}
        shadow-mapSize-height={isMobile ? 512 : 1024}
      />
      <pointLight position={[-3, 3, -2]} intensity={0.35} color="#00ff88" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TABLE_Y - 0.02, 0]} receiveShadow>
        <planeGeometry args={[TABLE_WIDTH, TABLE_DEPTH]} />
        <meshStandardMaterial color="#10141b" roughness={0.9} metalness={0.05} />
      </mesh>

      <mesh position={[0, TABLE_Y - 0.03, 0]} receiveShadow>
        <boxGeometry args={[TABLE_WIDTH + 0.5, 0.08, TABLE_DEPTH + 0.5]} />
        <meshStandardMaterial color="#0b0f13" roughness={0.95} metalness={0.05} />
      </mesh>

      <mesh position={[SHOE_POSITION.x, SHOE_POSITION.y - 0.05, SHOE_POSITION.z]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.8, 0.4, 1.1]} />
        <meshStandardMaterial color="#111827" roughness={0.6} metalness={0.15} />
      </mesh>

      {cardIds.map((id, idx) => (
        <Card3D key={`${id}-${idx}`} ref={cardRefs[idx]} card={cardFaces[idx] ?? null} size={CARD_SIZE} />
      ))}
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
        dpr={isMobile ? 1 : [1, 1.75]}
        frameloop={isAnimating ? 'always' : 'demand'}
        gl={{ antialias: !isMobile, alpha: true, powerPreference: isMobile ? 'low-power' : 'high-performance' }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 0, 0);
          setSceneReady(true);
        }}
        shadows={!isMobile}
        camera={{ position: [0, 4.3, 5.2], fov: fullscreen ? 42 : 46 }}
      >
        <Suspense fallback={null}>
          <BaccaratTableScene
            playerCards={playerCards}
            bankerCards={bankerCards}
            targetKey={targetKey}
            dealId={dealId}
            isAnimating={isAnimating}
            onAnimationComplete={onAnimationComplete}
            fullscreen={fullscreen}
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
    </div>
  );
};

export default BaccaratScene3D;
