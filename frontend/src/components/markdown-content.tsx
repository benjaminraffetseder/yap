import { cn } from "@/lib/utils";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

export function MarkdownContent({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("markdown-content min-w-0 text-sm leading-7", className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components} disallowedElements={["img"]}>
        {children}
      </Markdown>
    </div>
  );
}
