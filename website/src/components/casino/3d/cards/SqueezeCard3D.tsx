import React, { forwardRef, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Card } from '../../../../types';
import { getCardBackTexture, getCardTexture } from '../cardTextures';
import SqueezeCard from '../effects/SqueezeCard';

interface SqueezeCard3DProps {
  card: Card | null;
  size?: [number, number, number];
  progressRef: React.MutableRefObject<number>;
  suspenseGlow?: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const SqueezeCard3D = forwardRef<THREE.Group, SqueezeCard3DProps>(
  ({ card, size = [1.1, 1.6, 0.03], progressRef, suspenseGlow = 1 }, ref) => {
    const materialRef = useRef<THREE.ShaderMaterial | null>(null);
    const faceTexture = useMemo(() => {
      if (!card) return null;
      return card.isHidden ? getCardBackTexture() : getCardTexture(card);
    }, [card]);
    const backTexture = useMemo(() => getCardBackTexture(), []);

    useFrame(() => {
      if (!materialRef.current) return;
      const progress = clamp01(progressRef.current);
      const bendStrength = 0.2 + 0.8 * progress;
      const revealThreshold = 1 - progress;
      materialRef.current.uniforms.uBendStrength.value = bendStrength;
      materialRef.current.uniforms.uRevealThreshold.value = revealThreshold;
      materialRef.current.uniforms.uSuspenseGlow.value = suspenseGlow;
    });

    return (
      <group ref={ref} visible={Boolean(card)}>
        <SqueezeCard
          faceTexture={faceTexture}
          backTexture={backTexture}
          size={[size[0], size[1]]}
          bendStrength={0}
          revealThreshold={1}
          suspenseGlow={suspenseGlow}
          materialRef={materialRef}
        />
      </group>
    );
  }
);

SqueezeCard3D.displayName = 'SqueezeCard3D';

export default SqueezeCard3D;
