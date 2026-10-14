/**
 * Rate Limiter with sliding window algorithm
 * Uses in-memory storage for simplicity (can be replaced with Redis for production)
 */

interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
  blockDurationMs: number;
}

interface AttemptRecord {
  attempts: number[];
  blockedUntil: number | null;
}

const store = new Map<string, AttemptRecord>();

const defaultConfigs: Record<string, RateLimitConfig> = {
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxAttempts: 5,
    blockDurationMs: 30 * 60 * 1000, // 30 minutes lockout
  },
  signup: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxAttempts: 5,
    blockDurationMs: 60 * 60 * 1000, // 1 hour lockout
  },
  passwordRecovery: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxAttempts: 3,
    blockDurationMs: 60 * 60 * 1000, // 1 hour lockout
  },
  totp: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxAttempts: 5,
    blockDurationMs: 30 * 60 * 1000, // 30 minutes lockout
  },
  passkey: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxAttempts: 10,
    blockDurationMs: 15 * 60 * 1000, // 15 minutes lockout
  },
};

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number | null;
  blockedUntil: number | null;
  message?: string;
}

function getKey(identifier: string, action: string): string {
  return `${action}:${identifier}`;
}

function cleanupOldAttempts(record: AttemptRecord, windowMs: number): void {
  const now = Date.now();
  record.attempts = record.attempts.filter((t) => now - t < windowMs);
}

export function checkRateLimit(
  identifier: string,
  action: keyof typeof defaultConfigs
): RateLimitResult {
  const config = defaultConfigs[action];
  if (!config) {
    return { success: true, remaining: 999, resetAt: null, blockedUntil: null };
  }

  const key = getKey(identifier, action);
  const now = Date.now();

  let record = store.get(key);
  if (!record) {
    record = { attempts: [], blockedUntil: null };
    store.set(key, record);
  }

  if (record.blockedUntil && now < record.blockedUntil) {
    return {
      success: false,
      remaining: 0,
      resetAt: record.blockedUntil,
      blockedUntil: record.blockedUntil,
      message: `Cuenta bloqueada. Intentá de nuevo en ${Math.ceil((record.blockedUntil - now) / 60000)} minutos.`,
    };
  }

  if (record.blockedUntil && now >= record.blockedUntil) {
    record.blockedUntil = null;
    record.attempts = [];
  }

  cleanupOldAttempts(record, config.windowMs);

  const remaining = Math.max(0, config.maxAttempts - record.attempts.length);
  const oldestAttempt = record.attempts[0];
  const resetAt = oldestAttempt ? oldestAttempt + config.windowMs : null;

  return {
    success: remaining > 0,
    remaining,
    resetAt,
    blockedUntil: null,
    message: remaining === 0 ? 'Demasiados intentos. Esperá unos minutos.' : undefined,
  };
}

export function recordAttempt(
  identifier: string,
  action: keyof typeof defaultConfigs,
  success: boolean
): RateLimitResult {
  const config = defaultConfigs[action];
  if (!config) {
    return { success: true, remaining: 999, resetAt: null, blockedUntil: null };
  }

  const key = getKey(identifier, action);
  const now = Date.now();

  let record = store.get(key);
  if (!record) {
    record = { attempts: [], blockedUntil: null };
    store.set(key, record);
  }

  if (success) {
    record.attempts = [];
    record.blockedUntil = null;
    return { success: true, remaining: config.maxAttempts, resetAt: null, blockedUntil: null };
  }

  record.attempts.push(now);
  cleanupOldAttempts(record, config.windowMs);

  if (record.attempts.length >= config.maxAttempts) {
    record.blockedUntil = now + config.blockDurationMs;
    return {
      success: false,
      remaining: 0,
      resetAt: record.blockedUntil,
      blockedUntil: record.blockedUntil,
      message: `Demasiados intentos fallidos. Cuenta bloqueada por ${Math.ceil(config.blockDurationMs / 60000)} minutos.`,
    };
  }

  return {
    success: true,
    remaining: config.maxAttempts - record.attempts.length,
    resetAt: record.attempts[0] + config.windowMs,
    blockedUntil: null,
  };
}

export function resetRateLimit(identifier: string, action: keyof typeof defaultConfigs): void {
  const key = getKey(identifier, action);
  store.delete(key);
}

export function isBlocked(identifier: string, action: keyof typeof defaultConfigs): boolean {
  const result = checkRateLimit(identifier, action);
  return !result.success;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (record.blockedUntil && now >= record.blockedUntil) {
      store.delete(key);
    } else if (record.attempts.length === 0) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);
