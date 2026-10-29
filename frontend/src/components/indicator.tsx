import { Button } from "@/components/ui/button";
import { Events } from "@wailsio/runtime";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

type Frame = {
  revision: number;
  phase: string;
  label: string;
  primary: string;
  secondary: string;
  level: number;
  dark: boolean;
};

const emptyFrame: Frame = {
  revision: 0,
  phase: "idle",
  label: "",
  primary: "",
  secondary: "",
  level: 0,
  dark: true,
};

function emit(name: string, data?: unknown) {
  return Events.Emit(name, data).catch(() => {});
}

type DragState = {
  pointer?: number;
  pendingMove: number;
  id: number;
  x: number;
  y: number;
  queue: Promise<unknown>;
};

function sendDrag(state: DragState, action: string) {
  const data = { action, id: state.id, x: state.x, y: state.y };
  state.queue = state.queue.then(() => emit("indicator:drag", data));
}

// Wails' native Windows move loop sets focus. Pointer dragging leaves keyboard
// input in the dictation target and uses the backend's physical cursor position.
function useIndicatorDrag() {
  const drag = useRef<DragState>({
    pendingMove: 0,
    id: Date.now(),
    x: 0,
    y: 0,
    queue: Promise.resolve(),
  });
  const finish = useCallback(() => {
    const state = drag.current;
    if (state.pointer === undefined) return;
    if (state.pendingMove) {
      cancelAnimationFrame(state.pendingMove);
      state.pendingMove = 0;
      sendDrag(state, "move");
    }
    state.pointer = undefined;
    sendDrag(state, "end");
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", finish);
    return () => {
      window.removeEventListener("pagehide", finish);
      finish();
    };
  }, [finish]);

  function finishPointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerId === drag.current.pointer) finish();
  }

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const state = drag.current;
      if (
        event.button !== 0 ||
        state.pointer !== undefined ||
        (event.target as Element).closest("button")
      )
        return;
      event.preventDefault();
      state.pointer = event.pointerId;
      state.id++;
      state.x = event.clientX / window.innerWidth;
      state.y = event.clientY / window.innerHeight;
      event.currentTarget.setPointerCapture(state.pointer);
      sendDrag(state, "start");
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const state = drag.current;
      if (event.pointerId !== state.pointer || state.pendingMove) return;
      state.pendingMove = requestAnimationFrame(() => {
        state.pendingMove = 0;
        sendDrag(state, "move");
      });
    },
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onLostPointerCapture: finishPointer,
  };
}

function IndicatorMeter() {
  return (
    <div className="meter" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

export function Indicator() {
  const [frame, setFrame] = useState(emptyFrame);
  const drag = useIndicatorDrag();

  useEffect(() => {
    const unsubscribe = Events.On("indicator:frame", ({ data }) => {
      const next = data as Frame;
      setFrame((current) => (next.revision < current.revision ? current : next));
    });
    // Subscribe before announcing readiness, including after reloads or remounts.
    void emit("indicator:ready");
    return unsubscribe;
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", frame.dark);
    document.documentElement.dataset.theme = frame.dark ? "dark" : "light";
  }, [frame.dark]);

  const level = Number.isFinite(frame.level) ? Math.max(0, Math.min(1, frame.level)) : 0;
  return (
    <main
      id="indicator"
      data-phase={frame.phase}
      aria-label="Dictation status"
      style={{ "--level": level } as CSSProperties}
      {...drag}
    >
      <IndicatorMeter />
      <span id="label" title={frame.label}>
        {frame.label}
      </span>
      {(
        [
          ["primary", frame.primary],
          ["secondary", frame.secondary],
        ] as const
      ).map(
        ([action, label]) =>
          label && (
            <Button
              key={action}
              id={action}
              variant="secondary"
              size="xs"
              className="indicator-action font-normal"
              // Clicking controls must leave keyboard focus in the dictation target.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void emit("indicator:action", { action, revision: frame.revision })}
            >
              {label}
            </Button>
          ),
      )}
    </main>
  );
}
