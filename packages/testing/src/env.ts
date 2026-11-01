// For live tests and sandbox scripts only; the API reads its environment in its composition root.
export const readEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
};
