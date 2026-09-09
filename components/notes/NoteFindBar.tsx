import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import React, { useCallback, useEffect, useRef } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export interface NoteFindBarProps {
  open: boolean;
  value: string;
  focusToken?: number;
  matchCount?: { current: number; total: number } | null;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
}

export const NoteFindBar: React.FC<NoteFindBarProps> = ({
  open,
  value,
  focusToken,
  matchCount,
  onValueChange,
  onClose,
  onFindNext,
  onFindPrevious,
}) => {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open, focusToken]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter" || event.key === "F3") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) onFindPrevious();
      else onFindNext();
    }
  }, [onClose, onFindNext, onFindPrevious]);

  if (!open) return null;

  const total = matchCount?.total ?? 0;
  const current = matchCount?.current ?? 0;

  return (
    <div
      data-note-find-bar="true"
      className="absolute right-2 top-2 z-30 flex items-center gap-1 rounded-md border border-border/70 bg-popover px-1.5 py-1 shadow-md"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="relative">
        <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          data-note-find-input="true"
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("notes.find.placeholder")}
          className="h-7 w-44 rounded bg-transparent pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <span
        data-note-find-count="true"
        className="min-w-[3.25rem] shrink-0 px-1 text-center text-[10px] text-muted-foreground"
      >
        {value
          ? total === 0
            ? t("notes.find.noResults")
            : t("notes.find.matchCount", { current: String(current), total: String(total) })
          : ""}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground disabled:opacity-30"
            onClick={onFindPrevious}
            disabled={!value || total === 0}
            tabIndex={-1}
          >
            <ChevronUp size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("notes.find.prevMatch")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground disabled:opacity-30"
            onClick={onFindNext}
            disabled={!value || total === 0}
            tabIndex={-1}
          >
            <ChevronDown size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("notes.find.nextMatch")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={onClose}
            tabIndex={-1}
          >
            <X size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("notes.find.close")}</TooltipContent>
      </Tooltip>
    </div>
  );
};
