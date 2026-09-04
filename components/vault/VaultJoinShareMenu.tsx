import React, { useCallback, useMemo, useState } from "react";
import { Link2, Settings } from "lucide-react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { useOrgCenterConnections } from "../../application/state/useOrgCenterConnections";
import { Button } from "../ui/button";
import { Dropdown, DropdownContent, DropdownTrigger } from "../ui/dropdown";
import { Input } from "../ui/input";
import { toast } from "../ui/toast";
import { vaultHeaderSecondaryButtonClass } from "./VaultPageHeader";

export function VaultJoinShareMenu({
  onJoinShare,
  onOpenSettings,
}: {
  onJoinShare?: (centerId: string, pin: string) => Promise<void> | void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const connections = useOrgCenterConnections();
  const [open, setOpen] = useState(false);
  const [centerId, setCenterId] = useState("");
  const [pin, setPin] = useState("");
  const [joining, setJoining] = useState(false);

  const selected = useMemo(
    () => connections.find((item) => item.id === centerId) ?? connections[0] ?? null,
    [centerId, connections],
  );

  const handleJoin = useCallback(async () => {
    if (!selected) {
      onOpenSettings();
      setOpen(false);
      return;
    }
    const nextPin = pin.replace(/\D/g, "").slice(0, 6);
    if (nextPin.length !== 6) {
      toast.error(t("vault.hosts.joinSharePinInvalid"));
      return;
    }
    setJoining(true);
    try {
      await onJoinShare?.(selected.id, nextPin);
      setPin("");
      setOpen(false);
    } catch (err) {
      console.error("[orgCenterShare] join share failed", err);
    } finally {
      setJoining(false);
    }
  }, [onJoinShare, onOpenSettings, pin, selected, t]);

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={vaultHeaderSecondaryButtonClass}
          aria-label={t("vault.hosts.joinShare")}
        >
          <Link2 size={14} />
          {t("vault.hosts.joinShare")}
        </Button>
      </DropdownTrigger>
      <DropdownContent className="w-64 p-2" align="end">
        {connections.length === 0 ? (
          <div className="space-y-1">
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("vault.hosts.orgCenterEmpty")}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Settings size={14} />
              {t("vault.hosts.orgCenterOpenSettings")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="space-y-1">
              {connections.map((connection) => (
                <Button
                  key={connection.id}
                  type="button"
                  variant="ghost"
                  className="w-full justify-start h-auto py-1.5"
                  onClick={() => setCenterId(connection.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {(selected?.id === connection.id ? "● " : "○ ") + connection.name}
                  </span>
                </Button>
              ))}
            </div>
            <Input
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder={t("vault.hosts.joinSharePin")}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleJoin();
                }
              }}
            />
            <Button
              type="button"
              className="w-full"
              disabled={joining || pin.length !== 6}
              onClick={() => void handleJoin()}
            >
              {t("vault.hosts.joinShareSubmit")}
            </Button>
          </div>
        )}
      </DropdownContent>
    </Dropdown>
  );
}
