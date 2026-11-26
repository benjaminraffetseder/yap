import type {
  ContentEditorHandle,
  ContentEditorProps,
} from "@/features/editing/components/content-editor";
import { forwardRef, lazy, Suspense } from "react";

// Reading/recording does not load the document engines until editing begins.
const Editor = lazy(() =>
  import("@/features/editing/components/content-editor").then((module) => ({
    default: module.ContentEditor,
  })),
);

export type { ContentEditorHandle };
export const ContentEditor = forwardRef<ContentEditorHandle, ContentEditorProps>(
  function LazyContentEditor(props, ref) {
    return (
      <Suspense
        fallback={
          <div
            role="status"
            aria-label={props.label}
            className="min-h-80 rounded-lg border bg-muted/30"
          />
        }
      >
        <Editor {...props} ref={ref} />
      </Suspense>
    );
  },
);
