import type { StartupCommandRule, StartupCommandRunMode } from './models';

const EXPECT_BUFFER_MAX_CHARS = 8192;
const CSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OSC_PATTERN = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

export const STARTUP_RULE_EXPECT_TIMEOUT_MS = 30_000;

export function isStartupCommandRulesMode(mode: unknown): mode is Extract<StartupCommandRunMode, 'rules'> {
  return mode === 'rules';
}

export function sanitizeStartupCommandRules(raw: unknown): StartupCommandRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: StartupCommandRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const expect = typeof record.expect === 'string' ? record.expect : String(record.expect ?? '');
    const send = typeof record.send === 'string' ? record.send : String(record.send ?? '');
    rules.push({ expect, send });
  }
  return rules;
}

export function usableStartupCommandRules(raw: unknown): StartupCommandRule[] {
  return sanitizeStartupCommandRules(raw).filter((rule) => rule.send.length > 0);
}

export function parseStartupCommandRulesInput(raw: unknown): {
  ok: true;
  rules: StartupCommandRule[] | undefined;
} | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, rules: undefined };
  }
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'startupCommandRules must be valid JSON.' };
    }
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: 'startupCommandRules must be an array.' };
  }
  const rules = sanitizeStartupCommandRules(value);
  return { ok: true, rules: rules.length > 0 ? rules : undefined };
}

export function stripControlSequencesForExpect(text: string): string {
  return String(text ?? '').replace(OSC_PATTERN, '').replace(CSI_PATTERN, '');
}

export function appendStartupRuleExpectBuffer(buffer: string, chunk: string): string {
  const next = `${buffer}${stripControlSequencesForExpect(chunk)}`;
  return next.length > EXPECT_BUFFER_MAX_CHARS
    ? next.slice(next.length - EXPECT_BUFFER_MAX_CHARS)
    : next;
}

export function startupCommandRuleExpectMatches(buffer: string, expect: string): boolean {
  const needle = String(expect ?? '').trim();
  if (!needle) return true;
  return buffer.toLowerCase().includes(needle.toLowerCase());
}

export function redactStartupCommandRulesForAgent(
  rules: StartupCommandRule[] | undefined,
): Array<{ expect: string; send: string }> | undefined {
  if (!rules || rules.length === 0) return undefined;
  return rules.map((rule) => ({
    expect: rule.expect,
    send: rule.send ? '[redacted]' : '',
  }));
}
