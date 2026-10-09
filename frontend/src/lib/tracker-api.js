async function request(path, { method = "GET", body, signal, csrfToken } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = window.setTimeout(abort, 10000);

  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers:
        body === undefined
          ? undefined
          : {
              "Content-Type": "application/json",
              "X-CSRFToken": csrfToken,
            },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error(
        data?.error || `Backend request failed (${response.status}).`,
      );
    }

    return data;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.name === "AbortError" || error instanceof TypeError) {
      throw new Error(
        "Backend unavailable. Check that the launcher is running.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function getTrackerPackets(signal) {
  return request("/api/tracker/packets/", { signal });
}

export function getTrackerPorts(signal) {
  return request("/api/tracker/ports/", { signal });
}

export async function controlTracker(action, body = {}) {
  const { csrf_token } = await request("/api/health/");

  return request(`/api/tracker/${action}/`, {
    method: "POST",
    body,
    csrfToken: csrf_token,
  });
}

export function getTrackerSessions(before, signal) {
  const query = before ? `?before=${before}` : "";
  return request(`/api/tracker/sessions/${query}`, { signal });
}

export async function downloadTrackerSession(id) {
  const response = await fetch(`/api/tracker/sessions/${id}/download/`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Could not download this session.");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `xc-session-${id}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function deleteTrackerSession(id) {
  const { csrf_token } = await request("/api/health/");
  return request(`/api/tracker/sessions/${id}/delete/`, {
    method: "POST",
    body: {},
    csrfToken: csrf_token,
  });
}
