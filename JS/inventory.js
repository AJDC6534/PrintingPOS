/***********************************
 * INVENTORY / MATERIALS
 ***********************************/

let inventoryCache = [];

async function renderInventoryTable() {
  inventoryCache = (await dbGetAll("inventory")).sort((a, b) => a.name.localeCompare(b.name));
  const tbody = document.querySelector("#inventoryTable tbody");

  if (!inventoryCache.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No materials yet. Add paper, ink, vinyl, whatever you stock.</td></tr>`;
    return;
  }

  tbody.innerHTML = inventoryCache.map(inv => {
    const low = Number(inv.quantity) <= Number(inv.restockLevel || 0);
    return `
      <tr>
        <td>${escapeHtml(inv.name)}</td>
        <td class="money">${inv.quantity} ${escapeHtml(inv.unit || "pcs")} ${low ? `<span class="pill pill-low">Low</span>` : ""}</td>
        <td>${inv.restockLevel || 0} ${escapeHtml(inv.unit || "pcs")}</td>
        <td>
          <button class="btn btn-sm" onclick="openInventoryModal(${inv.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteInventoryItem(${inv.id})">Delete</button>
        </td>
      </tr>
    `;
  }).join("");
}

function openInventoryModal(id = null) {
  const existing = id ? inventoryCache.find(i => i.id === id) : null;

  showModal({
    title: existing ? "Edit material" : "New material",
    bodyHtml: `
      <div class="field-row">
        <div>
          <label class="field-label">Name</label>
          <input type="text" id="invNameInput" value="${existing ? escapeHtml(existing.name) : ""}" placeholder="e.g. A4 Glossy Paper">
        </div>
        <div>
          <label class="field-label">Unit</label>
          <input type="text" id="invUnitInput" value="${existing ? escapeHtml(existing.unit || "pcs") : "pcs"}" placeholder="pcs, sheets, ml...">
        </div>
      </div>
      <div class="field-row">
        <div>
          <label class="field-label">Current stock</label>
          <input type="number" id="invQtyInput" value="${existing ? existing.quantity : 0}" min="0">
        </div>
        <div>
          <label class="field-label">Restock alert level</label>
          <input type="number" id="invRestockInput" value="${existing ? existing.restockLevel : 5}" min="0">
        </div>
      </div>
    `,
    saveLabel: "Save material",
    onSave: async () => {
      const name = document.getElementById("invNameInput").value.trim();
      const unit = document.getElementById("invUnitInput").value.trim() || "pcs";
      const quantity = Number(document.getElementById("invQtyInput").value) || 0;
      const restockLevel = Number(document.getElementById("invRestockInput").value) || 0;

      if (!name) return alert("Enter a material name.");

      const record = existing ? { ...existing, name, unit, quantity, restockLevel } : { name, unit, quantity, restockLevel };
      await dbPut("inventory", record);
      closeModal();
      renderInventoryTable();
    }
  });
}

async function deleteInventoryItem(id) {
  if (!(await authorizePin("delete a material from inventory"))) return;
  if (!confirm("Delete this material? Items that use it will keep their recipe, but it won't deduct stock anymore.")) return;
  await dbDelete("inventory", id);
  renderInventoryTable();
}

// Used by the checkout flow to take stock down when a sale is completed,
// and by History to put it back if a sale is deleted. Same safe lookup
// on both ends so a material never gets "stuck" out of sync.
// Returns true if it actually found and updated a record, false if the
// inventoryId didn't match anything — the caller surfaces that instead
// of letting it fail silently.
async function adjustInventoryQty(inventoryId, delta) {
  const inv = await dbGet("inventory", Number(inventoryId));
  if (!inv) {
    console.warn("adjustInventoryQty: no inventory record found for id", inventoryId);
    return false;
  }
  inv.quantity = Math.max(0, Number(inv.quantity || 0) + delta);
  await dbPut("inventory", inv);
  return true;
}
