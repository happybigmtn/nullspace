import React from 'react';
import * as THREE from 'three';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

interface CasinoPostProcessingProps {
  enabled?: boolean;
  bloomEnabled?: boolean;
  bloomIntensity?: number;
  bloomThreshold?: number;
  bloomSmoothing?: number;
  toneMapping?: THREE.ToneMapping;
  toneMappingExposure?: number;
  children?: React.ReactNode;
}

export const CasinoPostProcessing: React.FC<CasinoPostProcessingProps> = ({
  enabled = true,
  bloomEnabled = true,
  bloomIntensity = 1.4,
  bloomThreshold = 1.0,
  bloomSmoothing = 0.9,
  toneMapping = THREE.ACESFilmicToneMapping,
  toneMappingExposure = 1,
  children,
}) => {
  if (!enabled) return <>{children}</>;

  return (
    <>
      {children}
      <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
        {bloomEnabled && (
          <Bloom
            intensity={bloomIntensity}
            luminanceThreshold={bloomThreshold}
            luminanceSmoothing={bloomSmoothing}
            height={300}
            blendFunction={BlendFunction.ADD}
          />
        )}
        <ToneMapping mode={toneMapping} exposure={toneMappingExposure} />
      </EffectComposer>
    </>
  );
};

export default CasinoPostProcessing;
