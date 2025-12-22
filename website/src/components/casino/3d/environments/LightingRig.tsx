import React from 'react';
import { LIGHTING_PRESETS, LightingPreset } from '../materials/MaterialConfig';

interface AccentLightConfig {
  position: [number, number, number];
  color?: string;
  intensity?: number;
}

interface LightingRigProps {
  preset?: LightingPreset;
  isMobile?: boolean;
  keyPosition?: [number, number, number];
  fillPosition?: [number, number, number];
  accentLights?: AccentLightConfig[];
  enableShadows?: boolean;
}

export const LightingRig: React.FC<LightingRigProps> = ({
  preset = 'casino',
  isMobile = false,
  keyPosition = [3, 8, 5],
  fillPosition = [-2, 3, 2],
  accentLights,
  enableShadows = true,
}) => {
  const config = LIGHTING_PRESETS[preset];
  const keyIntensity = isMobile ? config.keyLightIntensity * 0.8 : config.keyLightIntensity;
  const fillIntensity = isMobile ? config.fillLightIntensity * 0.8 : config.fillLightIntensity;

  return (
    <>
      <ambientLight color={config.ambientColor} intensity={config.ambientIntensity} />
      <directionalLight
        position={keyPosition}
        color={config.keyLightColor}
        intensity={keyIntensity}
        castShadow={enableShadows && !isMobile}
        shadow-mapSize-width={isMobile ? 512 : 1024}
        shadow-mapSize-height={isMobile ? 512 : 1024}
      />
      <pointLight
        position={fillPosition}
        color={config.fillLightColor}
        intensity={fillIntensity}
      />
      {accentLights?.map((accent, index) => (
        <pointLight
          key={`accent-${index}`}
          position={accent.position}
          color={accent.color ?? config.fillLightColor}
          intensity={accent.intensity ?? fillIntensity}
        />
      ))}
    </>
  );
};

export default LightingRig;
