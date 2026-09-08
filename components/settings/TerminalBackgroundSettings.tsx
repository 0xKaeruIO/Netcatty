import { memo, useCallback, useMemo, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

import { useI18n } from "../../application/i18n/I18nProvider";
import {
  TERMINAL_BACKGROUND_BLUR_MAX,
  TERMINAL_BACKGROUND_FIT_OPTIONS,
  TERMINAL_BACKGROUND_OPACITY_MAX,
  TERMINAL_BACKGROUND_OPACITY_MIN,
  TERMINAL_BACKGROUND_SCALE_MAX,
  TERMINAL_BACKGROUND_SCALE_MIN,
  resolveTerminalBackgroundLayerStyle,
  terminalBackgroundSupportsPosition,
  terminalBackgroundSupportsScale,
  type TerminalBackgroundImageSettings,
  type TerminalBackgroundPosition,
} from "../../domain/terminalBackgroundImage";
import {
  useTerminalBackgroundImagePicker,
  useTerminalBackgroundImageUrl,
} from "../../application/state/useTerminalBackgroundImage";
import { cn } from "../../lib/utils";
import { SectionHeader, SettingRow, SettingsAnchor, Select, Toggle } from "./settings-ui";

const POSITION_ROWS: TerminalBackgroundPosition[][] = [
  ["top-left", "top", "top-right"],
  ["left", "center", "right"],
  ["bottom-left", "bottom", "bottom-right"],
];

const sliderClassName = "w-28 accent-primary";
const sliderValueClassName = "text-sm text-muted-foreground w-12 text-right tabular-nums";

function PositionPicker({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: TerminalBackgroundPosition;
  disabled: boolean;
  onChange: (next: TerminalBackgroundPosition) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "grid grid-cols-3 gap-1 rounded-md border border-border bg-muted/40 p-1",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {POSITION_ROWS.flat().map((position) => (
        <button
          key={position}
          type="button"
          role="radio"
          aria-checked={value === position}
          aria-label={position}
          onClick={() => onChange(position)}
          className={cn(
            "h-5 w-5 rounded-sm border transition-colors",
            value === position
              ? "border-primary bg-primary"
              : "border-border/70 bg-background hover:border-foreground/40",
          )}
        />
      ))}
    </div>
  );
}

function TerminalBackgroundSettingsInner({
  settings,
  onChange,
}: {
  settings: TerminalBackgroundImageSettings;
  onChange: (next: TerminalBackgroundImageSettings) => void;
}) {
  const { t } = useI18n();
  const [pickError, setPickError] = useState<string | null>(null);
  const previewUrl = useTerminalBackgroundImageUrl(settings.imageId);
  const { isPicking, pickImage, clearImage } = useTerminalBackgroundImagePicker();

  const patch = useCallback(
    (changes: Partial<TerminalBackgroundImageSettings>) => onChange({ ...settings, ...changes }),
    [onChange, settings],
  );

  const handlePick = useCallback(async () => {
    setPickError(null);
    const result = await pickImage({
      dialogTitle: t("settings.appearance.terminalBackground.pick"),
      filterLabel: t("settings.appearance.terminalBackground.imageFilter"),
    });
    if (result.status === "cancelled") return;
    if (result.status === "error") {
      setPickError(result.error ?? t("settings.appearance.terminalBackground.importFailed"));
      return;
    }

    onChange({
      ...settings,
      enabled: true,
      imageId: result.image.id,
      fileName: result.image.fileName,
      naturalWidth: result.image.naturalWidth,
      naturalHeight: result.image.naturalHeight,
    });
  }, [onChange, pickImage, settings, t]);

  const handleRemove = useCallback(() => {
    setPickError(null);
    // Keep the user's opacity / fit / blur tuning so re-picking an image
    // restores the look they already dialed in.
    onChange({
      ...settings,
      enabled: false,
      imageId: null,
      fileName: "",
      naturalWidth: 0,
      naturalHeight: 0,
    });
    void clearImage();
  }, [clearImage, onChange, settings]);

  const fitOptions = useMemo(
    () => TERMINAL_BACKGROUND_FIT_OPTIONS.map((fit) => ({
      value: fit,
      label: t(`settings.appearance.terminalBackground.fit.${fit}`),
    })),
    [t],
  );

  const previewStyle = useMemo(() => {
    if (!previewUrl) return undefined;
    const { inset: _inset, ...style } = resolveTerminalBackgroundLayerStyle(settings, previewUrl);
    return style;
  }, [previewUrl, settings]);

  const hasImage = !!settings.imageId;
  const canConfigure = hasImage && settings.enabled;

  return (
    <>
      <SectionHeader title={t("settings.appearance.terminalBackground")} />
      <SettingsAnchor
        anchorId="appearance-terminal-background"
        className="space-y-0 divide-y divide-border rounded-lg border bg-card px-4"
      >
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {t("settings.appearance.terminalBackground.image")}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.appearance.terminalBackground.image.desc")}
            </div>
            {hasImage && (
              <div className="mt-1.5 truncate text-xs text-foreground/80" title={settings.fileName}>
                {settings.fileName}
                {settings.naturalWidth > 0 && settings.naturalHeight > 0
                  ? ` · ${settings.naturalWidth}×${settings.naturalHeight}`
                  : ""}
              </div>
            )}
            {pickError && (
              <div className="mt-1.5 text-xs text-destructive">{pickError}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="h-14 w-24 overflow-hidden rounded-md border border-border/70 bg-muted/40">
              {previewStyle && (
                <div className="h-full w-full" style={previewStyle} />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => { void handlePick(); }}
                disabled={isPicking}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium transition-colors hover:text-foreground disabled:opacity-50"
              >
                {isPicking
                  ? <Loader2 size={12} className="animate-spin" />
                  : <ImagePlus size={12} />}
                {hasImage
                  ? t("settings.appearance.terminalBackground.replace")
                  : t("settings.appearance.terminalBackground.choose")}
              </button>
              {hasImage && (
                <button
                  type="button"
                  onClick={handleRemove}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <Trash2 size={12} />
                  {t("settings.appearance.terminalBackground.remove")}
                </button>
              )}
            </div>
          </div>
        </div>

        <SettingRow
          label={t("settings.appearance.terminalBackground.enabled")}
          description={t("settings.appearance.terminalBackground.enabled.desc")}
        >
          <Toggle
            checked={settings.enabled}
            disabled={!hasImage}
            onChange={(enabled) => patch({ enabled })}
            ariaLabel={t("settings.appearance.terminalBackground.enabled")}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.appearance.terminalBackground.opacity")}
          description={t("settings.appearance.terminalBackground.opacity.desc")}
        >
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={Math.round(TERMINAL_BACKGROUND_OPACITY_MIN * 100)}
              max={Math.round(TERMINAL_BACKGROUND_OPACITY_MAX * 100)}
              step={1}
              disabled={!canConfigure}
              value={Math.round(settings.opacity * 100)}
              onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
              className={sliderClassName}
            />
            <span className={sliderValueClassName}>{Math.round(settings.opacity * 100)}%</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.appearance.terminalBackground.fit")}
          description={t("settings.appearance.terminalBackground.fit.desc")}
        >
          <Select
            value={settings.fit}
            options={fitOptions}
            disabled={!canConfigure}
            onChange={(fit) => patch({ fit: fit as TerminalBackgroundImageSettings["fit"] })}
            className="w-40"
          />
        </SettingRow>

        <SettingRow
          label={t("settings.appearance.terminalBackground.position")}
          description={t("settings.appearance.terminalBackground.position.desc")}
        >
          <PositionPicker
            value={settings.position}
            disabled={!canConfigure || !terminalBackgroundSupportsPosition(settings.fit)}
            onChange={(position) => patch({ position })}
            ariaLabel={t("settings.appearance.terminalBackground.position")}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.appearance.terminalBackground.scale")}
          description={t("settings.appearance.terminalBackground.scale.desc")}
        >
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={Math.round(TERMINAL_BACKGROUND_SCALE_MIN * 100)}
              max={Math.round(TERMINAL_BACKGROUND_SCALE_MAX * 100)}
              step={5}
              disabled={!canConfigure || !terminalBackgroundSupportsScale(settings.fit)}
              value={Math.round(settings.scale * 100)}
              onChange={(e) => patch({ scale: Number(e.target.value) / 100 })}
              className={sliderClassName}
            />
            <span className={sliderValueClassName}>{Math.round(settings.scale * 100)}%</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.appearance.terminalBackground.blur")}
          description={t("settings.appearance.terminalBackground.blur.desc")}
        >
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={TERMINAL_BACKGROUND_BLUR_MAX}
              step={1}
              disabled={!canConfigure}
              value={settings.blur}
              onChange={(e) => patch({ blur: Number(e.target.value) })}
              className={sliderClassName}
            />
            <span className={sliderValueClassName}>{settings.blur}px</span>
          </div>
        </SettingRow>
      </SettingsAnchor>
    </>
  );
}

export const TerminalBackgroundSettings = memo(TerminalBackgroundSettingsInner);
