/***********************************
 * CHECKOUT / INVOICE
 ***********************************/

function generateInvoiceNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const key = `invoiceCounter_${y}-${m}-${d}`;
  const next = (Number(localStorage.getItem(key)) || 0) + 1;
  localStorage.setItem(key, next);
  return `INV-${y}${m}${d}-${String(next).padStart(3, "0")}`;
}

async function openCheckoutModal() {
  if (!cart.length) return alert("Add at least one item to the sale first.");
  if (!currentOperatorId) return alert("Switch to an operator before charging (top of the cart panel).");

  const subtotal = getCartSubtotal();
  const discount = Math.min(getCartDiscount(), subtotal);
  const total = Math.max(subtotal - discount, 0);
  const customers = await dbGetAll("customers");

  showModal({
    title: "Complete sale",
    bodyHtml: `
      <div class="cart-totals-row"><span>Subtotal</span><span class="money">${money(subtotal)}</span></div>
      <div class="cart-totals-row"><span>Discount</span><span class="money">${money(discount)}</span></div>
      <div class="cart-totals-row grand"><span>Total due</span><span class="money">${money(total)}</span></div>

      <label class="field-label" style="margin-top:12px;">Client (optional)</label>
      <input type="text" id="checkoutClient" placeholder="Walk-in" list="checkoutClientList">
      <datalist id="checkoutClientList">
        ${customers.map(c => `<option value="${escapeHtml(c.name)}">`).join("")}
      </datalist>

      <label class="field-label" style="margin-top:10px;">Amount paid</label>
      <input type="number" id="checkoutPaid" value="${total}" min="0" step="0.01">

      <label class="field-label" style="margin-top:10px;">Payment method</label>
      <select id="checkoutMethod">
        <option>Cash</option>
        <option>Card</option>
        <option>Bank Transfer</option>
      </select>

      <label class="field-label" style="margin-top:10px;">
        <input type="checkbox" id="checkoutNeedsTime" style="width:auto;" onchange="document.getElementById('checkoutReadyByWrap').style.display = this.checked ? 'block' : 'none'">
        This order needs production time
      </label>
      <div id="checkoutReadyByWrap" style="display:none;margin-top:8px;">
        <label class="field-label">Estimated ready by</label>
        <input type="datetime-local" id="checkoutReadyBy">
      </div>
    `,
    saveLabel: "Complete sale & print",
    onSave: completeSale
  });
}

async function completeSale() {
  const operator = staffCache.find(s => s.id === currentOperatorId) || await dbGet("staff", currentOperatorId);
  if (!operator) return alert("Operator not found — switch operator and try again.");

  const subtotal = getCartSubtotal();
  const discount = Math.min(getCartDiscount(), subtotal);
  const total = Math.max(subtotal - discount, 0);
  const paid = Math.max(0, Number(document.getElementById("checkoutPaid").value) || 0);
  const balance = Math.max(total - paid, 0);
  const clientName = document.getElementById("checkoutClient").value.trim() || "Walk-in";
  const method = document.getElementById("checkoutMethod").value;
  const needsTime = document.getElementById("checkoutNeedsTime").checked;
  const readyByRaw = document.getElementById("checkoutReadyBy").value;
  const readyBy = needsTime && readyByRaw ? new Date(readyByRaw).toISOString() : null;

  const customerId = await findOrCreateCustomerByName(clientName);

  const invoice = {
    invoiceNo: generateInvoiceNumber(),
    date: new Date().toISOString(),
    staffId: operator.id,
    staffName: operator.name,
    client: clientName,
    customerId,
    items: cart.map(line => ({ name: line.name, price: line.price, qty: line.qty, commission: line.commission, materials: line.materials })),
    subtotal, discount, total, paid, balance,
    status: balance <= 0 ? "Paid" : paid > 0 ? "Balance" : "Unpaid",
    method,
    readyBy,
    pickedUp: false,
    refunded: false
  };

  await dbPut("history", invoice);
  await deductInventoryForSale(invoice.items);

  // Everything above this line is the sale itself — already safely saved
  // and deducted. Clear the cart and refresh the screen BEFORE printing,
  // so a blocked pop-up (common in Safari/Chrome once a click has to
  // wait on a database write first) can never prevent the person from
  // seeing that the sale went through.
  closeModal();
  cart = [];
  document.getElementById("cartDiscount").value = 0;
  renderCart();
  renderDashboard();

  try {
    printReceipt(invoice);
  } catch (err) {
    console.warn("Could not open the receipt window (likely blocked as a pop-up):", err);
    alert(`Sale completed and saved as ${invoice.invoiceNo}. The receipt window was blocked by the browser — open History and click "View" on this invoice to print it.`);
  }

  if (deductionWarnings.length) {
    alert(
      `Sale ${invoice.invoiceNo} was saved, but stock could NOT be deducted for:\n\n` +
      deductionWarnings.join("\n") +
      `\n\nThat material may have been deleted and re-added. Open the item under Services & Items, untick and re-tick it, then save — that will relink it to the current inventory record.`
    );
  }
}

// Every material an item uses gets taken out of stock, scaled by how
// many of the item were sold. This is the one place stock goes down;
// history.js's delete/refund functions are where it comes back.
// Returns nothing directly — instead it fills deductionWarnings with
// anything that failed, so a mismatch can never fail silently again.
let deductionWarnings = [];
async function deductInventoryForSale(items) {
  deductionWarnings = [];
  for (const item of items) {
    for (const material of item.materials || []) {
      const totalUsed = Number(material.qty || 0) * Number(item.qty || 1);
      if (totalUsed > 0) {
        const ok = await adjustInventoryQty(material.inventoryId, -totalUsed);
        if (!ok) deductionWarnings.push(`• ${material.name} (used by ${item.name})`);
      }
    }
  }
}

// A real 80mm-thermal-style receipt: centered header, a proper item
// table instead of manually padded text, and a ready-by line when the
// order needs production time.
function printReceipt(invoice) {
  const itemRows = invoice.items.map(i => `
    <tr>
      <td>${escapeHtml(i.name)}</td>
      <td class="r">${i.qty}</td>
      <td class="r">${money(i.price * i.qty)}</td>
    </tr>
  `).join("");

  const html = `
    <html><head><title>${invoice.invoiceNo}</title>
    <style>
      @page { margin: 0; }
      body { font-family: 'Courier New', monospace; font-size: 12px; width: 280px; margin: 12px auto; color: #000; }
      .center { text-align: center; }
      .shop-name { font-size: 16px; font-weight: 700; letter-spacing: 0.5px; }
      .line { border-top: 1px dashed #000; margin: 8px 0; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: 11px; border-bottom: 1px solid #000; padding-bottom: 3px; }
      td { padding: 3px 0; vertical-align: top; }
      .r { text-align: right; }
      .totals td { padding: 1px 0; }
      .grand td { font-weight: 700; font-size: 14px; padding-top: 4px; }
      .meta { font-size: 11px; margin: 2px 0; }
      .ready-by { margin-top: 8px; padding: 6px; border: 1px dashed #000; text-align: center; font-weight: 700; }
      .footer { margin-top: 10px; }
    </style>
    </head><body>
      <div class="center">
        <div class="shop-name">${escapeHtml(shopName || "Print Shop")}</div>
        <div class="meta">Sales Receipt</div>
      </div>
      <div class="line"></div>
      <div class="meta"><strong>Invoice:</strong> ${invoice.invoiceNo}</div>
      <div class="meta"><strong>Date:</strong> ${new Date(invoice.date).toLocaleString()}</div>
      <div class="meta"><strong>Staff:</strong> ${escapeHtml(invoice.staffName)}</div>
      <div class="meta"><strong>Client:</strong> ${escapeHtml(invoice.client)}</div>
      <div class="line"></div>
      <table>
        <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Total</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="line"></div>
      <table class="totals">
        <tr><td>Subtotal</td><td class="r">${money(invoice.subtotal)}</td></tr>
        <tr><td>Discount</td><td class="r">${money(invoice.discount)}</td></tr>
        <tr class="grand"><td>Total</td><td class="r">${money(invoice.total)}</td></tr>
        <tr><td>Paid</td><td class="r">${money(invoice.paid)}</td></tr>
        <tr><td>Balance</td><td class="r">${money(invoice.balance)}</td></tr>
      </table>
      <div class="center" style="margin-top:6px;font-weight:700;">${invoice.status.toUpperCase()}</div>
      ${invoice.readyBy ? `<div class="ready-by">Ready by:<br>${new Date(invoice.readyBy).toLocaleString()}</div>` : ""}
      ${invoice.dueDate ? `<div class="ready-by">Payment due by:<br>${new Date(invoice.dueDate + "T00:00:00").toLocaleDateString()}</div>` : ""}
      <div class="line"></div>
      <div class="center footer">Thank you!</div>
      <script>window.onload = () => { window.print(); }</script>
    </body></html>
  `;
  const win = window.open("", "", "width=380,height=650");
  if (!win) {
    throw new Error("Receipt window was blocked by the browser's pop-up blocker.");
  }
  win.document.write(html);
  win.document.close();
}
