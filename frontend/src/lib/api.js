export async function importRecording(file) {
    if (!file.name.toLowerCase().endsWith(".csv"))
        throw new Error("Choose a CSV file.");
    if (file.size > 10 * 1024 * 1024)
        throw new Error("Maximum file size is 10 MB.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
        const health = await fetch("/api/health/", { signal: controller.signal, cache: "no-store" });
        if (!health.ok)
            throw new Error("Backend unavailable. Restart the launcher.");
        const { csrf_token } = await health.json();
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/recordings/import/", {
            method: "POST", body, headers: { "X-CSRFToken": csrf_token }, signal: controller.signal,
        });
        const data = await response.json().catch(() => ({ error: `Import failed (${response.status}).` }));
        if (!response.ok)
            throw new Error(data.error);
        return data;
    }
    catch (error) {
        if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError")) {
            throw new Error("Backend unavailable. Restart the launcher.");
        }
        throw error;
    }
    finally {
        window.clearTimeout(timeout);
    }
}
