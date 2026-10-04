export const clipSettings = {
  fps: 30,
  durationInFrames: 660,
  width: 1920,
  height: 1080,
  showNarrationText: false,
} as const;

export const sceneIntervals = [
  { from: 0, durationInFrames: 180 },
  { from: 180, durationInFrames: 300 },
  { from: 480, durationInFrames: 180 },
] as const;
