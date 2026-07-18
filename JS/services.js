/***********************************
 * SERVICES & ITEMS
 ***********************************/

let servicesCache = [];
let expandedServiceId = null;

// Item modal state — kept in one place instead of scattered globals.
let itemModalState = { serviceId: null, itemIndex: null, materials: [] };

async function renderServices() {
  servicesCache = await dbGetAll("services");
  const box = document.getElementById("servicesList");

  if (!servicesCache.length) {
    box.innerHTML = `<div class="card empty-state">No services yet. Click "New service" to add your first one, like "Printing" or "Signage".</div>`;
    return;
  }

  box.innerHTML = servicesCache.map(service => `
    <div class="card service-card">
      <div class="service-header" onclick="toggleServiceExpand(${service.id})">
        <h3>${escapeHtml(service.name)} <span style="color:var(--ink-soft);font-weight:400;font-size:12px;">(${(service.items || []).length} item(s))</span></h3>
        <div onclick="event.stopPropagation()">
          <button class="btn btn-sm" onclick="openServiceModal(${service.id})">Rename</button>
          <button class="btn btn-sm btn-danger" onclick="deleteService(${service.id})">Delete</button>
          <button class="btn btn-sm btn-primary" onclick="openItemModal(${service.id})">+ Item</button>
        </div>
      </div>
      <div class="service-items ${expandedServiceId === service.id ? "expanded" : ""}" id="service-items-${service.id}">
        ${(service.items || []).map((item, index) => `
          <div class="item-tile">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-meta">${money(item.price)} ${item.commission ? `• ${item.commission}% commission` : ""}</div>
            ${(item.materials || []).length ? `<div class="item-meta">Uses: ${item.materials.map(m => `${escapeHtml(m.name)} (${m.qty})`).join(", ")}</div>` : ""}
            <div class="item-actions">
              <button class="btn btn-sm" onclick="openItemModal(${service.id}, ${index})">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="deleteItem(${service.id}, ${index})">Delete</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

function toggleServiceExpand(id) {
  expandedServiceId = expandedServiceId === id ? null : id;
  renderServices();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}

/* ---------- Add / rename / delete service ---------- */

function openServiceModal(id = null) {
  const existing = id ? servicesCache.find(s => s.id === id) : null;
  showModal({
    title: existing ? "Rename service" : "New service",
    bodyHtml: `
      <label class="field-label">Service name</label>
      <input type="text" id="serviceNameInput" value="${existing ? escapeHtml(existing.name) : ""}" placeholder="e.g. Printing">
    `,
    saveLabel: "Save",
    onSave: async () => {
      const name = document.getElementById("serviceNameInput").value.trim();
      if (!name) return alert("Enter a service name.");
      if (existing) {
        existing.name = name;
        await dbPut("services", existing);
      } else {
        await dbPut("services", { name, items: [] });
      }
      closeModal();
      renderServices();
    }
  });
}

async function deleteService(id) {
  if (!(await authorizePin("delete a service and all its items"))) return;
  if (!confirm("Delete this service and all its items?")) return;
  await dbDelete("services", id);
  renderServices();
}

/* ---------- Item modal (name, price, commission, materials) ---------- */

async function openItemModal(serviceId, itemIndex = null) {
  const service = servicesCache.find(s => s.id === serviceId);
  const item = itemIndex !== null ? service.items[itemIndex] : null;

  const inventory = await dbGetAll("inventory");
  const validInventoryIds = new Set(inventory.map(inv => inv.id));

  // Drop any material reference whose inventory record no longer exists
  // (e.g. it was deleted and re-added, so it got a new id). Without this,
  // a stale reference never shows as "ticked" in the checklist below —
  // so there's nothing to untick — and ticking the current material
  // just adds a second entry alongside the invisible broken one instead
  // of replacing it.
  const rawMaterials = item ? [...(item.materials || [])] : [];
  const staleCount = rawMaterials.filter(m => !validInventoryIds.has(m.inventoryId)).length;

  itemModalState = {
    serviceId,
    itemIndex,
    materials: rawMaterials.filter(m => validInventoryIds.has(m.inventoryId))
  };

  showModal({
    title: item ? "Edit item" : "New item",
    wide: true,
    bodyHtml: `
      <div class="field-row">
        <div>
          <label class="field-label">Item name</label>
          <input type="text" id="itemNameInput" value="${item ? escapeHtml(item.name) : ""}" placeholder="e.g. A4 Flyer Printing">
        </div>
        <div>
          <label class="field-label">Price</label>
          <input type="number" id="itemPriceInput" value="${item ? item.price : ""}" min="0" step="0.01">
        </div>
        <div>
          <label class="field-label">Commission %</label>
          <input type="number" id="itemCommissionInput" value="${item ? item.commission || 0 : 0}" min="0" step="0.1">
        </div>
      </div>

      ${staleCount ? `<div class="empty-state" style="background:#FFF3D6;border-radius:8px;padding:10px;margin-bottom:10px;color:#9A6B00;">
        Removed ${staleCount} material link(s) that pointed at deleted inventory. Tick the correct material(s) below and save to relink.
      </div>` : ""}

      <label class="field-label" style="margin-top:8px;">Materials used</label>
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px;">Tick what this item uses and set the quantity — that's the whole binding, nothing else to do.</p>
      <input type="text" id="materialSearch" class="checklist-search" placeholder="🔍 Search materials..." oninput="renderMaterialsChecklist('${inventory.map(i=>i.id).join(",")}')">
      <div class="checklist-summary" id="materialsSummary">0 material(s) selected</div>
      <div class="checklist-box" id="materialsChecklist"></div>
    `,
    saveLabel: "Save item",
    onSave: saveItem
  });

  window._itemModalInventory = inventory;
  renderMaterialsChecklist();
}

function renderMaterialsChecklist() {
  const box = document.getElementById("materialsChecklist");
  if (!box) return;

  const keyword = (document.getElementById("materialSearch")?.value || "").trim().toLowerCase();
  const inventory = (window._itemModalInventory || [])
    .filter(inv => !keyword || inv.name.toLowerCase().includes(keyword))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!inventory.length) {
    box.innerHTML = `<div class="empty-state">No materials match "${keyword}".</div>`;
  } else {
    box.innerHTML = inventory.map(inv => {
      const existing = itemModalState.materials.find(m => m.inventoryId === inv.id);
      const checked = !!existing;
      return `
        <label class="check-row ${checked ? "is-checked" : ""}">
          <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleMaterial(${inv.id}, this)">
          <span>${escapeHtml(inv.name)} <small style="color:var(--ink-soft);">(${inv.unit || "pcs"})</small></span>
          <input type="number" min="0" step="any" value="${existing ? existing.qty : ""}" placeholder="Qty" ${checked ? "" : "disabled"}
            oninput="updateMaterialQty(${inv.id}, this.value)">
        </label>
      `;
    }).join("");
  }

  const summary = document.getElementById("materialsSummary");
  if (summary) summary.textContent = `${itemModalState.materials.length} material(s) selected`;
}

function toggleMaterial(inventoryId, checkbox) {
  const inv = (window._itemModalInventory || []).find(i => i.id === inventoryId);
  if (!inv) return;

  itemModalState.materials = itemModalState.materials.filter(m => m.inventoryId !== inventoryId);
  if (checkbox.checked) {
    itemModalState.materials.push({ inventoryId, name: inv.name, qty: 1 });
  }
  renderMaterialsChecklist();

  if (checkbox.checked) {
    const row = checkbox.closest(".check-row");
    const qtyField = row?.querySelector("input[type=number]");
    if (qtyField) { qtyField.focus(); qtyField.select(); }
  }
}

function updateMaterialQty(inventoryId, value) {
  const entry = itemModalState.materials.find(m => m.inventoryId === inventoryId);
  if (entry) entry.qty = Number(value) || 0;
}

async function saveItem() {
  const { serviceId, itemIndex } = itemModalState;
  const name = document.getElementById("itemNameInput").value.trim();
  const price = Number(document.getElementById("itemPriceInput").value);
  const commission = Number(document.getElementById("itemCommissionInput").value) || 0;

  if (!name || !price) return alert("Enter an item name and price.");

  const service = servicesCache.find(s => s.id === serviceId);
  service.items ||= [];

  const record = {
    name,
    price,
    commission,
    materials: itemModalState.materials.filter(m => Number(m.qty) > 0)
  };

  if (itemIndex !== null) {
    service.items[itemIndex] = record;
  } else {
    service.items.push(record);
  }

  await dbPut("services", service);
  closeModal();
  renderServices();
}

async function deleteItem(serviceId, index) {
  if (!(await authorizePin("delete an item"))) return;
  if (!confirm("Delete this item?")) return;
  const service = servicesCache.find(s => s.id === serviceId);
  service.items.splice(index, 1);
  await dbPut("services", service);
  renderServices();
}
