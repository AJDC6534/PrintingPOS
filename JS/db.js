/***********************************
 * DATABASE
 * One small promise-based helper. Every other file talks to the
 * database through these five functions instead of writing its own
 * transaction/cursor code — that's most of what makes this version
 * easier to read than the old one.
 ***********************************/

const DB_NAME = "SimplePOS";
const DB_VERSION = 6; // v2 rejects, v3 payroll, v4 customers, v5 adjustments, v6 quotations/workOrders/purchaseOrders/deliveries
let db = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const d = e.target.result;

      if (!d.objectStoreNames.contains("services")) {
        d.createObjectStore("services", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("inventory")) {
        d.createObjectStore("inventory", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("staff")) {
        d.createObjectStore("staff", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("history")) {
        d.createObjectStore("history", { keyPath: "invoiceNo" });
      }
      if (!d.objectStoreNames.contains("settings")) {
        d.createObjectStore("settings", { keyPath: "key" });
      }
      if (!d.objectStoreNames.contains("rejects")) {
        d.createObjectStore("rejects", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("payroll")) {
        d.createObjectStore("payroll", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("customers")) {
        d.createObjectStore("customers", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("adjustments")) {
        d.createObjectStore("adjustments", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("quotations")) {
        d.createObjectStore("quotations", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("workOrders")) {
        d.createObjectStore("workOrders", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("purchaseOrders")) {
        d.createObjectStore("purchaseOrders", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("deliveries")) {
        d.createObjectStore("deliveries", { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

// Get every record in a store.
function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Get one record by its key.
function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Add or update a record. Returns the record's key.
function dbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readwrite").objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Delete a record by its key.
function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readwrite").objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Wipe every record in a store — used when restoring a backup, so old
// data doesn't linger mixed in with the restored data.
function dbClear(storeName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readwrite").objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
