import { backend } from "@/lib/backend";
import { QueryClient, queryOptions } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        staleTime: Infinity,
        gcTime: 30 * 60 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
}

export const resourceKeys = {
  all: ["resources"] as const,
  configuration: ["saved", "configuration"] as const,
  vocabulary: ["saved", "vocabulary"] as const,
  catalogs: ["saved", "catalogs"] as const,
  history: ["resources", "history"] as const,
  recentHistory: ["resources", "history", "recent"] as const,
  session: (id: string) => ["resources", "session", id] as const,
  outputs: (id: string) => ["resources", "outputs", id] as const,
  chat: (id: string) => ["resources", "chat", id] as const,
  home: ["resources", "home"] as const,
};

export const sessionQuery = (id: string) =>
  queryOptions({
    queryKey: resourceKeys.session(id),
    queryFn: ({ signal }) => {
      // Consume the signal so Query discards obsolete bridge replies. Wails
      // calls themselves keep running; inference cancellation has its own owner.
      signal.throwIfAborted();
      return backend.session(id);
    },
  });

export const recentHistoryQuery = queryOptions({
  queryKey: resourceKeys.recentHistory,
  queryFn: async ({ signal }) => {
    // A discarded StrictMode observer must not start an uncancellable bridge
    // call before the replacement observer owns the query.
    await Promise.resolve();
    signal.throwIfAborted();
    return backend.recentHistory();
  },
});

export const outputsQuery = (id: string) =>
  queryOptions({
    queryKey: resourceKeys.outputs(id),
    queryFn: ({ signal }) => {
      signal.throwIfAborted();
      return backend.generatedOutputs(id);
    },
  });

export const chatQuery = (id: string) =>
  queryOptions({
    queryKey: resourceKeys.chat(id),
    queryFn: ({ signal }) => {
      signal.throwIfAborted();
      return backend.chat(id);
    },
  });

export const homeResultQuery = queryOptions({
  queryKey: resourceKeys.home,
  queryFn: ({ signal }) => {
    signal.throwIfAborted();
    return backend.homeResult();
  },
  // A temporary result may expire while Home is unmounted. Always read its
  // current identity when returning, including after an in-flight old read.
  staleTime: Infinity,
  refetchOnMount: "always",
  gcTime: 0,
});

export const configurationQuery = queryOptions({
  queryKey: resourceKeys.configuration,
  queryFn: ({ signal }) => {
    signal.throwIfAborted();
    return backend.configuration();
  },
});
export const vocabularyQuery = queryOptions({
  queryKey: resourceKeys.vocabulary,
  queryFn: ({ signal }) => {
    signal.throwIfAborted();
    return backend.savedVocabulary();
  },
});
export const modelCatalogQuery = queryOptions({
  queryKey: resourceKeys.catalogs,
  queryFn: ({ signal }) => {
    signal.throwIfAborted();
    return backend.modelCatalog();
  },
});
export type SavedResource = "configuration" | "vocabulary" | "catalogs";
export const savedResources: SavedResource[] = ["configuration", "vocabulary", "catalogs"];

export async function refreshSaved(client: QueryClient, resources = savedResources) {
  // Always cancel first, including initial reads. An event or a settled write
  // supersedes every earlier reply; bridge cancellation is cache cancellation.
  await Promise.all(
    resources.map((resource) => client.cancelQueries({ queryKey: resourceKeys[resource] })),
  );
  await Promise.all(
    resources.map((resource) =>
      client.invalidateQueries({ queryKey: resourceKeys[resource] }, { throwOnError: true }),
    ),
  );
}
