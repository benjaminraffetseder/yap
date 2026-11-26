import { createRoot } from "react-dom/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../src/components/ui/dialog";
import { TranscriptDiff } from "../src/features/transcripts/components/transcript-diff";

export function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const before = "Original paragraph with a detailed explanation. ".repeat(300);
  const after = "A concise replacement.";
  createRoot(container).render(
    <Dialog open>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Diff fixture</DialogTitle>
          <DialogDescription>Review a long change.</DialogDescription>
        </DialogHeader>
        <TranscriptDiff before={before} after={after} />
      </DialogContent>
    </Dialog>,
  );
}
