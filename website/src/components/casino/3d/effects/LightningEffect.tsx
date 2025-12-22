import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { lightningFragmentShader, lightningVertexShader } from '../shaders/LightningShader';

interface LightningEffectProps {
  active?: boolean;
  color?: THREE.ColorRepresentation;
  intensity?: number;
  boltCount?: number;
  branchiness?: number;
  size?: [number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}

export const LightningEffect: React.FC<LightningEffectProps> = ({
  active = false,
  color = '#99ccff',
  intensity = 1.2,
  boltCount = 2,
  branchiness = 0.7,
  size = [5, 5],
  position = [0, 0.2, 0],
  rotation = [-Math.PI / 2, 0, 0],
  scale = 1,
}) => {
  const geometry = useMemo(
    () => new THREE.PlaneGeometry(size[0], size[1], 1, 1),
    [size[0], size[1]]
  );
  const material = useMemo(() => {
    const uniforms = {
      uTime: { value: 0 },
      uLightningActive: { value: false },
      uLightningColor: { value: new THREE.Color('#ffffff') },
      uIntensity: { value: 1 },
      uBoltCount: { value: 2 },
      uBranchiness: { value: 0.7 },
    };

    return new THREE.ShaderMaterial({
      vertexShader: lightningVertexShader,
      fragmentShader: lightningFragmentShader,
      uniforms: uniforms as Record<string, THREE.IUniform>,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }, []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.getElapsedTime();
  });

  useEffect(() => {
    material.uniforms.uLightningActive.value = active;
  }, [active, material]);

  useEffect(() => {
    material.uniforms.uLightningColor.value.set(color);
  }, [color, material]);

  useEffect(() => {
    material.uniforms.uIntensity.value = intensity;
  }, [intensity, material]);

  useEffect(() => {
    material.uniforms.uBoltCount.value = boltCount;
  }, [boltCount, material]);

  useEffect(() => {
    material.uniforms.uBranchiness.value = branchiness;
  }, [branchiness, material]);

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
      scale={scale}
      renderOrder={10}
    />
  );
};

export default LightningEffect;
