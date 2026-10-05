"use client";

import type { ModpackCategory } from "@hubmine/shared";
import { useQuery } from "@tanstack/react-query";
import { getWorldCreationApi } from "../api";

export function useVersions() {
  return useQuery({
    queryKey: ["catalog", "versions"],
    queryFn: ({ signal }) => getWorldCreationApi().listVersions(signal),
  });
}

export function useSoftware(version: string | null) {
  return useQuery({
    queryKey: ["catalog", "software", version],
    queryFn: ({ signal }) => getWorldCreationApi().listSoftware(version!, signal),
    enabled: Boolean(version),
  });
}

export function useModpacks(version: string | null, category: ModpackCategory) {
  return useQuery({
    queryKey: ["catalog", "modpacks", version, category],
    queryFn: ({ signal }) => getWorldCreationApi().listModpacks({ version: version!, category }, signal),
    enabled: Boolean(version),
  });
}
