/***********************************
 * DELIVERY
 * A simple dispatch log — what's going out, to where, with whom, and
 * when. Independent of Invoices/Work Orders on purpose; reference an
 * invoice or work order number in the notes if you want a link back.
 ***********************************/

let deliveriesCache = [];

async function renderDeliveryPage() {
  deliveriesCache = (await dbGetAll("deliveries")).sort((a, b) => new Date(b.scheduledDate || b.date) - new Date(a.scheduledDate || a.date));
  const tbody = document.querySelector("#deliveriesTable tbody");

  if (!deliveriesCache.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No deliveries logged yet.</td></tr>`;
    return;
  }

  const pillClass = { Pending: "pill-unpaid", "Out for Delivery": "pill-balance", Delivered: "pill-paid", Failed: "pill-refunded" };

  tbody.innerHTML = deliveriesCache.map(d => `
    <tr>
      <td>${escapeHtml(d.client)}</td>
      <td>${escapeHtml(d.address)}</td>
      <td>${escapeHtml(d.contactPhone || "—")}</td>
      <td>${escapeHtml(d.assignedStaffName || "—")}</td>
      <td>${d.scheduledDate ? new Date(d.scheduledDate).toLocaleString() : "—"}</td>
      <td>
        <select onchange="updateDeliveryStatus(${d.id}, this.value)" style="padding:4px 6px;">
          ${["Pending", "Out for Delivery", "Delivered", "Failed"].map(s => `<option ${d.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>
        <button class="btn btn-sm" onclick="viewDelivery(${d.id})">View</button>
        <button class="btn btn-sm btn-danger" onclick="deleteDelivery(${d.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

async function updateDeliveryStatus(id, status) {
  const d = await dbGet("deliveries", id);
  if (!d) return;
  d.status = status;
  await dbPut("deliveries", d);
  renderDeliveryPage();
}

async function openDeliveryModal() {
  const staff = await dbGetAll("staff");

  showModal({
    title: "New delivery",
    wide: true,
    bodyHtml: `
      <div class="field-row">
        <div>
          <label class="field-label">Client</label>
          <input type="text" id="delClient" placeholder="Name">
        </div>
        <div>
          <label class="field-label">Contact phone</label>
          <input type="text" id="delPhone">
        </div>
      </div>

      <label class="field-label">Delivery address</label>
      <input type="text" id="delAddress" placeholder="Full address">

      <label class="field-label" style="margin-top:10px;">What's being delivered</label>
      <input type="text" id="delItems" placeholder="e.g. 500 flyers, 2 banners">

      <div class="field-row" style="margin-top:10px;">
        <div>
          <label class="field-label">Assigned to</label>
          <select id="delStaffSelect">
            <option value="">-- Unassigned --</option>
            ${staff.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="field-label">Scheduled for</label>
          <input type="datetime-local" id="delScheduled">
        </div>
      </div>

      <label class="field-label" style="margin-top:10px;">Notes (optional)</label>
      <input type="text" id="delNotes" placeholder="Reference invoice/work order number, gate code, etc.">
    `,
    saveLabel: "Save delivery",
    onSave: saveDelivery
  });
}

async function saveDelivery() {
  const client = document.getElementById("delClient").value.trim();
  const phone = document.getElementById("delPhone").value.trim();
  const address = document.getElementById("delAddress").value.trim();
  const items = document.getElementById("delItems").value.trim();
  const staffId = document.getElementById("delStaffSelect").value;
  const scheduled = document.getElementById("delScheduled").value;
  const notes = document.getElementById("delNotes").value.trim();

  if (!client) return alert("Enter a client name.");
  if (!address) return alert("Enter a delivery address.");

  const staffList = staffId ? await dbGetAll("staff") : [];
  const staffMember = staffId ? staffList.find(s => s.id === Number(staffId)) : null;

  await dbPut("deliveries", {
    date: new Date().toISOString(),
    client,
    contactPhone: phone,
    address,
    items,
    assignedStaffId: staffMember ? staffMember.id : null,
    assignedStaffName: staffMember ? staffMember.name : "",
    scheduledDate: scheduled ? new Date(scheduled).toISOString() : null,
    status: "Pending",
    notes
  });

  closeModal();
  renderDeliveryPage();
}

function viewDelivery(id) {
  const d = deliveriesCache.find(x => x.id === id);
  if (!d) return;

  showModal({
    title: `Delivery — ${d.client}`,
    bodyHtml: `
      <div class="cart-totals-row"><span>Address</span><span>${escapeHtml(d.address)}</span></div>
      <div class="cart-totals-row"><span>Contact</span><span>${escapeHtml(d.contactPhone || "—")}</span></div>
      <div class="cart-totals-row"><span>Items</span><span>${escapeHtml(d.items || "—")}</span></div>
      <div class="cart-totals-row"><span>Assigned to</span><span>${escapeHtml(d.assignedStaffName || "Unassigned")}</span></div>
      <div class="cart-totals-row"><span>Scheduled</span><span>${d.scheduledDate ? new Date(d.scheduledDate).toLocaleString() : "—"}</span></div>
      ${d.notes ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:8px;">${escapeHtml(d.notes)}</div>` : ""}
    `,
    hideFooter: true
  });
}

async function deleteDelivery(id) {
  if (!(await authorizePin("delete a delivery record"))) return;
  if (!confirm("Delete this delivery record?")) return;
  await dbDelete("deliveries", id);
  renderDeliveryPage();
}
