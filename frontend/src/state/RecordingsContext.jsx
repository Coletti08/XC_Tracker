import { createContext, useContext, useEffect, useRef, useState } from "react";
import { SAMPLE_RECORDING } from "../data/sample-recording.js";
import { importRecording } from "../lib/api.js";
import { deleteRecording, loadRecordings, saveRecording } from "../lib/storage.js";
const MAX_IMPORTS = 8;
const Context = createContext(null);
export function RecordingsProvider({ children }) {
    const [imports, setImports] = useState([]);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState([]);
    const lock = useRef(false);
    useEffect(() => {
        let active = true;
        loadRecordings().then((saved) => {
            if (active)
                setImports(saved.filter((recording) => recording.id !== SAMPLE_RECORDING.id && !recording.demo));
        }).catch(() => {
            if (active)
                setErrors(["Saved recordings could not be loaded. Browser storage may be unavailable."]);
        }).finally(() => { if (active)
            setReady(true); });
        return () => { active = false; };
    }, []);
    async function importFiles(files) {
        if (!ready || lock.current || !files.length)
            return;
        lock.current = true;
        setBusy(true);
        setErrors([]);
        const added = [];
        const failures = [];
        const capacity = Math.max(0, MAX_IMPORTS - imports.length);
        if (files.length > capacity)
            failures.push(`Maximum ${MAX_IMPORTS} imported recordings. Remove a recording to add more.`);
        try {
            for (const file of files.slice(0, capacity)) {
                try {
                    const data = await importRecording(file);
                    const name = /^location\.csv$/i.test(file.name) ? `Recording ${imports.length + added.length + 1}` : file.name.replace(/\.csv$/i, "");
                    const recording = { ...data, id: crypto.randomUUID(), name, demo: false };
                    try {
                        await saveRecording(recording);
                    }
                    catch {
                        throw new Error("Could not save this recording. Browser storage may be full or unavailable.");
                    }
                    added.push(recording);
                }
                catch (error) {
                    failures.push(`${file.name}: ${error instanceof Error ? error.message : "Import failed."}`);
                }
            }
            setImports((previous) => [...previous, ...added]);
            setErrors(failures);
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    async function remove(id) {
        if (id === SAMPLE_RECORDING.id || lock.current)
            return;
        lock.current = true;
        setBusy(true);
        try {
            await deleteRecording(id);
            setImports((previous) => previous.filter((recording) => recording.id !== id));
        }
        catch {
            setErrors(["The recording could not be deleted."]);
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    async function rename(id, name) {
        const recording = imports.find((item) => item.id === id);
        if (!recording || lock.current || !name.trim())
            return false;
        lock.current = true;
        setBusy(true);
        try {
            const updated = { ...recording, name: name.trim().slice(0, 80) };
            await saveRecording(updated);
            setImports((previous) => previous.map((item) => item.id === id ? updated : item));
            return true;
        }
        catch {
            setErrors(["The recording could not be renamed."]);
            return false;
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return <Context.Provider value={{ recordings: [SAMPLE_RECORDING, ...imports], ready, busy, errors, dismissErrors: () => setErrors([]), importFiles, remove, rename }}>{children}</Context.Provider>;
}
export function useRecordings() {
    const context = useContext(Context);
    if (!context)
        throw new Error("RecordingsProvider is missing.");
    return context;
}
