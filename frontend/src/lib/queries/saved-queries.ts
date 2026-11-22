import { backend, isDesktop } from "@/lib/backend";
import {
  configurationQuery,
  modelCatalogQuery,
  refreshSaved,
  resourceKeys,
  vocabularyQuery,
  type SavedResource,
} from "@/lib/queries/resource-queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

export const useConfiguration = () => useQuery({ ...configurationQuery, enabled: isDesktop });
export const useVocabulary = () => useQuery({ ...vocabularyQuery, enabled: isDesktop });
export const useModelCatalog = () => useQuery({ ...modelCatalogQuery, enabled: isDesktop });

// Only draft editors need to distinguish identical successful reads. Query's
// success counter advances even for structurally shared data in the same millisecond.
export function useSavedReadVersion(domain: "configuration" | "vocabulary") {
  const client = useQueryClient();
  const key = resourceKeys[domain];
  const subscribe = useCallback(
    (notify: () => void) =>
      client.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "success" &&
          event.query.queryKey[0] === key[0] &&
          event.query.queryKey[1] === key[1]
        )
          notify();
      }),
    [client, key],
  );
  return useSyncExternalStore(subscribe, () => client.getQueryState(key)?.dataUpdateCount ?? 0);
}

function useSavedMutation<Args extends unknown[], Result>(
  write: (...args: Args) => Promise<Result>,
  domains: SavedResource[],
) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ args }: { args: Args; readBoundary?: number }) => write(...args),
    onMutate: async () => {
      await Promise.all(
        domains.map((domain) => client.cancelQueries({ queryKey: resourceKeys[domain] })),
      );
    },
    // Mutation responses are receipts, never cached baselines. Read current native
    // data even after errors (a write may have partially persisted).
    onSettled: (_result, _error, attempt) => {
      if (!isDesktop) return;
      // Single-resource draft writers can identify reads started after the RPC.
      // refreshSaved synchronously cancels older requests before invalidation.
      if (domains.length === 1)
        attempt.readBoundary = client.getQueryState(resourceKeys[domains[0]])?.dataUpdateCount ?? 0;
      return refreshSaved(client, domains).catch(() => {
        // Query retains the read error for explicit recovery.
      });
    },
  });
  const mutateAsync = mutation.mutateAsync;
  return useCallback(
    (...args: Args) => {
      const attempt: { args: Args; readBoundary?: number } = { args };
      return Object.assign(mutateAsync(attempt), { savedReadBoundary: () => attempt.readBoundary });
    },
    [mutateAsync],
  );
}

// Only persisted resources use this small set of mutation boundaries. Progress,
// cancellation, recording and generation retain their existing request owners.
export function useSavedActions() {
  return {
    settings: useSavedMutation(backend.settings, ["configuration"]),
    textProcessing: useSavedMutation(backend.textProcessing, ["configuration"]),
    saveProfile: useSavedMutation(backend.saveProfile, ["configuration"]),
    applyProfile: useSavedMutation(backend.applyProfile, ["configuration"]),
    deleteProfile: useSavedMutation(backend.deleteProfile, ["configuration"]),
    saveProfileAutomation: useSavedMutation(backend.saveProfileAutomation, ["configuration"]),
    setSaveHistory: useSavedMutation(backend.setSaveHistory, ["configuration"]),
    vocabulary: useSavedMutation(backend.vocabulary, ["vocabulary"]),
    addVocabularyTerm: useSavedMutation(backend.addVocabularyTerm, ["vocabulary"]),
    install: useSavedMutation(backend.install, ["configuration", "catalogs"]),
    updateModelRuntime: useSavedMutation(backend.updateModelRuntime, ["configuration", "catalogs"]),
    removeModel: useSavedMutation(backend.removeModel, ["catalogs"]),
    installTextModel: useSavedMutation(backend.installTextModel, ["catalogs"]),
    updateTextRuntime: useSavedMutation(backend.updateTextRuntime, ["catalogs"]),
    removeTextModel: useSavedMutation(backend.removeTextModel, ["catalogs"]),
    completeSetup: useSavedMutation(backend.completeSetup, ["configuration"]),
    completeOnboarding: useSavedMutation(backend.completeOnboarding, ["configuration"]),
    restartSetup: useSavedMutation(backend.restartSetup, ["configuration"]),
    restoreBackup: useSavedMutation(backend.restoreBackup, [
      "configuration",
      "vocabulary",
      "catalogs",
    ]),
  };
}
