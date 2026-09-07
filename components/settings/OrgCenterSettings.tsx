import React, { useCallback, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { formatOrgCenterError } from "../../application/i18n/formatOrgCenterError";
import { useI18n } from "../../application/i18n/I18nProvider";
import { useOrgCenterState } from "../../application/state/useOrgCenterState";
import { useVaultState } from "../../application/state/useVaultState";
import { toast } from "../ui/toast";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SectionHeader, SettingCard, SettingHint } from "./settings-ui";

function formatSyncedAt(timestamp: number | undefined, t: (key: string) => string): string {
  if (!timestamp) return t("settings.orgCenter.neverSynced");
  return t("settings.orgCenter.lastSynced", { time: new Date(timestamp).toLocaleString() });
}

export function OrgCenterSettings() {
  const { t } = useI18n();
  const vault = useVaultState();
  const { connections, syncingId, addConnection, removeConnection, syncConnection } = useOrgCenterState({
    hosts: vault.hosts,
    keys: vault.keys,
    customGroups: vault.customGroups,
    groupConfigs: vault.groupConfigs,
    updateHosts: vault.updateHosts,
    updateKeys: vault.updateKeys,
    updateCustomGroups: vault.updateCustomGroups,
    updateGroupConfigs: vault.updateGroupConfigs,
    autoSync: false,
    isInitialized: vault.isInitialized,
  });
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!url.trim() || !apiKey.trim() || adding || !vault.isInitialized) return;
    setAdding(true);
    try {
      const connection = await addConnection(url, apiKey);
      setUrl("");
      setApiKey("");
      toast.success(t("settings.orgCenter.added", { name: connection.name }));
    } catch (err) {
      toast.error(
        formatOrgCenterError(err instanceof Error ? err.message : "", t),
        t("settings.orgCenter.error.generic"),
      );
    } finally {
      setAdding(false);
    }
  }, [addConnection, adding, apiKey, t, url, vault.isInitialized]);

  const handleSync = useCallback(async (id: string) => {
    const connection = connections.find((item) => item.id === id);
    if (!connection) return;
    try {
      const updated = await syncConnection(connection);
      toast.success(t("settings.orgCenter.synced", { name: updated.name }));
    } catch (err) {
      toast.error(
        formatOrgCenterError(err instanceof Error ? err.message : "", t),
        t("settings.orgCenter.error.generic"),
      );
    }
  }, [connections, syncConnection, t]);

  const handleRemove = useCallback((id: string, name: string) => {
    if (!window.confirm(t("settings.orgCenter.removeConfirm", { name }))) return;
    removeConnection(id);
    toast.success(t("settings.orgCenter.removed", { name }));
  }, [removeConnection, t]);

  return (
    <>
      <SectionHeader title={t("settings.orgCenter.title")} anchorId="system-org-center" />
        <SettingCard className="space-y-4 py-4">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="org-center-url">
                {t("settings.orgCenter.url")}
              </label>
              <Input
                id="org-center-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("settings.orgCenter.urlPlaceholder")}
                spellCheck={false}
                autoComplete="off"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="org-center-api-key">
                {t("settings.orgCenter.apiKey")}
              </label>
              <Input
                id="org-center-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={t("settings.orgCenter.apiKeyPlaceholder")}
                spellCheck={false}
                autoComplete="off"
                className="h-9"
              />
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={adding || !url.trim() || !apiKey.trim() || !vault.isInitialized}
              onClick={() => void handleAdd()}
            >
              {adding ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              {adding ? t("settings.orgCenter.adding") : t("settings.orgCenter.add")}
            </Button>
          </div>

          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {t("settings.orgCenter.empty")}
            </p>
          ) : (
            <div className="space-y-2">
              {connections.map((connection) => {
                const busy = syncingId === connection.id;
                return (
                  <div
                    key={connection.id}
                    className="rounded-md border border-border/70 px-3 py-2.5 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{connection.name}</p>
                        <p className="text-xs text-muted-foreground font-mono truncate">{connection.url}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5"
                          disabled={busy || !vault.isInitialized}
                          onClick={() => void handleSync(connection.id)}
                        >
                          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
                          {busy ? t("settings.orgCenter.syncing") : t("settings.orgCenter.sync")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive"
                          disabled={busy}
                          onClick={() => handleRemove(connection.id, connection.name)}
                        >
                          <Trash2 size={13} />
                          {t("settings.orgCenter.remove")}
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatSyncedAt(connection.lastSyncedAt, t)}
                    </p>
                    {connection.lastError && (
                      <p className="text-xs text-destructive">
                        {formatOrgCenterError(connection.lastError, t)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SettingCard>
      <SettingHint>
        {t("settings.orgCenter.hint")}
      </SettingHint>
    </>
  );
}
