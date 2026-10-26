// Which recorded price point a replay is on: one point per msPerPoint, then it stays on the last.
export const replayIndex = (elapsedMs: number, msPerPoint: number, points: number): number =>
  Math.min(Math.floor(Math.max(0, elapsedMs) / msPerPoint), points - 1);
