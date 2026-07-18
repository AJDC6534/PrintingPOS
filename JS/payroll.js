/***********************************
 * PAYROLL
 * A payroll run = base salary for the period + unpaid commission earned
 * in that period + any pre-logged advances/bonuses/deductions for that
 * staff/period (from adjustments.js) + any quick one-off lines you add
 * right here, minus any rejects (mistakes) attributed to them. Rejects
 * and pre-logged adjustments are auto-found but shown as checklists,
 * not force-included — not every mistake or advance should count (a
 * machine fault isn't the operator's fault; an advance might've
 * already been settled another way). Finalizing marks whatever's
 * included as used/paid, so a second run can never double-count any
 * of it — and deleting a run releases all of it back to "unpaid".
 ***********************************/

let payrollCache = [];
let payrollAdjustmentsTemp = [];
let payrollRejectSelection = {}; // { [rejectId]: true/false }
let payrollOpenAdjustmentSelection = {}; // { [adjustmentId]: true/false }
let payrollCalcCache = { salaryBreakdown: { basic: 0, accommodation: 0, transportation: 0 }, commission: 0, invoiceNos: [], rejects: [], openAdjustments: [] };
let payrollSalaryComponentSelection = { accommodation: true, transportation: true };

function daysInclusive(from, to) {
  const ms = new Date(to) - new Date(from);
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.round(ms / 86400000) + 1;
}

function proratedFactor(staff, from, to) {
  const days = daysInclusive(from, to);
  if (!staff || days <= 0) return 0;
  if (staff.salaryType === "Monthly") return days / 30;
  if (staff.salaryType === "SemiMonthly") return days / 15;
  if (staff.salaryType === "Weekly") return days / 7;
  if (staff.salaryType === "Daily") return days;
  return 0;
}

// Returns the three salary components for the period. Basic and
// Transportation are prorated by days in the period (like the pay
// basis always was); Accommodation is a FIXED amount — it doesn't
// scale with days, since housing cost doesn't change based on how
// many days were worked in the cutoff. Old staff records that only
// ever had a single `salaryAmount` are treated as Basic-only, so
// nothing from before this breakdown existed gets silently dropped.
function computeSalaryBreakdown(staff, from, to) {
  const factor = proratedFactor(staff, from, to);
  const basic = Number(staff?.basicSalary ?? staff?.salaryAmount ?? 0) * factor;
  const accommodation = Number(staff?.accommodation || 0); // fixed — not multiplied by factor
  const transportation = Number(staff?.transportation || 0) * factor;
  return { basic, accommodation, transportation };
}

// Only commission NOT already paid out in a previous run — this is what
// stops a payroll run from double-paying commission that was already
// settled last time.
async function getUnpaidCommissionForStaffPeriod(staffId, from, to) {
  const history = await dbGetAll("history");
  const matches = history.filter(inv =>
    Number(inv.staffId) === Number(staffId) &&
    !inv.commissionPaid &&
    !inv.refunded &&
    (inv.date || "").slice(0, 10) >= from &&
    (inv.date || "").slice(0, 10) <= to
  );

  let total = 0;
  const invoiceNos = [];
  matches.forEach(inv => {
    const c = calculateInvoiceCommission(inv);
    if (c > 0) { total += c; invoiceNos.push(inv.invoiceNo); }
  });
  return { total, invoiceNos };
}

// Same idea, but for rejects: only ones not already deducted in a past run.
async function getUnpaidRejectsForStaffPeriod(staffId, from, to) {
  const rejects = await dbGetAll("rejects");
  return rejects.filter(r =>
    Number(r.staffId) === Number(staffId) &&
    !r.rejectPaid &&
    (r.date || "").slice(0, 10) >= from &&
    (r.date || "").slice(0, 10) <= to
  );
}

async function renderPayrollPage() {
  payrollCache = (await dbGetAll("payroll")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderPayrollHistoryTable();
}

function renderPayrollHistoryTable() {
  const tbody = document.querySelector("#payrollHistoryTable tbody");
  if (!tbody) return;

  if (!payrollCache.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No payroll runs yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = payrollCache.map(r => `
    <tr>
      <td>${escapeHtml(r.staffName)}</td>
      <td>${r.periodFrom} → ${r.periodTo}</td>
      <td class="money">${money(r.basePay)}</td>
      <td class="money">${money(r.commission)}</td>
      <td class="money">${(r.rejectDeduction || 0) > 0 ? "-" + money(r.rejectDeduction) : money(0)}</td>
      <td class="money">${money(r.netPay)}</td>
      <td>
        <button class="btn btn-sm" onclick="viewPayslip(${r.id})">View / Print</button>
        <button class="btn btn-sm btn-danger" onclick="deletePayrollRun(${r.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

async function openPayrollRunModal() {
  if (!staffCache.length) return alert("Add a staff member first.");
  payrollAdjustmentsTemp = [];
  payrollRejectSelection = {};
  payrollOpenAdjustmentSelection = {};
  payrollSalaryComponentSelection = { accommodation: true, transportation: true };

  const defaultFrom = todayStr().slice(0, 8) + "01";
  const defaultTo = todayStr();

  showModal({
    title: "Run payroll",
    wide: true,
    bodyHtml: `
      <div class="field-row">
        <div>
          <label class="field-label">Staff</label>
          <select id="payrollRunStaffSelect" onchange="refreshPayrollCalculation()">
            ${staffCache.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="field-label">Period from</label>
          <input type="date" id="payrollRunFrom" value="${defaultFrom}" onchange="refreshPayrollCalculation()">
        </div>
        <div>
          <label class="field-label">Period to</label>
          <input type="date" id="payrollRunTo" value="${defaultTo}" onchange="refreshPayrollCalculation()">
        </div>
      </div>

      <div class="card" id="payrollCalcSummary" style="background:var(--paper);"></div>

      <label class="field-label" style="margin-top:14px;">Salary breakdown for this period</label>
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px;">Basic and Transportation are prorated by days; Accommodation is a fixed amount. Untick Accommodation or Transportation if you're covering that directly this period instead of paying it in cash.</p>
      <div class="checklist-box" id="payrollSalaryBreakdown"></div>

      <label class="field-label" style="margin-top:14px;">Reject deductions found for this staff & period</label>
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px;">Ticked by default. Untick anything that wasn't really their fault.</p>
      <div class="checklist-box" id="payrollRejectsChecklist"></div>

      <label class="field-label" style="margin-top:14px;">Advances / bonuses / deductions logged for this staff & period</label>
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px;">From the Advances & Deductions log. Ticked by default.</p>
      <div class="checklist-box" id="payrollOpenAdjustmentsChecklist"></div>

      <label class="field-label" style="margin-top:14px;">Quick one-off bonus / deduction (not saved to the log)</label>
      <div class="field-row">
        <input type="text" id="payrollAdjLabel" placeholder="e.g. Eid bonus">
        <input type="number" id="payrollAdjAmount" placeholder="Amount" min="0" step="0.01">
        <select id="payrollAdjType">
          <option value="bonus">Bonus (adds to pay)</option>
          <option value="deduction">Deduction (subtracts from pay)</option>
        </select>
        <button class="btn" onclick="addPayrollAdjustment()">+ Add line</button>
      </div>
      <div id="payrollAdjustmentsList"></div>

      <div class="cart-totals" id="payrollNetPayBox"></div>
    `,
    saveLabel: "Finalize payroll",
    onSave: savePayrollRun
  });

  await refreshPayrollCalculation();
}

async function refreshPayrollCalculation() {
  const staffId = document.getElementById("payrollRunStaffSelect")?.value;
  const from = document.getElementById("payrollRunFrom")?.value;
  const to = document.getElementById("payrollRunTo")?.value;
  if (!staffId || !from || !to) return;

  const staff = staffCache.find(s => s.id === Number(staffId));
  const salaryBreakdown = computeSalaryBreakdown(staff, from, to);
  const { total: commission, invoiceNos } = await getUnpaidCommissionForStaffPeriod(staffId, from, to);
  const rejects = await getUnpaidRejectsForStaffPeriod(staffId, from, to);
  const openAdjustments = await getOpenAdjustmentsForStaffPeriod(staffId, from, to);

  payrollCalcCache = { salaryBreakdown, commission, invoiceNos, rejects, openAdjustments };

  // Default every found reject/adjustment to "included" unless the person
  // already toggled it this session (e.g. changing the date range shouldn't
  // silently re-tick something they just unticked for a still-visible row).
  const nextRejectSelection = {};
  rejects.forEach(r => {
    nextRejectSelection[r.id] = Object.prototype.hasOwnProperty.call(payrollRejectSelection, r.id)
      ? payrollRejectSelection[r.id]
      : true;
  });
  payrollRejectSelection = nextRejectSelection;

  const nextAdjSelection = {};
  openAdjustments.forEach(a => {
    nextAdjSelection[a.id] = Object.prototype.hasOwnProperty.call(payrollOpenAdjustmentSelection, a.id)
      ? payrollOpenAdjustmentSelection[a.id]
      : true;
  });
  payrollOpenAdjustmentSelection = nextAdjSelection;

  const summary = document.getElementById("payrollCalcSummary");
  if (summary) {
    summary.innerHTML = `
      <div class="cart-totals-row"><span>Pay basis</span><span>${salaryTypeLabel(staff)} • ${daysInclusive(from, to)} day(s) in period</span></div>
      <div class="cart-totals-row"><span>Unpaid commission (${invoiceNos.length} invoice(s))</span><span class="money">${money(commission)}</span></div>
    `;
  }

  renderPayrollSalaryBreakdown();
  renderPayrollRejectsChecklist();
  renderPayrollOpenAdjustmentsChecklist();
  renderPayrollNetPay();
}

function renderPayrollSalaryBreakdown() {
  const box = document.getElementById("payrollSalaryBreakdown");
  if (!box) return;

  const { basic, accommodation, transportation } = payrollCalcCache.salaryBreakdown;

  const rows = [`
    <div class="check-row is-checked" style="grid-template-columns:auto 1fr auto;">
      <input type="checkbox" checked disabled title="Basic salary is always included">
      <span>Basic salary</span>
      <span class="money">${money(basic)}</span>
    </div>
  `];

  if (accommodation > 0) {
    const checked = payrollSalaryComponentSelection.accommodation !== false;
    rows.push(`
      <label class="check-row ${checked ? "is-checked" : ""}" style="grid-template-columns:auto 1fr auto;">
        <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleSalaryComponent('accommodation', this.checked)">
        <span>Accommodation</span>
        <span class="money">${money(accommodation)}</span>
      </label>
    `);
  }

  if (transportation > 0) {
    const checked = payrollSalaryComponentSelection.transportation !== false;
    rows.push(`
      <label class="check-row ${checked ? "is-checked" : ""}" style="grid-template-columns:auto 1fr auto;">
        <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleSalaryComponent('transportation', this.checked)">
        <span>Transportation</span>
        <span class="money">${money(transportation)}</span>
      </label>
    `);
  }

  box.innerHTML = rows.join("");
}

function toggleSalaryComponent(component, checked) {
  payrollSalaryComponentSelection[component] = checked;
  renderPayrollSalaryBreakdown();
  renderPayrollNetPay();
}

function getSelectedSalaryTotal() {
  const { basic, accommodation, transportation } = payrollCalcCache.salaryBreakdown;
  const includedAccommodation = payrollSalaryComponentSelection.accommodation !== false ? accommodation : 0;
  const includedTransportation = payrollSalaryComponentSelection.transportation !== false ? transportation : 0;
  return basic + includedAccommodation + includedTransportation;
}

function renderPayrollRejectsChecklist() {
  const box = document.getElementById("payrollRejectsChecklist");
  if (!box) return;

  const rejects = payrollCalcCache.rejects || [];

  box.innerHTML = rejects.length
    ? rejects.map(r => {
        const checked = payrollRejectSelection[r.id] !== false;
        return `
          <label class="check-row ${checked ? "is-checked" : ""}" style="grid-template-columns:auto 1fr auto;">
            <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleRejectDeduction(${r.id}, this.checked)">
            <span>${escapeHtml(r.itemName)} × ${r.qty} <small style="color:var(--ink-soft);">— ${escapeHtml(r.reason)} • ${new Date(r.date).toLocaleDateString()}</small></span>
            <span class="money">${money(r.cost)}</span>
          </label>
        `;
      }).join("")
    : `<div class="empty-state">No rejects logged for this staff member in this period.</div>`;
}

function toggleRejectDeduction(rejectId, checked) {
  payrollRejectSelection[rejectId] = checked;
  renderPayrollRejectsChecklist();
  renderPayrollNetPay();
}

function getSelectedRejectDeductionTotal() {
  return (payrollCalcCache.rejects || [])
    .filter(r => payrollRejectSelection[r.id] !== false)
    .reduce((sum, r) => sum + Number(r.cost || 0), 0);
}

function renderPayrollOpenAdjustmentsChecklist() {
  const box = document.getElementById("payrollOpenAdjustmentsChecklist");
  if (!box) return;

  const adjustments = payrollCalcCache.openAdjustments || [];

  box.innerHTML = adjustments.length
    ? adjustments.map(a => {
        const checked = payrollOpenAdjustmentSelection[a.id] !== false;
        const isCredit = a.type === "Bonus";
        return `
          <label class="check-row ${checked ? "is-checked" : ""}" style="grid-template-columns:auto 1fr auto;">
            <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleOpenAdjustment(${a.id}, this.checked)">
            <span>${escapeHtml(a.category)} <span class="pill ${isCredit ? "pill-paid" : "pill-unpaid"}">${a.type}</span> <small style="color:var(--ink-soft);">— ${a.date}${a.notes ? " • " + escapeHtml(a.notes) : ""}</small></span>
            <span class="money">${isCredit ? "+" : "-"}${money(a.amount)}</span>
          </label>
        `;
      }).join("")
    : `<div class="empty-state">Nothing logged for this staff member in this period.</div>`;
}

function toggleOpenAdjustment(adjustmentId, checked) {
  payrollOpenAdjustmentSelection[adjustmentId] = checked;
  renderPayrollOpenAdjustmentsChecklist();
  renderPayrollNetPay();
}

function getSelectedOpenAdjustmentTotals() {
  const included = (payrollCalcCache.openAdjustments || []).filter(a => payrollOpenAdjustmentSelection[a.id] !== false);
  const credit = included.filter(a => a.type === "Bonus").reduce((sum, a) => sum + Number(a.amount || 0), 0);
  const debit = included.filter(a => a.type !== "Bonus").reduce((sum, a) => sum + Number(a.amount || 0), 0);
  return { credit, debit, included };
}

function renderPayrollAdjustmentsList() {
  const box = document.getElementById("payrollAdjustmentsList");
  if (!box) return;

  box.innerHTML = payrollAdjustmentsTemp.length
    ? payrollAdjustmentsTemp.map((a, i) => `
        <div class="cart-totals-row">
          <span>${escapeHtml(a.label)} <span class="pill ${a.type === "bonus" ? "pill-paid" : "pill-unpaid"}">${a.type}</span></span>
          <span>
            <span class="money">${a.type === "deduction" ? "-" : "+"}${money(a.amount)}</span>
            <button class="btn btn-sm btn-icon" onclick="removePayrollAdjustment(${i})">✕</button>
          </span>
        </div>
      `).join("")
    : "";
}

function addPayrollAdjustment() {
  const label = document.getElementById("payrollAdjLabel").value.trim();
  const amount = Number(document.getElementById("payrollAdjAmount").value);
  const type = document.getElementById("payrollAdjType").value;

  if (!label || !(amount > 0)) return alert("Enter a label and an amount greater than 0.");

  payrollAdjustmentsTemp.push({ label, amount, type });
  document.getElementById("payrollAdjLabel").value = "";
  document.getElementById("payrollAdjAmount").value = "";

  renderPayrollAdjustmentsList();
  renderPayrollNetPay();
}

function removePayrollAdjustment(index) {
  payrollAdjustmentsTemp.splice(index, 1);
  renderPayrollAdjustmentsList();
  renderPayrollNetPay();
}

function renderPayrollNetPay() {
  const box = document.getElementById("payrollNetPayBox");
  if (!box) return;

  const bonuses = payrollAdjustmentsTemp.filter(a => a.type === "bonus").reduce((s, a) => s + a.amount, 0);
  const deductions = payrollAdjustmentsTemp.filter(a => a.type === "deduction").reduce((s, a) => s + a.amount, 0);
  const rejectDeduction = getSelectedRejectDeductionTotal();
  const { credit: adjCredit, debit: adjDebit } = getSelectedOpenAdjustmentTotals();
  const salaryTotal = getSelectedSalaryTotal();
  const netPay = salaryTotal + payrollCalcCache.commission + bonuses + adjCredit - deductions - adjDebit - rejectDeduction;

  box.innerHTML = `
    <div class="cart-totals-row"><span>Salary (selected above)</span><span class="money">${money(salaryTotal)}</span></div>
    <div class="cart-totals-row"><span>Commission</span><span class="money">+${money(payrollCalcCache.commission)}</span></div>
    <div class="cart-totals-row"><span>Reject deductions</span><span class="money">-${money(rejectDeduction)}</span></div>
    <div class="cart-totals-row"><span>Logged advances/deductions</span><span class="money">-${money(adjDebit)}</span></div>
    <div class="cart-totals-row"><span>Logged bonuses</span><span class="money">+${money(adjCredit)}</span></div>
    <div class="cart-totals-row"><span>Quick bonuses</span><span class="money">+${money(bonuses)}</span></div>
    <div class="cart-totals-row"><span>Quick deductions</span><span class="money">-${money(deductions)}</span></div>
    <div class="cart-totals-row grand"><span>Net pay</span><span class="money">${money(netPay)}</span></div>
  `;
}

async function savePayrollRun() {
  const staffId = Number(document.getElementById("payrollRunStaffSelect").value);
  const from = document.getElementById("payrollRunFrom").value;
  const to = document.getElementById("payrollRunTo").value;
  const staff = staffCache.find(s => s.id === staffId);

  const bonuses = payrollAdjustmentsTemp.filter(a => a.type === "bonus").reduce((s, a) => s + a.amount, 0);
  const deductions = payrollAdjustmentsTemp.filter(a => a.type === "deduction").reduce((s, a) => s + a.amount, 0);
  const includedRejects = (payrollCalcCache.rejects || []).filter(r => payrollRejectSelection[r.id] !== false);
  const rejectDeduction = includedRejects.reduce((sum, r) => sum + Number(r.cost || 0), 0);
  const { credit: adjCredit, debit: adjDebit, included: includedAdjustments } = getSelectedOpenAdjustmentTotals();

  const { basic, accommodation, transportation } = payrollCalcCache.salaryBreakdown;
  const accommodationIncluded = payrollSalaryComponentSelection.accommodation !== false;
  const transportationIncluded = payrollSalaryComponentSelection.transportation !== false;
  const salaryTotal = getSelectedSalaryTotal();
  const netPay = salaryTotal + payrollCalcCache.commission + bonuses + adjCredit - deductions - adjDebit - rejectDeduction;

  const record = {
    staffId,
    staffName: staff.name,
    periodFrom: from,
    periodTo: to,
    basicPay: basic,
    accommodationPay: accommodation,
    accommodationIncluded,
    transportationPay: transportation,
    transportationIncluded,
    basePay: salaryTotal, // kept for backward compatibility with anything reading a single total
    commission: payrollCalcCache.commission,
    commissionInvoiceNos: payrollCalcCache.invoiceNos,
    rejectDeduction,
    includedRejectIds: includedRejects.map(r => r.id),
    rejectSummary: includedRejects.map(r => ({ itemName: r.itemName, qty: r.qty, reason: r.reason, cost: r.cost })),
    includedAdjustmentIds: includedAdjustments.map(a => a.id),
    adjustmentSummary: includedAdjustments.map(a => ({ type: a.type, category: a.category, amount: a.amount, notes: a.notes })),
    adjustments: [...payrollAdjustmentsTemp],
    netPay,
    createdAt: new Date().toISOString()
  };

  const id = await dbPut("payroll", record);
  record.id = id;

  // Lock in the commission this run just paid, so the next run can't pay it again.
  for (const invoiceNo of record.commissionInvoiceNos) {
    const inv = await dbGet("history", invoiceNo);
    if (inv) { inv.commissionPaid = true; await dbPut("history", inv); }
  }

  // Same lock, for whichever rejects were actually included.
  for (const rejectId of record.includedRejectIds) {
    const reject = await dbGet("rejects", rejectId);
    if (reject) { reject.rejectPaid = true; await dbPut("rejects", reject); }
  }

  // Same lock, for whichever pre-logged advances/bonuses/deductions were included.
  for (const adjustmentId of record.includedAdjustmentIds) {
    const adj = await dbGet("adjustments", adjustmentId);
    if (adj) { adj.status = "Used"; adj.usedPayrollLabel = `Run #${id} (${from} → ${to})`; await dbPut("adjustments", adj); }
  }

  closeModal();
  await renderPayrollPage();
  if (typeof renderRejects === "function") renderRejects();
  if (typeof renderAdjustmentsPage === "function") renderAdjustmentsPage();
  printPayslip(record);
}

function viewPayslip(id) {
  const record = payrollCache.find(r => r.id === id);
  if (!record) return;

  showModal({
    title: `Payslip — ${record.staffName}`,
    bodyHtml: buildPayslipHtml(record),
    saveLabel: "Print",
    onSave: () => printPayslip(record)
  });
}

function buildPayslipHtml(r) {
  return `
    <div style="font-size:13px;color:var(--ink-soft);margin-bottom:10px;">
      Period: ${r.periodFrom} → ${r.periodTo}
    </div>
    <div class="cart-totals-row"><span>Basic salary</span><span class="money">${money(r.basicPay ?? r.basePay)}</span></div>
    ${r.accommodationPay ? `<div class="cart-totals-row"><span>Accommodation${!r.accommodationIncluded ? " (excluded this run)" : ""}</span><span class="money">${r.accommodationIncluded ? money(r.accommodationPay) : "—"}</span></div>` : ""}
    ${r.transportationPay ? `<div class="cart-totals-row"><span>Transportation${!r.transportationIncluded ? " (excluded this run)" : ""}</span><span class="money">${r.transportationIncluded ? money(r.transportationPay) : "—"}</span></div>` : ""}
    <div class="cart-totals-row"><span>Commission (${(r.commissionInvoiceNos || []).length} invoice(s))</span><span class="money">${money(r.commission)}</span></div>
    ${(r.rejectSummary || []).length ? `
      <div style="font-size:12px;color:var(--ink-soft);margin-top:8px;">Reject deductions:</div>
      ${r.rejectSummary.map(rs => `
        <div class="cart-totals-row"><span>${escapeHtml(rs.itemName)} × ${rs.qty} <small>(${escapeHtml(rs.reason)})</small></span><span class="money">-${money(rs.cost)}</span></div>
      `).join("")}
    ` : ""}
    ${(r.adjustmentSummary || []).length ? `
      <div style="font-size:12px;color:var(--ink-soft);margin-top:8px;">Logged advances/bonuses/deductions:</div>
      ${r.adjustmentSummary.map(a => `
        <div class="cart-totals-row"><span>${escapeHtml(a.category)}</span><span class="money">${a.type === "Bonus" ? "+" : "-"}${money(a.amount)}</span></div>
      `).join("")}
    ` : ""}
    ${(r.adjustments || []).map(a => `
      <div class="cart-totals-row"><span>${escapeHtml(a.label)}</span><span class="money">${a.type === "deduction" ? "-" : "+"}${money(a.amount)}</span></div>
    `).join("")}
    <div class="cart-totals-row grand" style="margin-top:8px;"><span>Net pay</span><span class="money">${money(r.netPay)}</span></div>
  `;
}

function printPayslip(record) {
  const win = window.open("", "", "width=380,height=600");
  if (!win) {
    alert(`Payroll for ${record.staffName} was saved. The print window was blocked — open it again from Payroll history and click "View / Print".`);
    return;
  }
  const html = `
    <html><head><title>Payslip - ${record.staffName}</title>
    <style>body{font-family:monospace;font-size:13px;width:300px;margin:10px;} .line{border-top:1px dashed #999;margin:8px 0;} .row{display:flex;justify-content:space-between;}</style>
    </head><body>
      <div style="text-align:center;"><strong>Payslip</strong></div>
      <div class="line"></div>
      Staff: ${record.staffName}<br>
      Period: ${record.periodFrom} to ${record.periodTo}<br>
      <div class="line"></div>
      <div class="row"><span>Basic salary</span><span>${money(record.basicPay ?? record.basePay)}</span></div>
      ${record.accommodationPay ? `<div class="row"><span>Accommodation${!record.accommodationIncluded ? " (excluded)" : ""}</span><span>${record.accommodationIncluded ? money(record.accommodationPay) : "-"}</span></div>` : ""}
      ${record.transportationPay ? `<div class="row"><span>Transportation${!record.transportationIncluded ? " (excluded)" : ""}</span><span>${record.transportationIncluded ? money(record.transportationPay) : "-"}</span></div>` : ""}
      <div class="row"><span>Commission</span><span>${money(record.commission)}</span></div>
      ${(record.rejectSummary || []).map(rs => `<div class="row"><span>Reject: ${rs.itemName}</span><span>-${money(rs.cost)}</span></div>`).join("")}
      ${(record.adjustmentSummary || []).map(a => `<div class="row"><span>${a.category}</span><span>${a.type === "Bonus" ? "+" : "-"}${money(a.amount)}</span></div>`).join("")}
      ${(record.adjustments || []).map(a => `<div class="row"><span>${a.label}</span><span>${a.type === "deduction" ? "-" : "+"}${money(a.amount)}</span></div>`).join("")}
      <div class="line"></div>
      <div class="row"><strong>Net pay</strong><strong>${money(record.netPay)}</strong></div>
      <script>window.onload = () => window.print();</script>
    </body></html>
  `;
  win.document.write(html);
  win.document.close();
}

// Deleting a run releases both its commission AND its reject deductions
// back to "unpaid", so they become available to include in a future run.
async function deletePayrollRun(id) {
  const record = payrollCache.find(r => r.id === id);
  if (!record) return;

  if (!(await authorizePin(`delete payroll run for ${record.staffName}`))) return;
  if (!confirm(`Delete this payroll run for ${record.staffName}? Its commission, reject deductions, and logged adjustments will become available for a future run again.`)) return;

  for (const invoiceNo of record.commissionInvoiceNos || []) {
    const inv = await dbGet("history", invoiceNo);
    if (inv) { inv.commissionPaid = false; await dbPut("history", inv); }
  }

  for (const rejectId of record.includedRejectIds || []) {
    const reject = await dbGet("rejects", rejectId);
    if (reject) { reject.rejectPaid = false; await dbPut("rejects", reject); }
  }

  for (const adjustmentId of record.includedAdjustmentIds || []) {
    const adj = await dbGet("adjustments", adjustmentId);
    if (adj) { adj.status = "Open"; delete adj.usedPayrollLabel; await dbPut("adjustments", adj); }
  }

  await dbDelete("payroll", id);
  await renderPayrollPage();
  if (typeof renderRejects === "function") renderRejects();
  if (typeof renderAdjustmentsPage === "function") renderAdjustmentsPage();
}
