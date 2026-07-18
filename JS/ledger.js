/***********************************
 * EMPLOYEE LEDGER
 * One combined, chronological view of everything financial for a
 * staff member — payroll runs and adjustments (both open and already
 * used) — so "what have we paid/owe this person" has one place to look
 * instead of piecing it together from Payroll history + Adjustments.
 ***********************************/

async function renderLedgerStaffSelect() {
  const select = document.getElementById("ledgerStaffSelect");
  if (!select) return;
  select.innerHTML = `<option value="">-- Select staff --</option>` +
    staffCache.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
}

async function renderEmployeeLedger() {
  const staffId = Number(document.getElementById("ledgerStaffSelect")?.value || 0);
  const from = document.getElementById("ledgerFrom")?.value || "0000-01-01";
  const to = document.getElementById("ledgerTo")?.value || "9999-12-31";
  const box = document.getElementById("ledgerResult");
  if (!box) return;

  if (!staffId) {
    box.innerHTML = `<div class="empty-state">Select a staff member to view their ledger.</div>`;
    return;
  }

  const payroll = (await dbGetAll("payroll")).filter(p => Number(p.staffId) === staffId);
  const adjustments = (await dbGetAll("adjustments")).filter(a => Number(a.staffId) === staffId);

  const rows = [];

  payroll.forEach(p => {
    const date = (p.createdAt || p.periodTo || "").slice(0, 10);
    if (date < from || date > to) return;
    rows.push({
      date,
      type: "Payroll",
      ref: `Run #${p.id}`,
      desc: `${p.periodFrom} → ${p.periodTo} • Salary ${money(p.basePay)} + Commission ${money(p.commission)}${p.rejectDeduction ? ` − Rejects ${money(p.rejectDeduction)}` : ""}`,
      debit: 0,
      credit: Number(p.netPay || 0)
    });
  });

  adjustments.forEach(a => {
    if (a.date < from || a.date > to) return;
    const isCredit = a.type === "Bonus";
    rows.push({
      date: a.date,
      type: a.type,
      ref: a.status === "Used" ? `Used in ${a.usedPayrollLabel || "payroll"}` : "Open",
      desc: `${a.category}${a.notes ? " — " + a.notes : ""}`,
      debit: !isCredit && a.status !== "Used" ? Number(a.amount || 0) : 0, // used ones are already folded into the payroll row above, don't double count
      credit: isCredit && a.status !== "Used" ? Number(a.amount || 0) : 0
    });
  });

  rows.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!rows.length) {
    box.innerHTML = `<div class="empty-state">No ledger entries for this staff member / date range.</div>`;
    return;
  }

  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);

  box.innerHTML = `
    <table class="simple-table">
      <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Details</th><th>Debit</th><th>Credit</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.date}</td>
            <td>${escapeHtml(r.type)}</td>
            <td>${escapeHtml(r.ref)}</td>
            <td style="font-size:12px;">${escapeHtml(r.desc)}</td>
            <td class="money">${r.debit ? money(r.debit) : "—"}</td>
            <td class="money">${r.credit ? money(r.credit) : "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="cart-totals-row grand" style="margin-top:10px;"><span>Total credit (paid to them)</span><span class="money">${money(totalCredit)}</span></div>
    <div class="cart-totals-row"><span>Total debit (owed back / deducted)</span><span class="money">${money(totalDebit)}</span></div>
  `;
}
