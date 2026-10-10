export async function raceRequest(path = "", body, signal) {
  const options = {
    cache: "no-store",
    signal: signal || AbortSignal.timeout(30000),
  };
  if (body !== undefined) {
    const health = await fetch("/api/health/", options);
    if (!health.ok)
      throw new Error("Backend unavailable. Restart the launcher.");
    const { csrf_token } = await health.json();
    options.method = "POST";
    options.headers = { "X-CSRFToken": csrf_token };
    if (body instanceof FormData) options.body = body;
    else {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
  }
  const response = await fetch(`/api/racing/${path}`, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.needsConfirmation = data.needs_confirmation;
    throw error;
  }
  return data;
}

export async function raceDownload(path, name) {
  const response = await fetch(`/api/racing/${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Download failed. Please try again.");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const miles = (m) => (m == null ? "—" : (m / 1609.344).toFixed(2));
export const clock = (s) =>
  s == null
    ? "—"
    : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
