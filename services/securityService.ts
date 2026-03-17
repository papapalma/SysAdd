import LoginAttempt from '../models/LoginAttempt.js';
import { User } from '../models/userModel.js';
import { Op } from 'sequelize';

// LoginAttempt table is optional in some deployments; fail-open if missing/denied
let loginAttemptLoggingDisabled = false;

function shouldDisableLoginAttempts(err: any): boolean {
  const code = err?.original?.code || err?.parent?.code;
  return (
    code === 'ER_NO_SUCH_TABLE' ||
    code === 'ER_TABLEACCESS_DENIED_ERROR' ||
    code === 'ER_DBACCESS_DENIED_ERROR' ||
    code === 'ER_NO_DB_ERROR'
  );
}

function disableLoginAttempts(err: any) {
  if (loginAttemptLoggingDisabled) return;
  if (shouldDisableLoginAttempts(err)) {
    loginAttemptLoggingDisabled = true;
    console.warn(
      '[security] LoginAttempt tracking disabled (table missing or access denied). Proceeding without rate-limit/lockout checks.'
    );
  }
}

interface SecurityConfig {
  MAX_FAILED_ATTEMPTS: number;
  LOCKOUT_DURATION_MINUTES: number;
  RATE_LIMIT_WINDOW_MINUTES: number;
  MAX_ATTEMPTS_PER_IP: number;
  SUSPICIOUS_IP_THRESHOLD: number;
  CHALLENGE_AFTER_FAILURES: number;
}

interface LoginAttemptData {
  email: string;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  failureReason: string | null;
}

interface LockStatus {
  locked: boolean;
  minutesRemaining?: number;
  unlockTime?: Date;
}

const SECURITY_CONFIG: SecurityConfig = {
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 30,
  RATE_LIMIT_WINDOW_MINUTES: 15,
  MAX_ATTEMPTS_PER_IP: 10,
  SUSPICIOUS_IP_THRESHOLD: 20,
  CHALLENGE_AFTER_FAILURES: 3,
};

export async function isRateLimited(ipAddress: string): Promise<boolean> {
  if (loginAttemptLoggingDisabled) return false;
  const windowStart = new Date(
    Date.now() - SECURITY_CONFIG.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
  );
  try {
    const count = await LoginAttempt.count({
      where: { ipAddress, timestamp: { [Op.gte]: windowStart } },
    });
    return count >= SECURITY_CONFIG.MAX_ATTEMPTS_PER_IP;
  } catch (err) {
    console.error('[security] isRateLimited query failed', err);
    disableLoginAttempts(err);
    return false; // fail-open on rate limit if table/query fails
  }
}

// Fail-open if LoginAttempt table is missing or not permitted
export async function isAccountLocked(email: string): Promise<LockStatus> {
  if (loginAttemptLoggingDisabled) return { locked: false };
  const lockoutThreshold = new Date(
    Date.now() - SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES * 60 * 1000
  );
  try {
    const recentFailures = await LoginAttempt.count({
      where: {
        email,
        success: false,
        timestamp: { [Op.gte]: lockoutThreshold },
      },
    });

    if (recentFailures >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS) {
      const lastAttempt: any = await LoginAttempt.findOne({
        where: { email, success: false },
        order: [['timestamp', 'DESC']],
      });
      if (lastAttempt) {
        const unlockTime = new Date(
          lastAttempt.timestamp.getTime() +
            SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES * 60 * 1000
        );
        if (new Date() < unlockTime) {
          return {
            locked: true,
            minutesRemaining: Math.ceil(
              (unlockTime.getTime() - Date.now()) / (60 * 1000)
            ),
            unlockTime,
          };
        }
      }
    }
    return { locked: false };
  } catch (err) {
    console.error('[security] isAccountLocked query failed', err);
    disableLoginAttempts(err);
    return { locked: false };
  }
}

export async function shouldShowChallenge(
  email: string,
  ipAddress: string
): Promise<boolean> {
  if (loginAttemptLoggingDisabled) return false;
  const windowStart = new Date(
    Date.now() - SECURITY_CONFIG.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
  );
  try {
    const recentFailures = await LoginAttempt.count({
      where: {
        [Op.or]: [{ email }, { ipAddress }],
        success: false,
        timestamp: { [Op.gte]: windowStart },
      },
    });
    return recentFailures >= SECURITY_CONFIG.CHALLENGE_AFTER_FAILURES;
  } catch (err) {
    console.error('[security] shouldShowChallenge query failed', err);
    disableLoginAttempts(err);
    return false;
  }
}

export async function isSuspiciousIP(ipAddress: string): Promise<boolean> {
  if (loginAttemptLoggingDisabled) return false;
  try {
    const totalFailures = await LoginAttempt.count({
      where: { ipAddress, success: false },
    });
    return totalFailures >= SECURITY_CONFIG.SUSPICIOUS_IP_THRESHOLD;
  } catch (err) {
    console.error('[security] isSuspiciousIP query failed', err);
    disableLoginAttempts(err);
    return false;
  }
}

export async function logLoginAttempt(data: LoginAttemptData): Promise<void> {
  if (loginAttemptLoggingDisabled) return;
  try {
    await LoginAttempt.create({
      ...data,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Failed to log login attempt:', error);
    disableLoginAttempts(error);
  }
}

export async function getRecentAttempts(email: string, limit = 10) {
  return LoginAttempt.findAll({
    where: { email },
    order: [['timestamp', 'DESC']],
    limit,
  });
}

export async function updateLastLogin(
  userId: number,
  ipAddress: string,
  userAgent: string
): Promise<void> {
  try {
    await User.update(
      {
        lastLogin: new Date(),
        lastLoginIp: ipAddress,
        lastLoginUserAgent: userAgent,
      },
      { where: { id: userId } }
    );
  } catch (error) {
    console.error('Failed to update last login:', error);
  }
}

export function validateChallenge(
  answer: string | number,
  expected: string | number
): boolean {
  return parseInt(String(answer)) === parseInt(String(expected));
}

export function generateChallenge(): { question: string; answer: number } {
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  return {
    question: `What is ${num1} + ${num2}?`,
    answer: num1 + num2,
  };
}

export async function cleanupOldAttempts(daysToKeep = 90): Promise<number> {
  const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  if (loginAttemptLoggingDisabled) return 0;
  try {
    const deleted = await LoginAttempt.destroy({
      where: { timestamp: { [Op.lt]: cutoffDate } },
    });
    return deleted;
  } catch (error) {
    console.error('Failed to cleanup old attempts:', error);
    return 0;
  }
}
