import { useEffect, useRef, useState } from "react";
import { controlTracker, getTrackerPackets } from "../lib/tracker-api.js";

export default function useTracker() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const commandVersion = useRef(0);
  const commandLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer;

    async function poll() {
      const version = commandVersion.current;

      try {
        const data = await getTrackerPackets(controller.signal);
        if (!controller.signal.aborted && version === commandVersion.current) {
          setSnapshot(data);
          setError("");
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, 1500);
      }
    }

    poll();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  async function command(action, body) {
    if (commandLock.current) return;

    commandLock.current = true;
    commandVersion.current += 1;
    setBusy(true);

    try {
      const data = await controlTracker(action, body);
      commandVersion.current += 1;
      setSnapshot((previous) => ({ ...previous, receiver: data.receiver }));
      setError("");
    } finally {
      commandLock.current = false;
      setBusy(false);
    }
  }

  return { snapshot, error, busy, command };
}
