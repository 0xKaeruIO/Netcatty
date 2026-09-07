import { netcattyBridge } from "./netcattyBridge";
import type { OrgCatalog } from "../../domain/orgCenter";

export async function fetchOrgCenterHealth(
  url: string,
  skipTlsVerify?: boolean,
): Promise<{ ok: boolean; name: string; version: number }> {
  const bridge = netcattyBridge.get();
  if (!bridge?.orgCenterHealth) {
    throw new Error("Organization center bridge unavailable");
  }
  return bridge.orgCenterHealth(url, skipTlsVerify);
}

export async function fetchOrgCenterCatalog(
  url: string,
  apiKey: string,
  skipTlsVerify?: boolean,
): Promise<OrgCatalog> {
  const bridge = netcattyBridge.get();
  if (!bridge?.orgCenterFetchCatalog) {
    throw new Error("Organization center bridge unavailable");
  }
  return bridge.orgCenterFetchCatalog(url, apiKey, skipTlsVerify) as Promise<OrgCatalog>;
}
