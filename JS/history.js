/***********************************
 * SALES HISTORY
 * Two different ways to undo a sale, on purpose:
 * - Refund/void: keeps the invoice for the record, marks it refunded,
 *   returns materials to stock, and stops its commission from being
 *   payable. Use this for "customer returned it" / "we cancelled it".
 * - Delete: removes the invoice entirely. Use this only for a genuine
 *   data-entry mistake (rang up the wrong thing by accident).
 ***********************************/

let historyCache = [];

async function renderHistoryTable() {
  historyCache = (await dbGetAll("history")).sort((a, b) => new Date(b.date) - new Date(a.date));
  const tbody = document.querySelector("#historyTable tbody");

  if (!historyCache.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No sales yet.</td></tr>`;
    return;
  }

  const pillClass = { Paid: "pill-paid", Balance: "pill-balance", Unpaid: "pill-unpaid" };

  tbody.innerHTML = historyCache.map(inv => `
    <tr>
      <td>${inv.invoiceNo}</td>
      <td>${new Date(inv.date).toLocaleDateString()}</td>
      <td>${escapeHtml(inv.staffName)}</td>
      <td>${escapeHtml(inv.client)}</td>
      <td class="money">${money(inv.total)}</td>
      <td>
        ${inv.refunded ? `<span class="pill pill-refunded">Refunded</span>` : `<span class="pill ${pillClass[inv.status] || ""}">${inv.status}</span>`}
        ${inv.readyBy && !inv.pickedUp ? `<span class="pill pill-production">In production</span>` : ""}
      </td>
      <td>
        <button class="btn btn-sm" onclick="viewInvoice('${inv.invoiceNo}')">View</button>
        <button class="btn btn-sm btn-danger" onclick="deleteInvoiceRecord('${inv.invoiceNo}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

function viewInvoice(invoiceNo) {
  const inv = historyCache.find(i => i.invoiceNo === invoiceNo);
  if (!inv) return;

  const rows = inv.items.map(i => `
    <div class="cart-totals-row"><span>${escapeHtml(i.name)} × ${i.qty}</span><span class="money">${money(i.price * i.qty)}</span></div>
  `).join("");

  showModal({
    title: `Invoice ${inv.invoiceNo}`,
    bodyHtml: `
      <div style="font-size:13px;color:var(--ink-soft);margin-bottom:10px;">
        ${new Date(inv.date).toLocaleString()} • ${escapeHtml(inv.staffName)} • ${escapeHtml(inv.client)}
      </div>
      ${inv.refunded ? `<div class="empty-state" style="background:#ECE9E4;border-radius:8px;padding:10px;margin-bottom:10px;">Refunded/voided${inv.refundReason ? `: ${escapeHtml(inv.refundReason)}` : ""}</div>` : ""}
      ${inv.readyBy ? `
        <div class="cart-totals-row" style="background:${inv.pickedUp ? "#E4F3EC" : "#FFF3D6"};padding:8px;border-radius:8px;">
          <span>${inv.pickedUp ? "✅ Picked up" : "⏳ Ready by " + new Date(inv.readyBy).toLocaleString()}</span>
          ${!inv.pickedUp ? `<button class="btn btn-sm" onclick="markPickedUp('${inv.invoiceNo}')">Mark picked up</button>` : ""}
        </div>
      ` : ""}
      ${rows}
      <div class="cart-totals">
        <div class="cart-totals-row"><span>Subtotal</span><span class="money">${money(inv.subtotal)}</span></div>
        <div class="cart-totals-row"><span>Discount</span><span class="money">${money(inv.discount)}</span></div>
        <div class="cart-totals-row grand"><span>Total</span><span class="money">${money(inv.total)}</span></div>
        <div class="cart-totals-row"><span>Paid</span><span class="money">${money(inv.paid)}</span></div>
        <div class="cart-totals-row"><span>Balance</span><span class="money">${money(inv.balance)}</span></div>
      </div>
      ${!inv.refunded ? `<button class="btn btn-danger" style="width:100%;margin-top:10px;" onclick="refundInvoice('${inv.invoiceNo}')">Refund / Void this sale</button>` : ""}
    `,
    saveLabel: "Print",
    onSave: () => printReceipt(inv)
  });
}

async function markPickedUp(invoiceNo) {
  const inv = await dbGet("history", invoiceNo);
  if (!inv) return;
  inv.pickedUp = true;
  await dbPut("history", inv);
  closeModal();
  renderHistoryTable();
  renderDashboard();
}

// Refund/void: keeps the invoice (for your records) but returns its
// materials to stock and stops its commission from ever being paid out.
async function refundInvoice(invoiceNo) {
  const inv = historyCache.find(i => i.invoiceNo === invoiceNo);
  if (!inv) return;
  if (inv.refunded) return alert("This invoice is already refunded.");

  if (!(await authorizePin(`refund invoice ${invoiceNo}`))) return;

  const reason = prompt("Reason for refund/void (optional):") || "";
  if (!confirm(`Refund/void invoice ${invoiceNo}? Materials will be returned to stock, and its commission will no longer be payable.`)) return;

  for (const item of inv.items) {
    for (const material of item.materials || []) {
      const totalUsed = Number(material.qty || 0) * Number(item.qty || 1);
      if (totalUsed > 0) await adjustInventoryQty(material.inventoryId, totalUsed);
    }
  }

  inv.refunded = true;
  inv.refundReason = reason;
  inv.refundedAt = new Date().toISOString();
  await dbPut("history", inv);

  closeModal();
  renderHistoryTable();
  renderInventoryTable();
  renderDashboard();
}

// Deleting a sale returns every material it used back to stock — the old
// app's version of this silently forgot to, which permanently threw off
// inventory counts over time. This is why that mattered. Delete is for
// data-entry mistakes; refundInvoice() above is for real refunds/voids
// that should stay on the books.
async function deleteInvoiceRecord(invoiceNo) {
  const inv = historyCache.find(i => i.invoiceNo === invoiceNo);
  if (!inv) return;

  if (!(await authorizePin(`delete invoice ${invoiceNo}`))) return;
  if (!confirm(`Delete invoice ${invoiceNo}? Materials it used will be returned to stock. This removes the record entirely — for a real refund, use "Refund / Void" instead so it stays on your books.`)) return;

  if (!inv.refunded) {
    for (const item of inv.items) {
      for (const material of item.materials || []) {
        const totalUsed = Number(material.qty || 0) * Number(item.qty || 1);
        if (totalUsed > 0) await adjustInventoryQty(material.inventoryId, totalUsed);
      }
    }
  }

  await dbDelete("history", invoiceNo);
  renderHistoryTable();
  renderInventoryTable();
}

/***********************************
 * MANUAL INVOICE
 * Bills a client directly — not through the POS cart. Useful for
 * credit clients (bill now, they pay in 30 days) or a bespoke one-off
 * job that isn't in the catalog. Saves into the same History store as
 * a normal sale, so it shows up everywhere sales do, with one addition:
 * a due date instead of assuming payment happens at the counter.
 ***********************************/
let manualInvoiceLineItemsTemp = [];

async function openManualInvoiceModal() {
  manualInvoiceLineItemsTemp = [];
  const staff = await dbGetAll("staff");
  const customers = await dbGetAll("customers");
  const services = await dbGetAll("services");
  const catalogItems = [];
  services.forEach(s => (s.items || []).forEach((item, index) => catalogItems.push({ key: `${s.id}-${index}`, label: `${s.name} — ${item.name}`, item })));

  showModal({
    title: "New invoice",
    wide: true,
    bodyHtml: `
      <div class="field-row">
        <div>
          <label class="field-label">Client</label>
          <input type="text" id="miClient" list="miClientList" placeholder="Walk-in">
          <datalist id="miClientList">${customers.map(c => `<option value="${escapeHtml(c.name)}">`).join("")}</datalist>
        </div>
        <div>
          <label class="field-label">Billed by</label>
          <select id="miStaffSelect">
            ${staff.map(s => `<option value="${s.id}" ${s.id === currentOperatorId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </div>
      </div>

      <label class="field-label">Add from catalog (keeps material deduction working)</label>
      <div class="field-row">
        <select id="miCatalogSelect">
          <option value="">-- Select item --</option>
          ${catalogItems.map(c => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join("")}
        </select>
        <input type="number" id="miCatalogQty" value="1" min="1" placeholder="Qty">
        <button class="btn" onclick="addManualInvoiceCatalogLine('${catalogItems.map(c => c.key).join(",")}')">+ Add</button>
      </div>

      <label class="field-label" style="margin-top:10px;">Or add a custom line (one-off job, no catalog match)</label>
      <div class="field-row">
        <input type="text" id="miCustomDesc" placeholder="Description">
        <input type="number" id="miCustomQty" value="1" min="1" placeholder="Qty">
        <input type="number" id="miCustomPrice" placeholder="Unit price" min="0" step="0.01">
        <button class="btn" onclick="addManualInvoiceCustomLine()">+ Add</button>
      </div>

      <div id="miLineItemsList" style="margin-top:10px;"></div>
      <div class="cart-totals" id="miTotalsBox"></div>

      <div class="field-row" style="margin-top:10px;">
        <div>
          <label class="field-label">Amount paid now</label>
          <input type="number" id="miPaid" value="0" min="0" step="0.01">
        </div>
        <div>
          <label class="field-label">Due date (optional)</label>
          <input type="date" id="miDueDate">
        </div>
      </div>
    `,
    saveLabel: "Create invoice",
    onSave: saveManualInvoice
  });

  window._manualInvoiceCatalog = catalogItems;
  renderManualInvoiceLineItems();
}

function addManualInvoiceCatalogLine() {
  const key = document.getElementById("miCatalogSelect").value;
  const qty = Number(document.getElementById("miCatalogQty").value) || 1;
  if (!key) return alert("Select a catalog item.");

  const entry = (window._manualInvoiceCatalog || []).find(c => c.key === key);
  if (!entry) return;

  manualInvoiceLineItemsTemp.push({
    name: entry.item.name, price: entry.item.price, qty,
    commission: entry.item.commission || 0, materials: entry.item.materials || []
  });
  document.getElementById("miCatalogQty").value = "1";
  renderManualInvoiceLineItems();
}

function addManualInvoiceCustomLine() {
  const desc = document.getElementById("miCustomDesc").value.trim();
  const qty = Number(document.getElementById("miCustomQty").value) || 1;
  const price = Number(document.getElementById("miCustomPrice").value);
  if (!desc || !(price >= 0)) return alert("Enter a description and a price.");

  manualInvoiceLineItemsTemp.push({ name: desc, price, qty, commission: 0, materials: [] });
  document.getElementById("miCustomDesc").value = "";
  document.getElementById("miCustomQty").value = "1";
  document.getElementById("miCustomPrice").value = "";
  renderManualInvoiceLineItems();
}

function removeManualInvoiceLine(index) {
  manualInvoiceLineItemsTemp.splice(index, 1);
  renderManualInvoiceLineItems();
}

function renderManualInvoiceLineItems() {
  const box = document.getElementById("miLineItemsList");
  if (!box) return;

  box.innerHTML = manualInvoiceLineItemsTemp.length
    ? manualInvoiceLineItemsTemp.map((item, i) => `
        <div class="cart-totals-row">
          <span>${escapeHtml(item.name)} × ${item.qty}</span>
          <span>
            <span class="money">${money(item.price * item.qty)}</span>
            <button class="btn btn-sm btn-icon" onclick="removeManualInvoiceLine(${i})">✕</button>
          </span>
        </div>
      `).join("")
    : `<div class="empty-state">No line items yet.</div>`;

  const total = manualInvoiceLineItemsTemp.reduce((sum, i) => sum + i.price * i.qty, 0);
  const totalsBox = document.getElementById("miTotalsBox");
  if (totalsBox) totalsBox.innerHTML = `<div class="cart-totals-row grand"><span>Total</span><span class="money">${money(total)}</span></div>`;
}

async function saveManualInvoice() {
  const client = document.getElementById("miClient").value.trim() || "Walk-in";
  const staffId = Number(document.getElementById("miStaffSelect").value);
  const staff = await dbGet("staff", staffId);
  const paid = Math.max(0, Number(document.getElementById("miPaid").value) || 0);
  const dueDate = document.getElementById("miDueDate").value || null;

  if (!manualInvoiceLineItemsTemp.length) return alert("Add at least one line item.");
  if (!staff) return alert("Select who this invoice is billed by.");

  const total = manualInvoiceLineItemsTemp.reduce((sum, i) => sum + i.price * i.qty, 0);
  const balance = Math.max(total - paid, 0);
  const customerId = await findOrCreateCustomerByName(client);

  const invoice = {
    invoiceNo: generateInvoiceNumber(),
    date: new Date().toISOString(),
    staffId: staff.id,
    staffName: staff.name,
    client,
    customerId,
    items: [...manualInvoiceLineItemsTemp],
    subtotal: total, discount: 0, total, paid, balance,
    status: balance <= 0 ? "Paid" : paid > 0 ? "Balance" : "Unpaid",
    method: "Invoice",
    dueDate,
    readyBy: null, pickedUp: false, refunded: false,
    manualInvoice: true
  };

  await dbPut("history", invoice);
  await deductInventoryForSale(invoice.items);

  closeModal();
  renderHistoryTable();
  renderInventoryTable();
  renderDashboard();

  try {
    printReceipt(invoice);
  } catch (err) {
    alert(`Invoice ${invoice.invoiceNo} was saved. The print window was blocked — open it from History and click "View" to print.`);
  }
}
