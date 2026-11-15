import { useEffect, useState, type ReactNode } from "react";
import { Events } from "@wailsio/runtime";
import { isDesktop } from "@/lib/backend";
import { dictationContexts } from "@/features/dictation/hooks/use-dictation-state";

export function AudioLevelProvider({ children }: { children: ReactNode }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!isDesktop) return;
    return Events.On("dictation:level", ({ data }: { data: number }) => setLevel(data));
  }, []);
  return (
    <dictationContexts.level.Provider value={level}>{children}</dictationContexts.level.Provider>
  );
}
