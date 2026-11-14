import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend, isDesktop } from "@/lib/backend";
import {
  configurationQuery,
  vocabularyQuery,
  modelCatalogQuery,
  refreshSaved,
  resourceKeys,
  type SavedResource,
} from "@/lib/resource-queries";

export const useConfiguration = () => useQuery({ ...configurationQuery, enabled: isDesktop });
export const useVocabulary = () => useQuery({ ...vocabularyQuery, enabled: isDesktop });
export const useModelCatalog = () => useQuery({ ...modelCatalogQuery, enabled: isDesktop });

function useSavedMutation<Args extends unknown[], Result>(
  write: (...args: Args) => Promise<Result>,
  domains: SavedResource[],
) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (args: Args) => write(...args),
    onMutate: async () => {
      await Promise.all(
        domains.map((domain) => client.cancelQueries({ queryKey: resourceKeys[domain] })),
      );
    },
    // Mutation responses are receipts, never cached baselines. Read current native
    // data even after errors (a write may have partially persisted).
    onSettled: () =>
      isDesktop
        ? refreshSaved(client, domains).catch(() => {
            // Query retains the read error for explicit recovery. A successful native
            // write remains a success receipt, so recovery cannot repeat its effects.
          })
        : undefined,
  });
  const mutateAsync = mutation.mutateAsync;
  return useCallback((...args: Args) => mutateAsync(args), [mutateAsync]);
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
    removeModel: useSavedMutation(backend.removeModel, ["catalogs"]),
    installTextModel: useSavedMutation(backend.installTextModel, ["catalogs"]),
    removeTextModel: useSavedMutation(backend.removeTextModel, ["catalogs"]),
    completeSetup: useSavedMutation(backend.completeSetup, ["configuration"]),
    restartSetup: useSavedMutation(backend.restartSetup, ["configuration"]),
    restoreBackup: useSavedMutation(backend.restoreBackup, [
      "configuration",
      "vocabulary",
      "catalogs",
    ]),
  };
}
