export type EndCardTiming = {
  endCardFrames: number;
  holdFrames: number;
  revealFrames: number;
};

export const getEndCardTiming = ({
  fps,
  endCardSeconds,
  endHoldSeconds,
  revealSeconds,
  durationInFrames,
}: {
  fps: number;
  endCardSeconds: number;
  endHoldSeconds: number;
  revealSeconds: number;
  durationInFrames?: number;
}): EndCardTiming => {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("The frame rate must be a finite positive number.");
  }
  for (const [name, seconds] of Object.entries({
    endCardSeconds,
    endHoldSeconds,
    revealSeconds,
  })) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`${name} must be a finite non-negative number.`);
    }
  }

  if (endCardSeconds === 0) {
    return { endCardFrames: 0, holdFrames: 0, revealFrames: 0 };
  }
  if (endCardSeconds < endHoldSeconds) {
    throw new Error(
      "endCardSeconds must be at least endHoldSeconds; use zero to disable the end card and its hold.",
    );
  }

  const configuredEndCardFrames = Math.round(endCardSeconds * fps);
  const holdFrames = Math.round(endHoldSeconds * fps);
  const requestedRevealFrames = Math.round(revealSeconds * fps);
  if (
    ![configuredEndCardFrames, holdFrames, requestedRevealFrames].every(
      Number.isSafeInteger,
    )
  ) {
    throw new Error(
      "End-card timing must fit within safe integer frame counts.",
    );
  }
  if (configuredEndCardFrames === 0) {
    throw new Error("A positive end card must span at least one frame.");
  }

  const endCardFrames = durationInFrames ?? configuredEndCardFrames;
  if (!Number.isSafeInteger(endCardFrames) || endCardFrames <= 0) {
    throw new Error("durationInFrames must be a positive safe integer.");
  }
  if (endCardFrames < holdFrames) {
    throw new Error(
      "The end-card durationInFrames must be at least the rounded hold frame count.",
    );
  }

  return {
    endCardFrames,
    holdFrames,
    revealFrames: Math.min(requestedRevealFrames, endCardFrames - holdFrames),
  };
};
