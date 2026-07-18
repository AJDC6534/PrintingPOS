/***********************************
 * WORK ORDERS
 * Internal production tickets — "what's being made, for who, by when,
 * assigned to whom." Independent of Checkout/Invoices on purpose: a
 * job can be in production before it's ever paid for, and marking it
 * "Done" here doesn't touch inventory or sales (that already happens
 * at Checkout/Invoice time) — this would otherwise double-deduct
 * materials for the same job.
 ***********************************/

let workOrdersCache = [];
let workOrderLineItemsTemp = [];

function generateWorkOrderNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const key = `workOrderCounter_${y}-${m}-${d}`;
  const next = (Number(localStorage.getItem(key)) || 0) + 1;
  localStorage.setItem(key, next);
  return `WO-${y}${m}${d}-${String(next).padStart(3, "0")}`;
}

async function renderWorkOrdersPage() {
  workOrdersCache = (await dbGetAll("workOrders")).sort((a, b) => new Date(b.date) - new Date(a.date));
  const tbody = document.querySelector("#workOrdersTable tbody");

  if (!workOrdersCache.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No work orders yet.</td></tr>`;
    return;
  }

  const pillClass = { Pending: "pill-unpaid", "In Progress": "pill-balance", Done: "pill-paid", Cancelled: "pill-refunded" };

  tbody.innerHTML = workOrdersCache.map(w => `
    <tr>
      <td>${w.workOrderNo}</td>
      <td>${escapeHtml(w.client)}</td>
      <td>${escapeHtml(w.assignedStaffName || "—")}</td>
      <td>${w.dueDate || "—"}</td>
      <td>
        <select onchange="updateWorkOrderStatus(${w.id}, this.value)" style="padding:4px 6px;">
          ${["Pending", "In Progress", "Done", "Cancelled"].map(s => `<option ${w.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>
        <button class="btn btn-sm" onclick="viewWorkOrder(${w.id})">View</button>
        <button class="btn btn-sm btn-danger" onclick="deleteWorkOrder(${w.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

async function updateWorkOrderStatus(id, status) {
  const w = await dbGet("workOrders", id);
  if (!w) return;
  w.status = status;
  await dbPut("workOrders", w);
  renderWorkOrdersPage();
}

async function openWorkOrderModal() {
  workOrderLineItemsTemp = [];
  const staff = await dbGetAll("staff");

  showModal({
    title: "New work order",
    wide: true,
    bodyHtml: `
      <div class="field-row">
        <div>
          <label class="field-label">Client</label>
          <input type="text" id="woClient" placeholder="Client or job name">
        </div>
        <div>
          <label class="field-label">Assigned to</label>
          <select id="woStaffSelect">
            <option value="">-- Unassigned --</option>
            ${staff.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="field-label">Due date</label>
          <input type="date" id="woDueDate">
        </div>
      </div>

      <label class="field-label">What's being produced</label>
      <div class="field-row">
        <input type="text" id="woLineDesc" placeholder="e.g. A4 Flyers">
        <input type="number" id="woLineQty" placeholder="Qty" value="1" min="1">
        <button class="btn" onclick="addWorkOrderLineItem()">+ Add</button>
      </div>
      <div id="woLineItemsList"></div>

      <label class="field-label" style="margin-top:10px;">Notes (optional)</label>
      <input type="text" id="woNotes" placeholder="Special instructions, finishing, etc.">
    `,
    saveLabel: "Save work order",
    onSave: saveWorkOrder
  });

  renderWorkOrderLineItems();
}

function addWorkOrderLineItem() {
  const desc = document.getElementById("woLineDesc").value.trim();
  const qty = Number(document.getElementById("woLineQty").value) || 1;
  if (!desc) return alert("Enter what's being produced.");

  workOrderLineItemsTemp.push({ name: desc, qty });
  document.getElementById("woLineDesc").value = "";
  document.getElementById("woLineQty").value = "1";
  renderWorkOrderLineItems();
}

function removeWorkOrderLineItem(index) {
  workOrderLineItemsTemp.splice(index, 1);
  renderWorkOrderLineItems();
}

function renderWorkOrderLineItems() {
  const box = document.getElementById("woLineItemsList");
  if (!box) return;

  box.innerHTML = workOrderLineItemsTemp.length
    ? workOrderLineItemsTemp.map((item, i) => `
        <div class="cart-totals-row">
          <span>${escapeHtml(item.name)} × ${item.qty}</span>
          <button class="btn btn-sm btn-icon" onclick="removeWorkOrderLineItem(${i})">✕</button>
        </div>
      `).join("")
    : `<div class="empty-state">Nothing added yet.</div>`;
}

async function saveWorkOrder() {
  const client = document.getElementById("woClient").value.trim();
  const staffId = document.getElementById("woStaffSelect").value;
  const dueDate = document.getElementById("woDueDate").value;
  const notes = document.getElementById("woNotes").value.trim();

  if (!client) return alert("Enter a client or job name.");
  if (!workOrderLineItemsTemp.length) return alert("Add at least one item being produced.");

  const staffList = staffId ? await dbGetAll("staff") : [];
  const staffMember = staffId ? staffList.find(s => s.id === Number(staffId)) : null;

  await dbPut("workOrders", {
    workOrderNo: generateWorkOrderNumber(),
    date: new Date().toISOString(),
    client,
    items: [...workOrderLineItemsTemp],
    assignedStaffId: staffMember ? staffMember.id : null,
    assignedStaffName: staffMember ? staffMember.name : "",
    dueDate,
    status: "Pending",
    notes
  });

  closeModal();
  renderWorkOrdersPage();
}

function viewWorkOrder(id) {
  const w = workOrdersCache.find(x => x.id === id);
  if (!w) return;

  showModal({
    title: `Work Order ${w.workOrderNo}`,
    bodyHtml: `
      <div style="font-size:13px;color:var(--ink-soft);margin-bottom:10px;">
        ${new Date(w.date).toLocaleString()} • ${escapeHtml(w.client)} • ${escapeHtml(w.assignedStaffName || "Unassigned")}${w.dueDate ? " • Due " + w.dueDate : ""}
      </div>
      ${w.items.map(i => `<div class="cart-totals-row"><span>${escapeHtml(i.name)}</span><span>× ${i.qty}</span></div>`).join("")}
      ${w.notes ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:8px;">${escapeHtml(w.notes)}</div>` : ""}
    `,
    hideFooter: true
  });
}

async function deleteWorkOrder(id) {
  if (!(await authorizePin("delete a work order"))) return;
  if (!confirm("Delete this work order?")) return;
  await dbDelete("workOrders", id);
  renderWorkOrdersPage();
}
