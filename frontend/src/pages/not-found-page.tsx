import { buttonVariants } from "@/components/ui/button";
import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="space-y-4 py-16">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">There isn't a screen at this address yet.</p>
      <Link to="/" className={buttonVariants()}>
        Back to dictation
      </Link>
    </div>
  );
}
