export const videoSettings = {
  fps: 60,
  durationInFrames: 720,
  width: 1920,
  height: 1080,
} as const;

export const episodeIntervals = [
  { from: 0, durationInFrames: 120 },
  { from: 120, durationInFrames: 480 },
  { from: 600, durationInFrames: 120 },
] as const;
