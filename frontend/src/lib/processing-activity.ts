import { importPending, type Snapshot, type Status } from "@/lib/backend";

// Queue jobs already describe their active operation; don't count it twice.
export function processingActivity<CurrentStatus extends Pick<Status, "phase" | "importId">>(
  snapshot: Pick<Snapshot, "importQueue" | "bulkTextQueue"> & { status: CurrentStatus },
) {
  const imports = snapshot.importQueue ?? [];
  const textJobs = snapshot.bulkTextQueue ?? [];
  const current =
    !snapshot.status.importId &&
    !textJobs.some((job) => job.state === "running") &&
    [
      "transcribing",
      "text-processing",
      "downloading",
      "backup",
      "diagnostic-transcribing",
    ].includes(snapshot.status.phase)
      ? snapshot.status
      : null;
  return {
    current,
    pending:
      imports.filter(importPending).length +
      textJobs.filter((job) => ["queued", "running"].includes(job.state)).length +
      (current ? 1 : 0),
    failed:
      imports.filter((job) => job.state === "failed").length +
      textJobs.filter((job) => job.state === "failed").length,
    hasActivity: !!(imports.length || textJobs.length || current),
  };
}
