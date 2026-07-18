/***********************************
 * REJECTS
 * A reject wastes materials without producing a sale — the point of
 * logging it is: (1) know what mistakes keep happening, and
 * (2) keep the stock count honest, since that material really was
 * used up even though nothing was sold.
 ***********************************/

let rejectsCache = [];
const REJECT_REASONS = ["Misprint", "Wrong size / cut", "Color mismatch", "Machine fault", "Damaged material", "Client changed mind", "Other"];

async function renderRejects() {
  rejectsCache = (await dbGetAll("rejects")).sort((a, b) => new Date(b.date) - new Date(a.date));
  renderRejectsStats();
  renderRejectsTable();
}

function renderRejectsStats() {
  const box = document.getElementById("rejectsStats");
  if (!box) return;

  const today = todayStr();
  const todays = rejectsCache.filter(r => (r.date || "").slice(0, 10) === today);
  const todaysCost = todays.reduce((sum, r) => sum + Number(r.cost || 0), 0);
  const monthKey = today.slice(0, 7);
  const monthly = rejectsCache.filter(r => (r.date || "").slice(0, 7) === monthKey);
  const monthlyCost = monthly.reduce((sum, r) => sum + Number(r.cost || 0), 0);

  box.innerHTML = `
    <div class="stat-card ${todays.length ? "warn" : ""}">
      <div class="stat-label">Rejects today</div>
      <div class="stat-value">${todays.length} <span style="font-size:14px;color:var(--ink-soft);">(${money(todaysCost)})</span></div>
    </div>
    <div class="stat-card ${monthly.length ? "warn" : ""}">
      <div class="stat-label">Rejects this month</div>
      <div class="stat-value">${monthly.length} <span style="font-size:14px;color:var(--ink-soft);">(${money(monthlyCost)})</span></div>
    </div>
  `;
}

function renderRejectsTable() {
  const tbody = document.querySelector("#rejectsTable tbody");

  if (!rejectsCache.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No rejects logged. Good sign — or nobody's logging them yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rejectsCache.map(r => `
    <tr>
      <td>${new Date(r.date).toLocaleDateString()}</td>
      <td>${escapeHtml(r.itemName)}</td>
      <td>${r.qty}</td>
      <td>${escapeHtml(r.reason)}${r.notes ? ` <small style="color:var(--ink-soft);">— ${escapeHtml(r.notes)}</small>` : ""}</td>
      <td>${escapeHtml(r.staffName || "—")}</td>
      <td class="money">${money(r.cost)}</td>
      <td>${r.staffId ? `<span class="pill ${r.rejectPaid ? "pill-paid" : "pill-balance"}">${r.rejectPaid ? "Deducted" : "Not yet"}</span>` : "—"}</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteReject(${r.id})">Delete</button></td>
    </tr>
  `).join("");
}

async function openRejectModal() {
  const services = await dbGetAll("services");
  const staff = await dbGetAll("staff");

  if (!staff.length) return alert("Add a staff member first — rejects need to be attributed to someone for accurate records.");

  const itemOptions = [];
  services.forEach(service => {
    (service.items || []).forEach((item, index) => {
      itemOptions.push({ key: `${service.id}-${index}`, label: `${service.name} — ${item.name}`, item });
    });
  });

  showModal({
    title: "Log a reject",
    bodyHtml: `
      <label class="field-label">Item</label>
      <select id="rejectItemSelect">
        <option value="">-- Select item --</option>
        ${itemOptions.map(o => `<option value="${o.key}">${escapeHtml(o.label)}</option>`).join("")}
      </select>

      <div class="field-row" style="margin-top:10px;">
        <div>
          <label class="field-label">Quantity spoiled</label>
          <input type="number" id="rejectQtyInput" value="1" min="1">
        </div>
        <div>
          <label class="field-label">Reason</label>
          <select id="rejectReasonSelect">
            ${REJECT_REASONS.map(r => `<option>${r}</option>`).join("")}
          </select>
        </div>
      </div>

      <label class="field-label">Staff (required — who's responsible for the record)</label>
      <select id="rejectStaffSelect">
        <option value="" disabled selected>-- Select staff --</option>
        ${staff.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
      </select>

      <label class="field-label" style="margin-top:10px;">Notes (optional)</label>
      <input type="text" id="rejectNotesInput" placeholder="e.g. wrong bleed setting on the printer">
    `,
    saveLabel: "Log reject",
    onSave: async () => {
      const key = document.getElementById("rejectItemSelect").value;
      const staffId = document.getElementById("rejectStaffSelect").value;
      if (!key) return alert("Select which item was spoiled.");
      if (!staffId) return alert("Select which staff member this reject is attributed to.");

      const option = itemOptions.find(o => o.key === key);
      const qty = Math.max(1, Number(document.getElementById("rejectQtyInput").value) || 1);
      const reason = document.getElementById("rejectReasonSelect").value;
      const staffMember = staff.find(s => s.id === Number(staffId));
      const notes = document.getElementById("rejectNotesInput").value.trim();

      const record = {
        date: new Date().toISOString(),
        itemName: option.item.name,
        qty,
        reason,
        staffId: staffMember.id,
        staffName: staffMember.name,
        notes,
        cost: Number(option.item.price || 0) * qty,
        materials: option.item.materials || []
      };

      const id = await dbPut("rejects", record);
      record.id = id;

      // The material really was used up, even though nothing sold —
      // same deduction helper the checkout flow uses.
      for (const material of record.materials) {
        const totalUsed = Number(material.qty || 0) * qty;
        if (totalUsed > 0) await adjustInventoryQty(material.inventoryId, -totalUsed);
      }

      closeModal();
      renderRejects();
      renderInventoryTable();
      renderDashboard();
    }
  });
}

// Deleting a logged reject returns its materials to stock, exactly like
// deleting an invoice does — same reasoning: the deduction only makes
// sense while the record exists.
async function deleteReject(id) {
  const reject = rejectsCache.find(r => r.id === id);
  if (!reject) return;

  if (!(await authorizePin(`delete reject record for ${reject.itemName}`))) return;

  const warning = reject.rejectPaid
    ? `This reject was already deducted in a payroll run — deleting it here won't change that payslip. Delete anyway?`
    : `Delete this reject record? Its materials will be returned to stock.`;
  if (!confirm(warning)) return;

  for (const material of reject.materials || []) {
    const totalUsed = Number(material.qty || 0) * Number(reject.qty || 1);
    if (totalUsed > 0) await adjustInventoryQty(material.inventoryId, totalUsed);
  }

  await dbDelete("rejects", id);
  renderRejects();
  renderInventoryTable();
}
