export interface AstValidationResult {
  passed: boolean;
  violations: string[];
}

export class AstSecurityValidator {
  private static readonly BANNED_PATTERNS = [
    { pattern: /child_process\.(exec|spawn|fork|execSync)/, reason: 'Arbitrary child process execution is strictly prohibited' },
    { pattern: /fs\.(unlink|rmdir|rm|rmSync|unlinkSync)/, reason: 'File deletion or filesystem mutation is prohibited' },
    { pattern: /\.ssh|\.bash_history|\.gnupg/, reason: 'Access to sensitive operating system credentials is prohibited' },
    { pattern: /eval\s*\(|new\s+Function\s*\(/, reason: 'Dynamic code execution (eval) is prohibited' },
    { pattern: /process\.env\.PRIVATE_KEY\s*=\s*/, reason: 'Modifying process environment secrets is prohibited' },
  ];

  /**
   * Scans generated script code for prohibited security violations
   */
  public static validate(code: string): AstValidationResult {
    const violations: string[] = [];

    for (const rule of this.BANNED_PATTERNS) {
      if (rule.pattern.test(code)) {
        violations.push(`Security violation: ${rule.reason}`);
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}
