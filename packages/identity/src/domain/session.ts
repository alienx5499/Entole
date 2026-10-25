export const SESSION_MAX_AGE_SEC = 7 * 24 * 3600;

export const sessionExpiresAt = (now: Date): Date =>
  new Date(now.getTime() + SESSION_MAX_AGE_SEC * 1000);
