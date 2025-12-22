import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshCollider, RigidBody } from '@react-three/rapier';

interface PyramidWallColliderProps {
  width: number;
  height: number;
  pyramidSize: number;
  pyramidDepth: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  restitution?: number;
  friction?: number;
  collisionGroups?: number;
}

export const PyramidWallCollider: React.FC<PyramidWallColliderProps> = ({
  width,
  height,
  pyramidSize,
  pyramidDepth,
  position,
  rotation,
  restitution = 0.6,
  friction = 0.4,
  collisionGroups,
}) => {
  const geometry = useMemo(() => {
    const cols = Math.max(1, Math.floor(width / pyramidSize));
    const rows = Math.max(1, Math.floor(height / pyramidSize));
    const xStart = -width / 2 + pyramidSize / 2;
    const yStart = -height / 2 + pyramidSize / 2;
    const geometries: THREE.BufferGeometry[] = [];

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const pyramid = new THREE.ConeGeometry(pyramidSize / 2, pyramidDepth, 4, 1);
        pyramid.rotateZ(Math.PI / 4);
        pyramid.rotateX(Math.PI / 2);
        pyramid.translate(
          xStart + i * pyramidSize,
          yStart + j * pyramidSize,
          pyramidDepth / 2
        );
        geometries.push(pyramid);
      }
    }

    return mergeGeometries(geometries, false);
  }, [width, height, pyramidSize, pyramidDepth]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <RigidBody type="fixed" position={position} rotation={rotation} colliders={false}>
      <MeshCollider
        type="trimesh"
        restitution={restitution}
        friction={friction}
        collisionGroups={collisionGroups}
      >
        <mesh geometry={geometry} visible={false} />
      </MeshCollider>
    </RigidBody>
  );
};

export default PyramidWallCollider;
