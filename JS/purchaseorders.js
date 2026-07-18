/***********************************
 * LPO / PURCHASE ORDERS
 * Two directions, one table:
 * - Incoming: a CLIENT's Local Purchase Order authorizing a job —
 *   just a record of what they approved and their reference number.
 * - Outgoing: YOUR purchase order to a supplier for materials —
 *   marking it "Received" adds the ordered quantities straight to
 *   Inventory, same safe pattern used everywhere else in this app.
 ***********************************/

let purchaseOrdersCache = [];
let poLineItemsTemp = [];
let poViewFilter = "all";

function generatePONumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const key = `poCounter_${y}-${m}-${d}`;
  const next = (Number(localStorage.getItem(key)) || 0) + 1;
  localStorage.setItem(key, next);
  return `PO-${y}${m}${d}-${String(next).padStart(3, "0")}`;
}

async function renderPurchaseOrdersPage() {
  purchaseOrdersCache = (await dbGetAll("purchaseOrders")).sort((a, b) => new Date(b.date) - new Date(a.date));
  renderPurchaseOrdersTable();
}

function setPOView(view) {
  poViewFilter = view;
  document.querySelectorAll("[data-po-view]").forEach(btn => btn.classList.toggle("btn-primary", btn.dataset.poView === view));
  renderPurchaseOrdersTable();
}

function renderPurchaseOrdersTable() {
  const tbody = document.querySelector("#purchaseOrdersTable tbody");
  if (!tbody) return;

  let rows = purchaseOrdersCache;
  if (poViewFilter === "incoming") rows = rows.filter(r => r.type === "Incoming");
  if (poViewFilter === "outgoing") rows = rows.filter(r => r.type === "Outgoing");

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No records here yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(po => `
    <tr>
      <td>${po.type === "Incoming" ? "Client LPO" : "Supplier PO"}</td>
      <td>${po.ourRef}${po.clientRef ? `<br><small style="color:var(--ink-soft);">Their ref: ${escapeHtml(po.clientRef)}</small>` : ""}</td>
      <td>${new Date(po.date).toLocaleDateString()}</td>
      <td>${escapeHtml(po.party)}</td>
      <td class="money">${money(po.total)}</td>
      <td>
        <select onchange="updatePOStatus(${po.id}, this.value)" style="padding:4px 6px;">
          ${(po.type === "Incoming" ? ["Open", "Invoiced", "Cancelled"] : ["Ordered", "Received", "Cancelled"]).map(s => `<option ${po.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>
        <button class="btn btn-sm" onclick="viewPurchaseOrder(${po.id})">View</button>
        <button class="btn btn-sm btn-danger" onclick="deletePurchaseOrder(${po.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

async function openPurchaseOrderModal() {
  poLineItemsTemp = [];
  const inventory = await dbGetAll("inventory");

  showModal({
    title: "New LPO / Purchase Order",
    wide: true,
    bodyHtml: `
      <label class="field-label">Type</label>
      <select id="poType" onchange="togglePOTypeFields()">
        <option value="Incoming">Client LPO (they authorized this job)</option>
        <option value="Outgoing">Supplier Purchase Order (you're ordering materials)</option>
      </select>

      <div class="field-row" style="margin-top:10px;">
        <div>
          <label class="field-label" id="poPartyLabel">Client</label>
          <input type="text" id="poParty" placeholder="Name">
        </div>
        <div id="poClientRefWrap">
          <label class="field-label">Their LPO number</label>
          <input type="text" id="poClientRef" placeholder="e.g. LPO-4471">
        </div>
      </div>

      <label class="field-label" id="poLineLabel">Line items</label>
      <div class="field-row" id="poIncomingLineRow">
        <input type="text" id="poLineDesc" placeholder="Description">
        <input type="number" id="poLineQty" placeholder="Qty" value="1" min="1">
        <input type="number" id="poLinePrice" placeholder="Amount" min="0" step="0.01">
        <button class="btn" onclick="addPOLineItem()">+ Add line</button>
      </div>
      <div class="field-row" id="poOutgoingLineRow" style="display:none;">
        <select id="poLineMaterial">
          <option value="">-- Select material --</option>
          ${inventory.map(inv => `<option value="${inv.id}">${escapeHtml(inv.name)} (${escapeHtml(inv.unit || "pcs")})</option>`).join("")}
        </select>
        <input type="number" id="poLineQtyMat" placeholder="Qty" value="1" min="1">
        <input type="number" id="poLineUnitCost" placeholder="Unit cost" min="0" step="0.01">
        <button class="btn" onclick="addPOMaterialLine()">+ Add line</button>
      </div>
      <div id="poLineItemsList"></div>
      <div class="cart-totals" id="poTotalsBox"></div>

      <label class="field-label" style="margin-top:10px;">Notes (optional)</label>
      <input type="text" id="poNotes">
    `,
    saveLabel: "Save",
    onSave: savePurchaseOrder
  });

  renderPOLineItems();
}

function togglePOTypeFields() {
  const type = document.getElementById("poType").value;
  const isIncoming = type === "Incoming";
  document.getElementById("poPartyLabel").textContent = isIncoming ? "Client" : "Supplier";
  document.getElementById("poClientRefWrap").style.display = isIncoming ? "block" : "none";
  document.getElementById("poIncomingLineRow").style.display = isIncoming ? "grid" : "none";
  document.getElementById("poOutgoingLineRow").style.display = isIncoming ? "none" : "grid";
  poLineItemsTemp = [];
  renderPOLineItems();
}

function addPOLineItem() {
  const desc = document.getElementById("poLineDesc").value.trim();
  const qty = Number(document.getElementById("poLineQty").value) || 1;
  const price = Number(document.getElementById("poLinePrice").value);
  if (!desc || !(price >= 0)) return alert("Enter a description and an amount.");

  poLineItemsTemp.push({ name: desc, qty, price });
  document.getElementById("poLineDesc").value = "";
  document.getElementById("poLineQty").value = "1";
  document.getElementById("poLinePrice").value = "";
  renderPOLineItems();
}

async function addPOMaterialLine() {
  const inventoryId = Number(document.getElementById("poLineMaterial").value);
  const qty = Number(document.getElementById("poLineQtyMat").value) || 1;
  const unitCost = Number(document.getElementById("poLineUnitCost").value);
  if (!inventoryId) return alert("Select a material.");
  if (!(unitCost >= 0)) return alert("Enter a unit cost.");

  const inv = await dbGet("inventory", inventoryId);
  poLineItemsTemp.push({ name: inv.name, inventoryId, qty, price: unitCost });
  document.getElementById("poLineQtyMat").value = "1";
  document.getElementById("poLineUnitCost").value = "";
  renderPOLineItems();
}

function removePOLineItem(index) {
  poLineItemsTemp.splice(index, 1);
  renderPOLineItems();
}

function renderPOLineItems() {
  const box = document.getElementById("poLineItemsList");
  if (!box) return;

  box.innerHTML = poLineItemsTemp.length
    ? poLineItemsTemp.map((item, i) => `
        <div class="cart-totals-row">
          <span>${escapeHtml(item.name)} × ${item.qty}</span>
          <span>
            <span class="money">${money(item.price * item.qty)}</span>
            <button class="btn btn-sm btn-icon" onclick="removePOLineItem(${i})">✕</button>
          </span>
        </div>
      `).join("")
    : `<div class="empty-state">No line items yet.</div>`;

  const total = poLineItemsTemp.reduce((sum, i) => sum + i.price * i.qty, 0);
  const totalsBox = document.getElementById("poTotalsBox");
  if (totalsBox) totalsBox.innerHTML = `<div class="cart-totals-row grand"><span>Total</span><span class="money">${money(total)}</span></div>`;
}

async function savePurchaseOrder() {
  const type = document.getElementById("poType").value;
  const party = document.getElementById("poParty").value.trim();
  const clientRef = type === "Incoming" ? document.getElementById("poClientRef").value.trim() : "";
  const notes = document.getElementById("poNotes").value.trim();

  if (!party) return alert(`Enter a ${type === "Incoming" ? "client" : "supplier"} name.`);
  if (!poLineItemsTemp.length) return alert("Add at least one line item.");

  const total = poLineItemsTemp.reduce((sum, i) => sum + i.price * i.qty, 0);

  await dbPut("purchaseOrders", {
    type,
    ourRef: generatePONumber(),
    clientRef,
    date: new Date().toISOString(),
    party,
    items: [...poLineItemsTemp],
    total,
    status: type === "Incoming" ? "Open" : "Ordered",
    notes
  });

  closeModal();
  renderPurchaseOrdersPage();
}

async function updatePOStatus(id, status) {
  const po = await dbGet("purchaseOrders", id);
  if (!po) return;

  // Marking a supplier PO "Received" adds the ordered quantities to
  // stock — but only once, so flipping the status back and forth
  // can't add the same stock twice.
  if (po.type === "Outgoing" && status === "Received" && po.status !== "Received") {
    for (const item of po.items) {
      if (item.inventoryId) await adjustInventoryQty(item.inventoryId, item.qty);
    }
    if (typeof renderInventoryTable === "function") renderInventoryTable();
  }
  // Moving a received PO back to a non-received status reverses that stock.
  if (po.type === "Outgoing" && po.status === "Received" && status !== "Received") {
    for (const item of po.items) {
      if (item.inventoryId) await adjustInventoryQty(item.inventoryId, -item.qty);
    }
    if (typeof renderInventoryTable === "function") renderInventoryTable();
  }

  po.status = status;
  await dbPut("purchaseOrders", po);
  renderPurchaseOrdersPage();
}

function viewPurchaseOrder(id) {
  const po = purchaseOrdersCache.find(x => x.id === id);
  if (!po) return;

  showModal({
    title: `${po.type === "Incoming" ? "Client LPO" : "Supplier PO"} — ${po.ourRef}`,
    bodyHtml: `
      <div style="font-size:13px;color:var(--ink-soft);margin-bottom:10px;">
        ${new Date(po.date).toLocaleString()} • ${escapeHtml(po.party)}${po.clientRef ? ` • Their ref: ${escapeHtml(po.clientRef)}` : ""}
      </div>
      ${po.items.map(i => `<div class="cart-totals-row"><span>${escapeHtml(i.name)} × ${i.qty}</span><span class="money">${money(i.price * i.qty)}</span></div>`).join("")}
      <div class="cart-totals-row grand" style="margin-top:8px;"><span>Total</span><span class="money">${money(po.total)}</span></div>
      ${po.notes ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:8px;">${escapeHtml(po.notes)}</div>` : ""}
    `,
    hideFooter: true
  });
}

async function deletePurchaseOrder(id) {
  const po = purchaseOrdersCache.find(x => x.id === id);
  if (!po) return;

  if (!(await authorizePin(`delete this ${po.type === "Incoming" ? "client LPO" : "purchase order"}`))) return;

  if (po.type === "Outgoing" && po.status === "Received") {
    if (!confirm("This PO was already marked Received, so its materials are in stock. Deleting it will NOT remove that stock automatically. Delete anyway?")) return;
  } else if (!confirm("Delete this record?")) {
    return;
  }

  await dbDelete("purchaseOrders", id);
  renderPurchaseOrdersPage();
}
