import React, { useCallback, useState } from "react";
import { RefreshCw, Settings } from "lucide-react";
import { formatOrgCenterError } from "../../application/i18n/formatOrgCenterError";
import { useI18n } from "../../application/i18n/I18nProvider";
import { useOrgCenterState } from "../../application/state/useOrgCenterState";
import type { Host, SSHKey } from "../../domain/models";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dropdown, DropdownContent, DropdownTrigger } from "../ui/dropdown";
import { toast } from "../ui/toast";
import { vaultHeaderSecondaryButtonClass } from "./VaultPageHeader";

export function VaultOrgCenterSyncMenu({
  hosts,
  keys,
  customGroups,
  onUpdateHosts,
  onUpdateKeys,
  onUpdateCustomGroups,
  onOpenSettings,
}: {
  hosts: Host[];
  keys: SSHKey[];
  customGroups: string[];
  onUpdateHosts: (hosts: Host[]) => unknown;
  onUpdateKeys: (keys: SSHKey[]) => void;
  onUpdateCustomGroups: (
    groups: string[] | ((current: string[]) => string[]),
  ) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { connections, syncingId, syncConnection } = useOrgCenterState({
    hosts,
    keys,
    customGroups,
    updateHosts: (data) => {
      void onUpdateHosts(typeof data === "function" ? data(hosts) : data);
    },
    updateKeys: (data) => {
      onUpdateKeys(typeof data === "function" ? data(keys) : data);
    },
    updateCustomGroups: onUpdateCustomGroups,
    autoSync: false,
  });

  const handleSync = useCallback(async (id: string) => {
    const connection = connections.find((item) => item.id === id);
    if (!connection || syncingId) return;
    setOpen(false);
    try {
      const updated = await syncConnection(connection);
      toast.success(t("settings.orgCenter.synced", { name: updated.name }));
    } catch (err) {
      toast.error(
        formatOrgCenterError(err instanceof Error ? err.message : "", t),
        t("settings.orgCenter.error.generic"),
      );
    }
  }, [connections, syncConnection, syncingId, t]);

  const busy = Boolean(syncingId);

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={vaultHeaderSecondaryButtonClass}
          aria-label={t("vault.hosts.orgCenterSync")}
        >
          <RefreshCw size={14} className={cn(busy && "animate-spin")} />
          {t("vault.hosts.orgCenterSync")}
        </Button>
      </DropdownTrigger>
      <DropdownContent className="w-56" align="end">
        {connections.length === 0 ? (
          <div className="px-1 py-1 space-y-1">
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
          connections.map((connection) => {
            const itemBusy = syncingId === connection.id;
            return (
              <Button
                key={connection.id}
                type="button"
                variant="ghost"
                className="w-full justify-start gap-2 h-auto py-2"
                disabled={busy}
                onClick={() => void handleSync(connection.id)}
              >
                <RefreshCw
                  size={14}
                  className={cn("shrink-0", itemBusy && "animate-spin")}
                />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">
                    {t("vault.hosts.orgCenterSyncFrom", { name: connection.name })}
                  </span>
                  {connection.lastError ? (
                    <span className="block truncate text-[11px] font-normal text-destructive/80">
                      {formatOrgCenterError(connection.lastError, t)}
                    </span>
                  ) : null}
                </span>
              </Button>
            );
          })
        )}
      </DropdownContent>
    </Dropdown>
  );
}
