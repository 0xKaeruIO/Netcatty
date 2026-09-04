import type { Terminal as XTerm } from "@xterm/xterm";
import { normalizeLineEndings, wrapBracketedPaste } from "../../../lib/utils";
import {
  appendStartupRuleExpectBuffer,
  isStartupCommandRulesMode,
  STARTUP_RULE_EXPECT_TIMEOUT_MS,
  startupCommandRuleExpectMatches,
  usableStartupCommandRules,
} from "../../../domain/startupCommandRules";
import type { StartupCommandRule } from "../../../domain/models";
import { markPromptLineBreakCommandPending } from "./promptLineBreak";
import type { TerminalSessionStartersContext } from "./createTerminalSessionStarters.types";

const STARTUP_COMMAND_DEFAULT_DELAY_MS = 600;
const STARTUP_COMMAND_MAX_DELAY_MS = 10000;

/**
 * Split a (possibly multi-line) startup command into non-empty lines, dropping
 * blank/whitespace-only lines but preserving each line's content verbatim — so
 * a single-line command stays byte-identical to what the user typed (e.g. a
 * leading space for `HISTCONTROL=ignorespace` is kept). Trailing `\r` from
 * CRLF input is normalized away.
 */
export function splitStartupCommandLines(commandText: string): string[] {
  return String(commandText || "")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0);
}

/** Clamp a configured startup-command delay; fall back to the default when unset/invalid. */
export function normalizeStartupCommandDelay(raw: number | undefined): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : STARTUP_COMMAND_DEFAULT_DELAY_MS;
  return Math.max(0, Math.min(STARTUP_COMMAND_MAX_DELAY_MS, value));
}

const buildStartupPasteInput = (term: XTerm, commandText: string): string => {
  let data = normalizeLineEndings(commandText);
  if (data.includes("\n") && term.modes?.bracketedPasteMode && !term.options?.ignoreBracketedPasteMode) {
    data = wrapBracketedPaste(data);
  }
  return `${data}\r`;
};

export const resolveStartupCommand = (
  ctx: TerminalSessionStartersContext,
  options?: { consumeSuppressHostStartupCommand?: boolean },
): string | undefined => {
  const command = ctx.startupCommand || (ctx.suppressHostStartupCommandRef?.current ? undefined : ctx.host.startupCommand);
  if (options?.consumeSuppressHostStartupCommand && ctx.suppressHostStartupCommandRef) {
    ctx.suppressHostStartupCommandRef.current = false;
  }
  return command;
};

const readTerminalPlainText = (term: XTerm): string => {
  const buffer = term.buffer?.active;
  if (!buffer || typeof buffer.length !== "number") return "";
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i += 1) {
    const line = buffer.getLine?.(i);
    if (line?.translateToString) lines.push(line.translateToString(true));
  }
  return lines.join("\n");
};

const sendStartupRule = (
  ctx: TerminalSessionStartersContext,
  term: XTerm,
  sessionId: string,
  rule: StartupCommandRule,
): void => {
  const sensitive = rule.expect.trim().length > 0;
  ctx.terminalBackend.writeToSession(sessionId, `${rule.send}\r`, {
    automated: true,
    sensitive,
  });
  if (sensitive) return;
  markPromptLineBreakCommandPending(ctx.promptLineBreakStateRef, term, rule.send);
  ctx.onCommandExecuted?.(rule.send, ctx.host.id, ctx.host.label, ctx.sessionId);
};

export const scheduleStartupCommandRules = (
  ctx: TerminalSessionStartersContext,
  term: XTerm,
  id: string,
  rules: StartupCommandRule[],
  onSettled?: () => void,
  expectTimeoutMs = STARTUP_RULE_EXPECT_TIMEOUT_MS,
): (() => void) => {
  const scheduledSessionId = id;
  const settings = ctx.terminalSettingsRef?.current ?? ctx.terminalSettings;
  const delayMs = normalizeStartupCommandDelay(settings?.startupCommandDelayMs);
  const sessionIsCurrent = () =>
    !!ctx.sessionRef.current && ctx.sessionRef.current === scheduledSessionId;

  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeData: (() => void) | undefined;
  let index = 0;
  let allowTerminalSeed = true;

  const cleanupListen = () => {
    unsubscribeData?.();
    unsubscribeData = undefined;
  };

  const settle = () => {
    cleanupListen();
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    onSettled?.();
  };

  const cancel = () => {
    cancelled = true;
    settle();
  };

  const runStep = () => {
    if (cancelled) return;
    if (!sessionIsCurrent()) {
      settle();
      return;
    }
    if (index >= rules.length) {
      settle();
      return;
    }

    const rule = rules[index];
    const expect = rule.expect.trim();
    if (!expect) {
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        if (!sessionIsCurrent()) {
          settle();
          return;
        }
        sendStartupRule(ctx, term, ctx.sessionRef.current, rule);
        allowTerminalSeed = false;
        index += 1;
        runStep();
      }, delayMs);
      return;
    }

    let captured = allowTerminalSeed
      ? appendStartupRuleExpectBuffer("", readTerminalPlainText(term))
      : "";
    allowTerminalSeed = false;
    const tryMatch = () => {
      if (cancelled) return false;
      if (!startupCommandRuleExpectMatches(captured, expect)) return false;
      cleanupListen();
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      sendStartupRule(ctx, term, ctx.sessionRef.current, rule);
      captured = "";
      index += 1;
      runStep();
      return true;
    };

    if (tryMatch()) return;

    unsubscribeData = ctx.terminalBackend.onSessionData(scheduledSessionId, (data) => {
      if (cancelled) return;
      captured = appendStartupRuleExpectBuffer(captured, data);
      tryMatch();
    });
    timeoutId = setTimeout(() => {
      if (cancelled) return;
      console.error("[startupCommand] rule expect timed out", expect);
      settle();
    }, expectTimeoutMs);
  };

  runStep();
  return cancel;
};

export const scheduleStartupCommand = (
  ctx: TerminalSessionStartersContext,
  term: XTerm,
  id: string,
  onSettled?: () => void,
): (() => void) | undefined => {
  if (ctx.hasRunStartupCommandRef.current) return undefined;

  if (!ctx.startupCommand && isStartupCommandRulesMode(ctx.host.startupCommandRunMode)) {
    if (ctx.suppressHostStartupCommandRef?.current) {
      ctx.suppressHostStartupCommandRef.current = false;
      return undefined;
    }
    const rules = usableStartupCommandRules(ctx.host.startupCommandRules);
    if (rules.length === 0) return undefined;
    ctx.hasRunStartupCommandRef.current = true;
    return scheduleStartupCommandRules(ctx, term, id, rules, onSettled);
  }

  const commandToRun = resolveStartupCommand(ctx, { consumeSuppressHostStartupCommand: true });
  if (!commandToRun) return undefined;

  ctx.hasRunStartupCommandRef.current = true;
  const scheduledSessionId = id;
  const settings = ctx.terminalSettingsRef?.current ?? ctx.terminalSettings;
  const delayMs = normalizeStartupCommandDelay(settings?.startupCommandDelayMs);

  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const sessionIsCurrent = () =>
    !!ctx.sessionRef.current && ctx.sessionRef.current === scheduledSessionId;

  // noAutoRun (snippet "type but don't execute"): type the command as-is, no
  // Enter and no line-splitting — unchanged behavior.
  if (ctx.noAutoRun) {
    timeoutId = setTimeout(() => {
      if (cancelled) return;
      if (!sessionIsCurrent()) {
        onSettled?.();
        return;
      }
      ctx.terminalBackend.writeToSession(ctx.sessionRef.current, commandToRun, { automated: true });
      onSettled?.();
    }, delayMs);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }

  const lines = splitStartupCommandLines(commandToRun);
  if (lines.length === 0) {
    onSettled?.();
    return undefined;
  }

  const runMode = ctx.startupCommand
    ? (ctx.multiLineRunMode ?? "paste")
    : (ctx.host.startupCommandRunMode ?? "paste");
  if (runMode === "paste") {
    timeoutId = setTimeout(() => {
      if (cancelled) return;
      if (!sessionIsCurrent()) {
        onSettled?.();
        return;
      }
      ctx.terminalBackend.writeToSession(
        ctx.sessionRef.current,
        buildStartupPasteInput(term, commandToRun),
        { automated: true },
      );
      for (const line of lines) {
        markPromptLineBreakCommandPending(ctx.promptLineBreakStateRef, term, line);
        ctx.onCommandExecuted?.(line, ctx.host.id, ctx.host.label, ctx.sessionId);
      }
      onSettled?.();
    }, delayMs);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }

  // Line-by-line mode: wait before each line so prompt-driven sessions can
  // react between steps.
  let index = 0;
  const runNext = () => {
    if (cancelled) return;
    if (!sessionIsCurrent()) {
      onSettled?.();
      return;
    }
    const line = lines[index];
    ctx.terminalBackend.writeToSession(ctx.sessionRef.current, `${line}\r`, { automated: true });
    markPromptLineBreakCommandPending(ctx.promptLineBreakStateRef, term, line);
    ctx.onCommandExecuted?.(line, ctx.host.id, ctx.host.label, ctx.sessionId);
    index += 1;
    if (index < lines.length) {
      timeoutId = setTimeout(runNext, delayMs);
    } else {
      onSettled?.();
    }
  };

  timeoutId = setTimeout(runNext, delayMs);
  return () => {
    cancelled = true;
    if (timeoutId) clearTimeout(timeoutId);
  };
};
