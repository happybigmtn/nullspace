/**
 * Physics Infrastructure - Guided forces and noise exports
 */

// Guided force system
export {
  type FalloffCurve,
  type AttractorConfig,
  ATTRACTOR_PRESETS,
  type GuidanceState,
  evaluateVelocityGate,
  evaluateHeightGate,
  evaluatePhaseGate,
  calculateAttractorForce,
  calculateAlignmentTorque,
  ROULETTE_GEOMETRY,
  ROULETTE_PHYSICS,
  DICE_PHYSICS,
  CARD_PHYSICS,
  DICE_FACE_ROTATIONS,
  getDiceFaceRotation,
} from './guidedForces';

// Noise utilities
export {
  createSeededNoise2D,
  createSeededNoise3D,
  createSeededNoise4D,
  sampleNoise3D,
  sampleNoise01,
  type FBMOptions,
  createFBM3D,
  getNoiseForSeed,
  clearNoiseCache,
  turbulence3D,
  ridged3D,
  curlNoise3D,
} from './noise';

// Roulette helpers
export {
  type RoulettePocket,
  type RouletteLaunchParams,
  type RouletteLaunchConfig,
  getPocketAngle,
  getPocketPosition,
  buildRoulettePockets,
  computeRouletteLaunch,
} from './RoulettePhysics';

// Worker scaffold
export {
  createPhysicsWorker,
  addPhysicsWorkerListener,
  type PhysicsWorkerHandle,
} from './PhysicsWorkerBridge';
export type { PhysicsWorkerRequest, PhysicsWorkerResponse } from './physicsWorker';
