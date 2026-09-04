import { Plus, Trash2 } from "lucide-react";
import React from "react";
import type { StartupCommandRule, StartupCommandRunMode } from "../../domain/models";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { HostDetailsSettingRow } from "./HostDetailsSection";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function StartupCommandFields({
  t,
  command,
  runMode,
  rules,
  inheritedCommand,
  inheritedRunMode,
  commandPlaceholder,
  onCommandChange,
  onRunModeChange,
  onRulesChange,
}: {
  t: Translate;
  command: string;
  runMode: StartupCommandRunMode;
  rules: StartupCommandRule[];
  inheritedCommand?: string;
  inheritedRunMode: StartupCommandRunMode;
  commandPlaceholder: string;
  onCommandChange: (value: string | undefined) => void;
  onRunModeChange: (value: StartupCommandRunMode | undefined) => void;
  onRulesChange: (rules: StartupCommandRule[] | undefined) => void;
}) {
  const isRules = runMode === "rules";

  const visibleRules = rules.length > 0 ? rules : [{ expect: "", send: "" }];

  const updateRule = (index: number, patch: Partial<StartupCommandRule>) => {
    const next = visibleRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    onRulesChange(next);
  };

  const addRule = () => {
    onRulesChange([...visibleRules, { expect: "", send: "" }]);
  };

  const removeRule = (index: number) => {
    const next = visibleRules.filter((_, i) => i !== index);
    onRulesChange(next);
  };

  return (
    <>
      <HostDetailsSettingRow
        label={t("hostDetails.startupCommand.runMode")}
        hint={t("hostDetails.startupCommand.runMode.help")}
      >
        <Select
          value={runMode}
          onValueChange={(value) => {
            const next = value as StartupCommandRunMode;
            onRunModeChange(next === inheritedRunMode ? undefined : next);
            if (next === "rules" && rules.length === 0) {
              onRulesChange([{ expect: "", send: "" }]);
            }
          }}
        >
          <SelectTrigger className="h-8 w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lineDelay">{t("hostDetails.startupCommand.runMode.lineDelay")}</SelectItem>
            <SelectItem value="paste">{t("hostDetails.startupCommand.runMode.paste")}</SelectItem>
            <SelectItem value="rules">{t("hostDetails.startupCommand.runMode.rules")}</SelectItem>
          </SelectContent>
        </Select>
      </HostDetailsSettingRow>

      {isRules ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("hostDetails.startupCommand.rules.help")}
          </p>
          {visibleRules.map((rule, index) => (
            <div
              key={index}
              className="space-y-2 rounded-lg border border-border/60 bg-secondary/40 p-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("hostDetails.startupCommand.rules.step", { n: index + 1 })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRule(index)}
                  aria-label={t("hostDetails.startupCommand.rules.remove")}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              <Input
                value={rule.expect}
                onChange={(e) => updateRule(index, { expect: e.target.value })}
                placeholder={t("hostDetails.startupCommand.rules.expect.placeholder")}
                className="h-8 font-mono text-sm"
              />
              <Input
                value={rule.send}
                onChange={(e) => updateRule(index, { send: e.target.value })}
                placeholder={t("hostDetails.startupCommand.rules.send.placeholder")}
                className="h-8 font-mono text-sm"
              />
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start gap-2 text-sm"
            onClick={addRule}
          >
            <Plus size={14} />
            {t("hostDetails.startupCommand.rules.add")}
          </Button>
        </div>
      ) : (
        <Textarea
          placeholder={inheritedCommand || commandPlaceholder}
          value={command}
          onChange={(e) => onCommandChange(e.target.value || undefined)}
          className="min-h-[80px] font-mono text-sm"
          rows={3}
        />
      )}
    </>
  );
}
