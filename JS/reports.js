/***********************************
 * CSV REPORTS
 ***********************************/

function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCsv(filename, headers, rows) {
  const lines = [headers.join(",")];
  rows.forEach(row => lines.push(row.map(csvEscape).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportSalesCsv() {
  const history = await dbGetAll("history");
  const rows = history
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(inv => [
      inv.invoiceNo, new Date(inv.date).toLocaleString(), inv.staffName, inv.client,
      inv.subtotal, inv.discount, inv.total, inv.paid, inv.balance, inv.status,
      inv.refunded ? "Yes" : "No", inv.method || ""
    ]);
  downloadCsv(`sales-${todayStr()}.csv`,
    ["Invoice", "Date", "Staff", "Client", "Subtotal", "Discount", "Total", "Paid", "Balance", "Status", "Refunded", "Payment Method"],
    rows);
}

async function exportInventoryCsv() {
  const inventory = await dbGetAll("inventory");
  const rows = inventory
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(inv => [inv.name, inv.unit, inv.quantity, inv.restockLevel]);
  downloadCsv(`inventory-${todayStr()}.csv`, ["Material", "Unit", "Stock", "Restock Level"], rows);
}

async function exportRejectsCsv() {
  const rejects = await dbGetAll("rejects");
  const rows = rejects
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(r => [new Date(r.date).toLocaleString(), r.itemName, r.qty, r.reason, r.staffName, r.cost, r.notes || ""]);
  downloadCsv(`rejects-${todayStr()}.csv`, ["Date", "Item", "Qty", "Reason", "Staff", "Cost", "Notes"], rows);
}

async function exportPayrollCsv() {
  const payroll = await dbGetAll("payroll");
  const rows = payroll
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(r => [r.staffName, r.periodFrom, r.periodTo, r.basePay, r.commission, r.rejectDeduction || 0, r.netPay]);
  downloadCsv(`payroll-${todayStr()}.csv`, ["Staff", "Period From", "Period To", "Base Pay", "Commission", "Reject Deductions", "Net Pay"], rows);
}
