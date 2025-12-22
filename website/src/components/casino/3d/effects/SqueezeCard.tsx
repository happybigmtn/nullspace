import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createSqueezeMaterial } from '../shaders/SqueezeShader';

interface SqueezeCardProps {
  faceTexture: THREE.Texture | null;
  backTexture: THREE.Texture | null;
  size?: [number, number];
  segments?: [number, number];
  bendStrength?: number;
  revealThreshold?: number;
  pivotPoint?: [number, number];
  maxBendAngle?: number;
  suspenseGlow?: number;
  ambientLight?: THREE.ColorRepresentation;
  keyLightDir?: [number, number, number];
  keyLightColor?: THREE.ColorRepresentation;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

export const SqueezeCard: React.FC<SqueezeCardProps> = ({
  faceTexture,
  backTexture,
  size = [2.4, 3.4],
  segments = [12, 18],
  bendStrength = 0,
  revealThreshold = 0.5,
  pivotPoint = [0.5, 0],
  maxBendAngle = Math.PI * 0.5,
  suspenseGlow = 1,
  ambientLight = '#333333',
  keyLightDir = [0.5, 1, 0.5],
  keyLightColor = '#ffffff',
  position = [0, 0, 0],
  rotation = [0, 0, 0],
}) => {
  const geometry = useMemo(
    () => new THREE.PlaneGeometry(size[0], size[1], segments[0], segments[1]),
    [size[0], size[1], segments[0], segments[1]]
  );
  const material = useMemo(() => createSqueezeMaterial(), []);

  useEffect(() => {
    material.transparent = true;
    material.uniforms.uFaceTexture.value = faceTexture;
    material.uniforms.uBackTexture.value = backTexture;
    material.uniforms.uBendStrength.value = bendStrength;
    material.uniforms.uRevealThreshold.value = revealThreshold;
    material.uniforms.uPivotPoint.value.set(pivotPoint[0], pivotPoint[1]);
    material.uniforms.uMaxBendAngle.value = maxBendAngle;
    material.uniforms.uSuspenseGlow.value = suspenseGlow;
    material.uniforms.uAmbientLight.value.set(ambientLight);
    material.uniforms.uKeyLightDir.value
      .set(keyLightDir[0], keyLightDir[1], keyLightDir[2])
      .normalize();
    material.uniforms.uKeyLightColor.value.set(keyLightColor);
  }, [
    ambientLight,
    backTexture,
    bendStrength,
    faceTexture,
    keyLightColor,
    keyLightDir,
    material,
    maxBendAngle,
    pivotPoint,
    revealThreshold,
    suspenseGlow,
  ]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      rotation={rotation}
    />
  );
};

export default SqueezeCard;
