/***********************************
 * QUOTATIONS
 * Independent pre-sale documents — nothing here touches inventory,
 * commission, or sales totals. A quote is just a number you show a
 * client before they commit; if they say yes, ring it up normally
 * through Checkout or a manual Invoice.
 ***********************************/

let quotationsCache = [];
let quoteLineItemsTemp = [];

function generateQuoteNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const key = `quoteCounter_${y}-${m}-${d}`;
  const next = (Number(localStorage.getItem(key)) || 0) + 1;
  localStorage.setItem(key, next);
  return `QUO-${y}${m}${d}-${String(next).padStart(3, "0")}`;
}

async function renderQuotationsPage() {
  quotationsCache = (await dbGetAll("quotations")).sort((a, b) => new Date(b.date) - new Date(a.date));
  const tbody = document.querySelector("#quotationsTable tbody");

  if (!quotationsCache.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No quotations yet.</td></tr>`;
    return;
  }

  const pillClass = { Draft: "pill-unpaid", Sent: "pill-balance", Approved: "pill-paid", Rejected: "pill-refunded", Expired: "pill-refunded" };

  tbody.innerHTML = quotationsCache.map(q => `
    <tr>
      <td>${q.quoteNo}</td>
      <td>${new Date(q.date).toLocaleDateString()}</td>
      <td>${escapeHtml(q.client)}</td>
      <td class="money">${money(q.total)}</td>
      <td>
        <select onchange="updateQuotationStatus(${q.id}, this.value)" style="padding:4px 6px;">
          ${["Draft", "Sent", "Approved", "Rejected", "Expired"].map(s => `<option ${q.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>
        <button class="btn btn-sm" onclick="viewQuotation(${q.id})">View</button>
        <button class="btn btn-sm btn-danger" onclick="deleteQuotation(${q.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

async function updateQuotationStatus(id, status) {
  const q = await dbGet("quotations", id);
  if (!q) return;
  q.status = status;
  await dbPut("quotations", q);
  renderQuotationsPage();
}

function openQuotationModal() {
  quoteLineItemsTemp = [];
  const defaultValidUntil = new Date();
  defaultValidUntil.setDate(defaultValidUntil.getDate() + 14);

  showModal({
    title: "New quotation",
    wide: true,
    bodyHtml: `
      <div class="field-row">
        <div>
          <label class="field-label">Client</label>
          <input type="text" id="quoteClient" placeholder="Client or company name">
        </div>
        <div>
          <label class="field-label">Valid until</label>
          <input type="date" id="quoteValidUntil" value="${defaultValidUntil.toISOString().slice(0, 10)}">
        </div>
      </div>

      <label class="field-label">Line items</label>
      <div class="field-row">
        <input type="text" id="quoteLineDesc" placeholder="Description (e.g. A4 Flyers x500)">
        <input type="number" id="quoteLineQty" placeholder="Qty" value="1" min="1">
        <input type="number" id="quoteLinePrice" placeholder="Unit price" min="0" step="0.01">
        <button class="btn" onclick="addQuoteLineItem()">+ Add line</button>
      </div>
      <div id="quoteLineItemsList"></div>

      <div class="cart-totals" id="quoteTotalsBox"></div>

      <label class="field-label" style="margin-top:10px;">Notes (optional)</label>
      <input type="text" id="quoteNotes" placeholder="Terms, delivery timeline, etc.">
    `,
    saveLabel: "Save quotation",
    onSave: saveQuotation
  });

  renderQuoteLineItems();
}

function addQuoteLineItem() {
  const desc = document.getElementById("quoteLineDesc").value.trim();
  const qty = Number(document.getElementById("quoteLineQty").value) || 1;
  const price = Number(document.getElementById("quoteLinePrice").value);

  if (!desc || !(price >= 0)) return alert("Enter a description and a price.");

  quoteLineItemsTemp.push({ name: desc, qty, price });
  document.getElementById("quoteLineDesc").value = "";
  document.getElementById("quoteLineQty").value = "1";
  document.getElementById("quoteLinePrice").value = "";
  renderQuoteLineItems();
}

function removeQuoteLineItem(index) {
  quoteLineItemsTemp.splice(index, 1);
  renderQuoteLineItems();
}

function renderQuoteLineItems() {
  const box = document.getElementById("quoteLineItemsList");
  if (!box) return;

  box.innerHTML = quoteLineItemsTemp.length
    ? quoteLineItemsTemp.map((item, i) => `
        <div class="cart-totals-row">
          <span>${escapeHtml(item.name)} × ${item.qty}</span>
          <span>
            <span class="money">${money(item.price * item.qty)}</span>
            <button class="btn btn-sm btn-icon" onclick="removeQuoteLineItem(${i})">✕</button>
          </span>
        </div>
      `).join("")
    : `<div class="empty-state">No line items yet.</div>`;

  const total = quoteLineItemsTemp.reduce((sum, i) => sum + i.price * i.qty, 0);
  const totalsBox = document.getElementById("quoteTotalsBox");
  if (totalsBox) totalsBox.innerHTML = `<div class="cart-totals-row grand"><span>Total</span><span class="money">${money(total)}</span></div>`;
}

async function saveQuotation() {
  const client = document.getElementById("quoteClient").value.trim();
  const validUntil = document.getElementById("quoteValidUntil").value;
  const notes = document.getElementById("quoteNotes").value.trim();

  if (!client) return alert("Enter a client name.");
  if (!quoteLineItemsTemp.length) return alert("Add at least one line item.");

  const total = quoteLineItemsTemp.reduce((sum, i) => sum + i.price * i.qty, 0);

  await dbPut("quotations", {
    quoteNo: generateQuoteNumber(),
    date: new Date().toISOString(),
    client,
    items: [...quoteLineItemsTemp],
    total,
    validUntil,
    status: "Draft",
    notes
  });

  closeModal();
  renderQuotationsPage();
}

function viewQuotation(id) {
  const q = quotationsCache.find(x => x.id === id);
  if (!q) return;

  showModal({
    title: `Quotation ${q.quoteNo}`,
    bodyHtml: `
      <div style="font-size:13px;color:var(--ink-soft);margin-bottom:10px;">
        ${new Date(q.date).toLocaleString()} • ${escapeHtml(q.client)} • Valid until ${q.validUntil}
      </div>
      ${q.items.map(i => `<div class="cart-totals-row"><span>${escapeHtml(i.name)} × ${i.qty}</span><span class="money">${money(i.price * i.qty)}</span></div>`).join("")}
      <div class="cart-totals-row grand" style="margin-top:8px;"><span>Total</span><span class="money">${money(q.total)}</span></div>
      ${q.notes ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:8px;">${escapeHtml(q.notes)}</div>` : ""}
    `,
    saveLabel: "Print",
    onSave: () => printQuotation(q)
  });
}

function printQuotation(q) {
  const win = window.open("", "", "width=380,height=650");
  if (!win) return alert("Print window was blocked by the browser.");
  const html = `
    <html><head><title>${q.quoteNo}</title>
    <style>body{font-family:'Courier New',monospace;font-size:12px;width:280px;margin:12px auto;} .center{text-align:center;} .line{border-top:1px dashed #000;margin:8px 0;} table{width:100%;border-collapse:collapse;} td{padding:3px 0;} .r{text-align:right;}</style>
    </head><body>
      <div class="center"><strong>${escapeHtml(shopName || "Print Shop")}</strong><br>Quotation</div>
      <div class="line"></div>
      Quote: ${q.quoteNo}<br>
      Date: ${new Date(q.date).toLocaleString()}<br>
      Client: ${escapeHtml(q.client)}<br>
      Valid until: ${q.validUntil}
      <div class="line"></div>
      <table>${q.items.map(i => `<tr><td>${escapeHtml(i.name)} ×${i.qty}</td><td class="r">${money(i.price * i.qty)}</td></tr>`).join("")}</table>
      <div class="line"></div>
      <table><tr><td><strong>Total</strong></td><td class="r"><strong>${money(q.total)}</strong></td></tr></table>
      ${q.notes ? `<div class="line"></div>${escapeHtml(q.notes)}` : ""}
      <div class="line"></div>
      <div class="center">This is a quotation, not an invoice.</div>
      <script>window.onload = () => window.print();</script>
    </body></html>
  `;
  win.document.write(html);
  win.document.close();
}

async function deleteQuotation(id) {
  if (!(await authorizePin("delete a quotation"))) return;
  if (!confirm("Delete this quotation?")) return;
  await dbDelete("quotations", id);
  renderQuotationsPage();
}
