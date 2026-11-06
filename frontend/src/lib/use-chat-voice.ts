import { backend, isDesktop, message } from "@/lib/backend";
import { Events } from "@wailsio/runtime";
import { useCallback, useEffect, useRef, useState } from "react";

type VoiceResult = {
  sessionId: string;
  requestId: string;
  phase: string;
  text: string;
  error: string;
};

export function useChatVoice(sessionID: string, open: boolean, onText: (text: string) => void) {
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "transcribing">("idle");
  const [error, setError] = useState("");
  const current = useRef<string | null>(null);
  const receive = useRef(onText);
  receive.current = onText;
  const mounted = useRef(true);
  const cancelled = useRef(false);
  const finish = useCallback((id: string, text: string, error = "") => {
    if (current.current !== id || !mounted.current) return;
    current.current = null;
    setPhase("idle");
    if (cancelled.current) return;
    if (error) setError(error);
    else if (text.trim()) receive.current(text);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const off = isDesktop
      ? Events.On("chat:voice", ({ data }: { data: VoiceResult }) => {
          if (data.sessionId !== sessionID || data.requestId !== current.current) return;
          if (data.phase === "transcribing") setPhase("transcribing");
          else finish(data.requestId, data.text, data.phase === "cancelled" ? "" : data.error);
        })
      : () => {};
    return () => {
      mounted.current = false;
      off();
      const id = current.current;
      current.current = null;
      if (id) void backend.cancelTextProcessing(id).catch(() => {});
    };
  }, [sessionID, finish]);
  useEffect(() => {
    if (open || !current.current) return;
    cancelled.current = true;
    void backend.cancelTextProcessing(current.current).catch(() => {});
  }, [open]);
  async function start() {
    if (current.current) return;
    const id = crypto.randomUUID();
    current.current = id;
    cancelled.current = false;
    setError("");
    setPhase("starting");
    try {
      await backend.startChatVoice(id, sessionID);
      if (current.current === id && mounted.current) setPhase("recording");
    } catch (cause) {
      finish(id, "", message(cause));
    }
  }
  async function stop() {
    const id = current.current;
    if (!id || phase !== "recording") return;
    setPhase("transcribing");
    try {
      finish(id, await backend.stopChatVoice(id));
    } catch (cause) {
      finish(id, "", message(cause));
    }
  }
  async function cancel() {
    const id = current.current;
    if (!id) return;
    cancelled.current = true;
    setPhase("transcribing");
    try {
      await backend.cancelTextProcessing(id);
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    }
  }
  return { phase, error, start, stop, cancel, busy: phase !== "idle" };
}
