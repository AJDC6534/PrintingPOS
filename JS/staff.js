/***********************************
 * STAFF & COMMISSION
 * Payroll (payroll.js) builds on the salary fields set here, and reuses
 * calculateInvoiceCommission() so "what a payslip pays" and "what this
 * report shows" can never drift apart into two different numbers.
 ***********************************/

let staffCache = [];

async function renderStaffPage() {
  staffCache = await dbGetAll("staff");
  renderStaffTable();
  await renderCommissionStaffSelect();

  const from = document.getElementById("commissionFrom");
  const to = document.getElementById("commissionTo");
  if (!from.value) from.value = todayStr();
  if (!to.value) to.value = todayStr();

  if (typeof renderPayrollPage === "function") await renderPayrollPage();
  if (typeof renderAdjustmentsPage === "function") await renderAdjustmentsPage();
  if (typeof renderLedgerStaffSelect === "function") await renderLedgerStaffSelect();
}

function totalSalaryComponents(staff) {
  return Number(staff.basicSalary || 0) + Number(staff.accommodation || 0) + Number(staff.transportation || 0);
}

function salaryTypeLabel(staff) {
  if (!staff.salaryType || staff.salaryType === "None") return "Commission only";
  const total = totalSalaryComponents(staff);
  if (staff.salaryType === "Monthly") return `${money(total)}/month`;
  if (staff.salaryType === "SemiMonthly") return `${money(total)}/cutoff`;
  if (staff.salaryType === "Weekly") return `${money(total)}/week`;
  if (staff.salaryType === "Daily") return `${money(total)}/day`;
  return "—";
}

function renderStaffTable() {
  const tbody = document.querySelector("#staffTable tbody");
  if (!staffCache.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No staff yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = staffCache.map(s => `
    <tr>
      <td>${escapeHtml(s.name)} ${s.isManager ? `<span class="pill pill-paid">Manager</span>` : ""}</td>
      <td>${escapeHtml(s.position || "—")}</td>
      <td>${salaryTypeLabel(s)}</td>
      <td>${s.active !== false ? "Yes" : "No"}</td>
      <td>
        <button class="btn btn-sm" onclick="openStaffModal(${s.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteStaffMember(${s.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

function openStaffModal(id = null) {
  const existing = id ? staffCache.find(s => s.id === id) : null;
  const salaryType = existing?.salaryType || "None";
  const commonPositions = ["Cashier", "Designer", "Printer Operator", "Machine Operator", "Sales", "Manager"];
  const existingPosition = existing?.position || "";
  const isOtherPosition = existingPosition && !commonPositions.includes(existingPosition);

  // Backward compatibility: staff saved before the salary breakdown existed
  // only have a single `salaryAmount` — treat that as their Basic Salary
  // rather than losing it or forcing a re-entry.
  const existingBasic = existing?.basicSalary ?? existing?.salaryAmount ?? "";
  const existingAccommodation = existing?.accommodation ?? "";
  const existingTransport = existing?.transportation ?? "";

  showModal({
    title: existing ? "Edit staff" : "New staff",
    bodyHtml: `
      <label class="field-label">Name</label>
      <input type="text" id="staffNameInput" value="${existing ? escapeHtml(existing.name) : ""}">

      <label class="field-label" style="margin-top:10px;">Position</label>
      <select id="staffPositionSelect" onchange="toggleStaffPositionOtherField()">
        <option value="" disabled ${!existingPosition ? "selected" : ""}>-- Select position --</option>
        ${commonPositions.map(p => `<option value="${p}" ${existingPosition === p ? "selected" : ""}>${p}</option>`).join("")}
        <option value="__other__" ${isOtherPosition ? "selected" : ""}>Other...</option>
      </select>
      <input type="text" id="staffPositionOtherInput" placeholder="Enter position" style="margin-top:8px;${isOtherPosition ? "" : "display:none;"}" value="${isOtherPosition ? escapeHtml(existingPosition) : ""}">

      <label class="field-label" style="margin-top:10px;">Pay basis</label>
      <select id="staffSalaryTypeInput" onchange="toggleStaffSalaryAmountField()">
        <option value="None" ${salaryType === "None" ? "selected" : ""}>Commission only (no fixed salary)</option>
        <option value="Monthly" ${salaryType === "Monthly" ? "selected" : ""}>Monthly salary</option>
        <option value="SemiMonthly" ${salaryType === "SemiMonthly" ? "selected" : ""}>Semi-monthly (per cutoff)</option>
        <option value="Weekly" ${salaryType === "Weekly" ? "selected" : ""}>Weekly rate</option>
        <option value="Daily" ${salaryType === "Daily" ? "selected" : ""}>Daily rate</option>
      </select>

      <div id="staffSalaryAmountWrap" style="margin-top:10px;${salaryType === "None" ? "display:none;" : ""}">
        <label class="field-label" id="staffSalaryAmountLabel">Salary breakdown (per period above)</label>
        <div class="field-row">
          <div>
            <label class="field-label" style="font-weight:400;">Basic salary</label>
            <input type="number" id="staffBasicInput" min="0" step="0.01" value="${existingBasic}">
          </div>
          <div>
            <label class="field-label" style="font-weight:400;">Accommodation</label>
            <input type="number" id="staffAccommodationInput" min="0" step="0.01" value="${existingAccommodation}">
          </div>
          <div>
            <label class="field-label" style="font-weight:400;">Transportation</label>
            <input type="number" id="staffTransportInput" min="0" step="0.01" value="${existingTransport}">
          </div>
        </div>
        <p style="font-size:12px;color:var(--ink-soft);margin:4px 0 0;">Basic salary and transportation are prorated by days in the pay period. Accommodation is fixed — it's paid in full regardless of days, and can still be excluded on any individual payroll run (e.g. if you're providing housing directly that period instead of paying cash for it).</p>
      </div>

      <label class="field-label" style="margin-top:10px;">
        <input type="checkbox" id="staffManagerInput" ${existing?.isManager ? "checked" : ""} style="width:auto;" onchange="toggleManagerPinRequirement()"> Manager (can delete/remove records — invoices, staff, everything)
      </label>

      <label class="field-label" style="margin-top:10px;" id="staffPinLabel">PIN ${existing?.isManager ? "(required — this person is a Manager)" : "(optional — locks operator switching)"}</label>
      <input type="text" id="staffPinInput" inputmode="numeric" maxlength="6" placeholder="e.g. 1234" value="${existing?.pin || ""}">

      <label class="field-label" style="margin-top:10px;">
        <input type="checkbox" id="staffActiveInput" ${!existing || existing.active !== false ? "checked" : ""} style="width:auto;"> Active (shows up at checkout)
      </label>
    `,
    saveLabel: "Save staff",
    onSave: async () => {
      const name = document.getElementById("staffNameInput").value.trim();
      const active = document.getElementById("staffActiveInput").checked;
      const isManager = document.getElementById("staffManagerInput").checked;
      const positionSelect = document.getElementById("staffPositionSelect").value;
      const position = positionSelect === "__other__" ? document.getElementById("staffPositionOtherInput").value.trim() : positionSelect;
      const salaryTypeVal = document.getElementById("staffSalaryTypeInput").value;
      const basicSalary = Number(document.getElementById("staffBasicInput").value) || 0;
      const accommodation = Number(document.getElementById("staffAccommodationInput").value) || 0;
      const transportation = Number(document.getElementById("staffTransportInput").value) || 0;
      const pin = document.getElementById("staffPinInput").value.trim();
      if (!name) return alert("Enter a name.");
      if (!position) return alert("Select (or enter) a position.");
      if (salaryTypeVal !== "None" && basicSalary <= 0) return alert("Enter a basic salary, or set pay basis to commission only.");
      if (pin && !/^\d{4,6}$/.test(pin)) return alert("PIN must be 4-6 digits, or leave it blank.");
      if (isManager && !pin) return alert("A Manager must have a PIN set, so they can actually authorize restricted actions.");

      const record = existing
        ? { ...existing, name, position, active, isManager, salaryType: salaryTypeVal, basicSalary, accommodation, transportation, pin }
        : { name, position, active, isManager, salaryType: salaryTypeVal, basicSalary, accommodation, transportation, pin };
      await dbPut("staff", record);
      anyStaffExist = true;
      closeModal();
      renderStaffPage();
    }
  });

  updateSalaryAmountLabel(salaryType);
}

function toggleManagerPinRequirement() {
  const isManager = document.getElementById("staffManagerInput").checked;
  const label = document.getElementById("staffPinLabel");
  if (label) label.textContent = isManager ? "PIN (required — this person is a Manager)" : "PIN (optional — locks operator switching)";
}

function toggleStaffPositionOtherField() {
  const select = document.getElementById("staffPositionSelect");
  const otherInput = document.getElementById("staffPositionOtherInput");
  otherInput.style.display = select.value === "__other__" ? "block" : "none";
}

function toggleStaffSalaryAmountField() {
  const type = document.getElementById("staffSalaryTypeInput").value;
  const wrap = document.getElementById("staffSalaryAmountWrap");
  wrap.style.display = type === "None" ? "none" : "block";
  updateSalaryAmountLabel(type);
}

function updateSalaryAmountLabel(type) {
  const label = document.getElementById("staffSalaryAmountLabel");
  if (!label) return;
  const labels = {
    Daily: "Daily breakdown", Weekly: "Weekly breakdown",
    SemiMonthly: "Per-cutoff breakdown (paid twice a month)", Monthly: "Monthly breakdown"
  };
  label.textContent = labels[type] || "Salary breakdown (per period above)";
}

async function deleteStaffMember(id) {
  if (!(await authorizePin("delete a staff member"))) return;
  if (!confirm("Delete this staff member?")) return;
  await dbDelete("staff", id);
  anyStaffExist = (await dbGetAll("staff")).length > 0;
  renderStaffPage();
}

async function renderCommissionStaffSelect() {
  const select = document.getElementById("commissionStaffSelect");
  select.innerHTML = `<option value="">-- All staff --</option>` +
    staffCache.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
}

// Shared by the ad-hoc report below AND payroll.js, so a payslip's
// commission number and this report's number are always the same math.
function calculateInvoiceCommission(inv) {
  return (inv.items || []).reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 0) * (Number(item.commission || 0) / 100)), 0);
}

async function renderCommissionReport() {
  const staffId = document.getElementById("commissionStaffSelect").value;
  const from = document.getElementById("commissionFrom").value;
  const to = document.getElementById("commissionTo").value;

  const history = await dbGetAll("history");

  const matching = history.filter(inv => {
    const invDate = (inv.date || "").slice(0, 10);
    const inRange = invDate >= from && invDate <= to;
    const staffMatch = !staffId || Number(inv.staffId) === Number(staffId);
    return inRange && staffMatch && !inv.refunded;
  });

  const rows = matching.map(inv => ({
    invoiceNo: inv.invoiceNo,
    staffName: inv.staffName,
    date: inv.date,
    commission: calculateInvoiceCommission(inv),
    paidOut: !!inv.commissionPaid
  })).filter(r => r.commission > 0);

  const total = rows.reduce((sum, r) => sum + r.commission, 0);
  const totalUnpaid = rows.filter(r => !r.paidOut).reduce((sum, r) => sum + r.commission, 0);

  const box = document.getElementById("commissionResult");
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state">No commission earned in this range.</div>`;
    return;
  }

  box.innerHTML = `
    <table class="simple-table">
      <thead><tr><th>Invoice</th><th>Staff</th><th>Date</th><th>Commission</th><th>Payroll status</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.invoiceNo}</td><td>${escapeHtml(r.staffName)}</td><td>${new Date(r.date).toLocaleDateString()}</td>
            <td class="money">${money(r.commission)}</td>
            <td><span class="pill ${r.paidOut ? "pill-paid" : "pill-balance"}">${r.paidOut ? "Paid out" : "Not yet paid"}</span></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="cart-totals-row grand" style="margin-top:10px;"><span>Total commission</span><span class="money">${money(total)}</span></div>
    <div class="cart-totals-row"><span>Not yet included in a payroll run</span><span class="money">${money(totalUnpaid)}</span></div>
  `;
}
