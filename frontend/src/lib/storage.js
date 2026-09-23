const DATABASE = "xc-tracker";
const STORE = "recordings";
async function transaction(mode, action) {
    const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Recording storage is busy in another tab."));
    });
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        tx.oncomplete = () => { database.close(); resolve(request.result); };
        tx.onabort = () => { database.close(); reject(tx.error ?? new Error("Recording storage failed.")); };
        tx.onerror = () => { database.close(); reject(tx.error); };
    });
}
export const loadRecordings = () => transaction("readonly", (store) => store.getAll());
export const saveRecording = (recording) => transaction("readwrite", (store) => store.put(recording));
export const deleteRecording = (id) => transaction("readwrite", (store) => store.delete(id));
