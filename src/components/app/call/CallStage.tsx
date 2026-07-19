import { useCallback, useReducer } from "react";
import type { CallStage } from "./types";

type Action =
  | { type: "REQUEST_START" }
  | { type: "CONNECTED" }
  | { type: "REQUEST_END" }
  | { type: "ENDED" }
  | { type: "PROCESSING_COMPLETE" }
  | { type: "RESET" }
  | { type: "FAIL" };

interface State {
  stage: CallStage;
  startedAt: number | null;
  endedAt: number | null;
  /** Ref-style latch to block duplicate Start clicks while connect is in flight. */
  connectInFlight: boolean;
}

const INITIAL: State = {
  stage: "preflight",
  startedAt: null,
  endedAt: null,
  connectInFlight: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "REQUEST_START":
      if (state.connectInFlight || (state.stage !== "preflight" && state.stage !== "done")) {
        return state;
      }
      return { ...state, stage: "connecting", connectInFlight: true };
    case "CONNECTED":
      if (state.stage !== "connecting") return state;
      return {
        ...state,
        stage: "live",
        connectInFlight: false,
        startedAt: state.startedAt ?? Date.now(),
      };
    case "REQUEST_END":
      if (state.stage !== "live" && state.stage !== "connecting") return state;
      return { ...state, stage: "ending" };
    case "ENDED":
      return { ...state, stage: "processing", endedAt: Date.now(), connectInFlight: false };
    case "PROCESSING_COMPLETE":
      if (state.stage !== "processing") return state;
      return { ...state, stage: "done" };
    case "FAIL":
      return { ...state, stage: "preflight", connectInFlight: false };
    case "RESET":
      return { ...INITIAL };
    default:
      return state;
  }
}

/**
 * Deterministic call-stage state machine.
 * Blocks duplicate Start clicks via the `connectInFlight` latch.
 */
export function useCallStage() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const requestStart = useCallback(() => dispatch({ type: "REQUEST_START" }), []);
  const markConnected = useCallback(() => dispatch({ type: "CONNECTED" }), []);
  const requestEnd = useCallback(() => dispatch({ type: "REQUEST_END" }), []);
  const markEnded = useCallback(() => dispatch({ type: "ENDED" }), []);
  const markProcessingComplete = useCallback(() => dispatch({ type: "PROCESSING_COMPLETE" }), []);
  const fail = useCallback(() => dispatch({ type: "FAIL" }), []);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return {
    ...state,
    requestStart,
    markConnected,
    requestEnd,
    markEnded,
    markProcessingComplete,
    fail,
    reset,
  };
}
