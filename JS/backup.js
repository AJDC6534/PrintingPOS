/***********************************
 * BACKUP & RESTORE
 * Everything this app knows lives in the browser's IndexedDB — clear
 * browser data, switch devices, or have the browser profile corrupt,
 * and it's gone. This is the way out: one file with everything in it.
 ***********************************/

const BACKUP_STORES = ["services", "inventory", "staff", "history", "rejects", "payroll", "customers", "adjustments", "quotations", "workOrders", "purchaseOrders", "deliveries"];
const BACKUP_APP_NAME = "Simple POS";

async function exportBackup() {
  try {
    const data = {};
    for (const store of BACKUP_STORES) {
      data[store] = await dbGetAll(store);
    }

    const backup = {
      app: BACKUP_APP_NAME,
      exportedAt: new Date().toISOString(),
      counts: Object.fromEntries(BACKUP_STORES.map(s => [s, data[s].length])),
      data
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const fileName = `simplepos-backup-${todayStr()}.json`;

    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: "JSON Backup", accept: { "application/json": [".json"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    alert(
      "Backup saved.\n\n" +
      BACKUP_STORES.map(s => `${s}: ${data[s].length}`).join("\n")
    );
  } catch (err) {
    if (err?.name === "AbortError") return; // person cancelled the save dialog
    console.error("Backup export failed:", err);
    alert("Backup failed. Check the console for details, and try again.");
  }
}

function importBackup(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const backup = JSON.parse(e.target.result);
      if (!backup || !backup.data || typeof backup.data !== "object") {
        alert("This doesn't look like a Simple POS backup file.");
        input.value = "";
        return;
      }

      const counts = BACKUP_STORES.map(s => `${s}: ${(backup.data[s] || []).length}`).join("\n");

      if (!(await authorizePin("restore a backup (replaces ALL current data)"))) { input.value = ""; return; }

      const ok = confirm(
        "Restore this backup?\n\n" +
        "This REPLACES everything currently in the app — services, inventory, staff, " +
        "sales history, rejects, payroll, and customers — with what's in this file.\n\n" +
        `Backup date: ${backup.exportedAt || "unknown"}\n\n${counts}`
      );
      if (!ok) { input.value = ""; return; }

      for (const store of BACKUP_STORES) {
        await dbClear(store);
        for (const record of backup.data[store] || []) {
          await dbPut(store, record);
        }
      }

      alert("Backup restored. The app will now refresh its screens.");
      input.value = "";
      goToPage("dashboard");
    } catch (err) {
      console.error("Backup restore failed:", err);
      alert("Restore failed — make sure this is a valid Simple POS backup file, and try again.");
      input.value = "";
    }
  };
  reader.readAsText(file);
}
