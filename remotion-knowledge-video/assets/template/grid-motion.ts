export const getGridTravelSeconds = (
  seconds: number,
  durationSeconds: number,
  holdSeconds = 0,
): number => {
  const elapsed = Math.max(0, seconds);
  if (holdSeconds <= 0) return elapsed;

  const holdStart = Math.max(0, durationSeconds - holdSeconds);
  const slowdownSeconds = Math.min(1, holdStart);
  const slowdownStart = holdStart - slowdownSeconds;
  if (elapsed <= slowdownStart) return elapsed;
  if (slowdownSeconds === 0) return 0;

  const progress = Math.min(1, (elapsed - slowdownStart) / slowdownSeconds);
  // Integrate smoothstep velocity so position and speed stay continuous.
  return (
    slowdownStart +
    slowdownSeconds * (progress - progress ** 3 + progress ** 4 / 2)
  );
};
