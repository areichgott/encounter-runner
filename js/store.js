// Tiny IndexedDB wrapper. Stores: kv (settings, active encounter, undo, section state), packs.
const DB_NAME = "encounter-runner";
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const kv = {
  get: key => tx("kv", "readonly", s => req2p(s.get(key))),
  set: (key, val) => tx("kv", "readwrite", s => { s.put(val, key); }),
  del: key => tx("kv", "readwrite", s => { s.delete(key); }),
  all: () => tx("kv", "readonly", s => {
    const kr = s.getAllKeys(), vr = s.getAll();
    return Promise.all([req2p(kr), req2p(vr)]).then(([keys, vals]) => Object.fromEntries(keys.map((k, i) => [k, vals[i]])));
  }),
};
export const packs = {
  all: () => tx("packs", "readonly", s => req2p(s.getAll())),
  put: p => tx("packs", "readwrite", s => { s.put(p, p.id); }),
  del: id => tx("packs", "readwrite", s => { s.delete(id); }),
};
export async function clearAll() {
  await tx("kv", "readwrite", s => { s.clear(); });
  await tx("packs", "readwrite", s => { s.clear(); });
}
export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (_) {}
  return false;
}
