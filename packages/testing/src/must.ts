export const must = <T>(value: T | null | undefined, label: string): T => {
  if (value === undefined || value === null) throw new Error(`expected ${label} to exist`);
  return value;
};
