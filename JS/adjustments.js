/***********************************
 * ADJUSTMENTS — advances, bonuses, deductions
 * Logged whenever they happen (e.g. someone asks for a cash advance
 * today), not just during a payroll run. Each stays "Open" until a
 * payroll run includes it, at which point it's marked "Used" and
 * linked to that run — so it can never be paid out twice, and you
 * can always trace which payslip an advance was recovered from.
 ***********************************/

let adjustmentsCache = [];
let adjustmentsViewFilter = "open";
const ADJUSTMENT_CATEGORY_DEFAULTS = { Advance: "Cash Advance", Bonus: "Bonus", Deduction: "Other" };

async function renderAdjustmentsPage() {
  adjustmentsCache = (await dbGetAll("adjustments")).sort((a, b) => new Date(b.date) - new Date(a.date));
  renderAdjustmentsTable();
}

function setAdjustmentsView(view) {
  adjustmentsViewFilter = view;
  document.querySelectorAll("[data-adj-view]").forEach(btn => btn.classList.toggle("btn-primary", btn.dataset.adjView === view));
  renderAdjustmentsTable();
}

function renderAdjustmentsTable() {
  const tbody = document.querySelector("#adjustmentsTable tbody");
  if (!tbody) return;

  let rows = adjustmentsCache;
  if (adjustmentsViewFilter === "open") rows = rows.filter(r => r.status !== "Used");
  if (adjustmentsViewFilter === "used") rows = rows.filter(r => r.status === "Used");

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${adjustmentsViewFilter === "used" ? "No entries have been used in payroll yet." : "No open advances, bonuses, or deductions."}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${escapeHtml(r.staffName)}</td>
      <td><span class="pill ${r.type === "Bonus" ? "pill-paid" : "pill-unpaid"}">${r.type}</span></td>
      <td>${escapeHtml(r.category)}</td>
      <td class="money">${money(r.amount)}</td>
      <td>${r.status === "Used" ? `<span class="pill pill-balance">Used in ${escapeHtml(r.usedPayrollLabel || "payroll")}</span>` : `<span class="pill pill-unpaid">Open</span>`}${r.notes ? `<br><small style="color:var(--ink-soft);">${escapeHtml(r.notes)}</small>` : ""}</td>
      <td>${r.status !== "Used" ? `<button class="btn btn-sm btn-danger" onclick="deleteAdjustment(${r.id})">Delete</button>` : ""}</td>
    </tr>
  `).join("");
}

async function openAdjustmentModal() {
  if (!staffCache.length) return alert("Add a staff member first.");

  showModal({
    title: "Log advance / bonus / deduction",
    bodyHtml: `
      <div class="field-row">
        <div>
          <label class="field-label">Staff</label>
          <select id="adjStaffSelect">
            ${staffCache.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="field-label">Date</label>
          <input type="date" id="adjDate" value="${todayStr()}">
        </div>
      </div>
      <div class="field-row">
        <div>
          <label class="field-label">Type</label>
          <select id="adjType" onchange="document.getElementById('adjCategory').value = ({Advance:'Cash Advance',Bonus:'Bonus',Deduction:'Other'})[this.value]">
            <option value="Advance">Cash advance (money given out now)</option>
            <option value="Deduction">Deduction (e.g. late, absence)</option>
            <option value="Bonus">Bonus</option>
          </select>
        </div>
        <div>
          <label class="field-label">Category</label>
          <input type="text" id="adjCategory" value="Cash Advance">
        </div>
      </div>
      <label class="field-label">Amount</label>
      <input type="number" id="adjAmount" min="0" step="0.01">
      <label class="field-label" style="margin-top:10px;">Notes (optional)</label>
      <input type="text" id="adjNotes" placeholder="e.g. requested for Eid">
    `,
    saveLabel: "Log entry",
    onSave: async () => {
      const staffId = Number(document.getElementById("adjStaffSelect").value);
      const staff = staffCache.find(s => s.id === staffId);
      const date = document.getElementById("adjDate").value || todayStr();
      const type = document.getElementById("adjType").value;
      const category = document.getElementById("adjCategory").value.trim() || ADJUSTMENT_CATEGORY_DEFAULTS[type];
      const amount = Number(document.getElementById("adjAmount").value);
      const notes = document.getElementById("adjNotes").value.trim();

      if (!amount || amount <= 0) return alert("Enter an amount greater than 0.");

      await dbPut("adjustments", {
        staffId, staffName: staff.name, date, type, category, amount, notes,
        status: "Open", createdAt: new Date().toISOString()
      });

      closeModal();
      await renderAdjustmentsPage();
    }
  });
}

async function deleteAdjustment(id) {
  const record = adjustmentsCache.find(r => r.id === id);
  if (!record) return;
  if (!(await authorizePin(`delete ${record.type.toLowerCase()} entry for ${record.staffName}`))) return;
  if (!confirm(`Delete this ${record.type.toLowerCase()} entry for ${record.staffName}?`)) return;

  await dbDelete("adjustments", id);
  await renderAdjustmentsPage();
}

// Only OPEN entries in range — same "not already used" pattern as
// commission and rejects, so nothing can be paid out twice.
async function getOpenAdjustmentsForStaffPeriod(staffId, from, to) {
  const all = await dbGetAll("adjustments");
  return all.filter(r =>
    Number(r.staffId) === Number(staffId) &&
    r.status !== "Used" &&
    r.date >= from && r.date <= to
  );
}
