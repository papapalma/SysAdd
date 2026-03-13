interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface StrengthLabel {
  label: string;
  color: string;
}

const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: false,
};

export function validatePasswordStrength(password: string): ValidationResult {
  const errors: string[] = [];

  if (!password) return { valid: false, errors: ['Password is required'] };

  if (password.length < PASSWORD_REQUIREMENTS.minLength)
    errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters long`);

  if (password.length > PASSWORD_REQUIREMENTS.maxLength)
    errors.push(`Password must not exceed ${PASSWORD_REQUIREMENTS.maxLength} characters`);

  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password))
    errors.push('Password must contain at least one uppercase letter');

  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password))
    errors.push('Password must contain at least one lowercase letter');

  if (PASSWORD_REQUIREMENTS.requireNumber && !/\d/.test(password))
    errors.push('Password must contain at least one number');

  if (
    PASSWORD_REQUIREMENTS.requireSpecialChar &&
    !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
  )
    errors.push('Password must contain at least one special character');

  return { valid: errors.length === 0, errors };
}

export function calculatePasswordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;

  score += Math.min(30, password.length * 2);

  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/\d/.test(password)) score += 10;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 10;

  // Bonus for length beyond minimum
  if (password.length >= 12) score += 10;
  if (password.length >= 16) score += 10;

  return Math.min(100, score);
}

export function getPasswordStrengthLabel(score: number): StrengthLabel {
  if (score < 30) return { label: 'Very Weak', color: 'red' };
  if (score < 50) return { label: 'Weak', color: 'orange' };
  if (score < 70) return { label: 'Fair', color: 'yellow' };
  if (score < 90) return { label: 'Strong', color: 'green' };
  return { label: 'Very Strong', color: 'darkgreen' };
}
