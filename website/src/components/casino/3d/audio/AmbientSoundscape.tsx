import React, { useEffect, useMemo } from 'react';
import AudioManager, { type AmbienceProfile } from './AudioManager';

interface AmbientSoundscapeProps {
  profile?: AmbienceProfile;
  enabled?: boolean;
}

export const AmbientSoundscape: React.FC<AmbientSoundscapeProps> = ({
  profile = 'vegas',
  enabled = true,
}) => {
  const manager = useMemo(() => AudioManager.getInstance(), []);

  useEffect(() => {
    if (!enabled) {
      manager.setAmbienceProfile('off');
      return () => manager.setAmbienceProfile('off');
    }

    manager.setAmbienceProfile(profile);

    return () => {
      manager.setAmbienceProfile('off');
    };
  }, [enabled, manager, profile]);

  return null;
};

export default AmbientSoundscape;
