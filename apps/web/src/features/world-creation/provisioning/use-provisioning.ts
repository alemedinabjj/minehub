"use client";

import { useEffect, useMemo, useState } from "react";
import { getWorldCreationApi } from "../api";
import { deriveProvisioningView, type ProvisioningSnapshot } from "./derive-stages";
import { PollingUpdatesSource, type ProvisioningUpdatesSource } from "./updates-source";

let source: ProvisioningUpdatesSource | null = null;
const getSource = () => (source ??= new PollingUpdatesSource(getWorldCreationApi()));

const EMPTY: ProvisioningSnapshot = { server: null, operation: null, events: [] };

export function useProvisioning(target: { serverId: string; operationId: string } | null) {
  const key = target ? `${target.serverId}:${target.operationId}` : null;
  // State is tagged with the subscription key so a new operation never shows stale data.
  const [state, setState] = useState<{ key: string | null; snapshot: ProvisioningSnapshot; error: unknown }>({
    key: null,
    snapshot: EMPTY,
    error: null,
  });

  useEffect(() => {
    if (!key || !target) return;
    return getSource().subscribe(
      target,
      (snapshot) => setState({ key, snapshot, error: null }),
      (error) => setState((s) => ({ ...s, key, error })),
    );
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` identifies `target`

  const snapshot = state.key === key ? state.snapshot : EMPTY;
  const view = useMemo(() => deriveProvisioningView(snapshot), [snapshot]);
  return { snapshot, view, connectionError: state.key === key ? state.error : null };
}
