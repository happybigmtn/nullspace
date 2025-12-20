/**
 * 3D Dice Model with pip faces
 *
 * Renders a casino-style die with proper pip layout.
 * Uses terminal-green color scheme to match NullSociety branding.
 */
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { PIP_POSITIONS } from './diceUtils';

// Terminal green from your theme
const DICE_COLOR = '#0a0a0a'; // Near black
const PIP_COLOR = '#00ff41'; // Terminal green

interface DiceModelProps {
  size?: number;
}

/**
 * Creates a face texture with pips for a given dice value
 */
function createFaceTexture(value: number, size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Fill background
  ctx.fillStyle = DICE_COLOR;
  ctx.fillRect(0, 0, size, size);

  // Draw border
  ctx.strokeStyle = PIP_COLOR;
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  // Draw pips
  const pips = PIP_POSITIONS[value] || [];
  const pipRadius = size * 0.08;
  ctx.fillStyle = PIP_COLOR;

  for (const [px, py] of pips) {
    const x = size / 2 + px * size;
    const y = size / 2 - py * size; // Flip Y for canvas coords
    ctx.beginPath();
    ctx.arc(x, y, pipRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Standard die face arrangement:
 * - Face order for BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
 * - Standard die: 1 opposite 6, 2 opposite 5, 3 opposite 4
 * - With 1 on top (+Y) and 2 facing camera (+Z):
 *   +X = 3, -X = 4, +Y = 1, -Y = 6, +Z = 2, -Z = 5
 */
const FACE_VALUES = [3, 4, 1, 6, 2, 5]; // Maps to BoxGeometry face order

export const DiceModel: React.FC<DiceModelProps> = React.memo(({ size = 1 }) => {
  const materials = useMemo(() => {
    return FACE_VALUES.map((value) => {
      const texture = createFaceTexture(value);
      return new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.3,
        metalness: 0.1,
      });
    });
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(size, size, size);
    // Round the corners slightly by scaling vertices (simple approach)
    // For a more polished look, you could use a custom rounded box
    return geo;
  }, [size]);

  return (
    <mesh geometry={geometry} material={materials} castShadow receiveShadow>
      {/* The geometry and materials handle all 6 faces */}
    </mesh>
  );
});

DiceModel.displayName = 'DiceModel';

export default DiceModel;
