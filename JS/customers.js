/***********************************
 * CUSTOMERS
 ***********************************/

let customersCache = [];

async function renderCustomersPage() {
  customersCache = (await dbGetAll("customers")).sort((a, b) => a.name.localeCompare(b.name));
  const history = await dbGetAll("history");

  const tbody = document.querySelector("#customersTable tbody");
  if (!customersCache.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No customers saved yet. They're added automatically when you type a new name at checkout, or you can add one here.</td></tr>`;
    return;
  }

  tbody.innerHTML = customersCache.map(c => {
    const orders = history.filter(inv => Number(inv.customerId) === Number(c.id));
    const totalSpent = orders.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
    return `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.phone || "—")}</td>
        <td>${orders.length}</td>
        <td class="money">${money(totalSpent)}</td>
        <td>
          <button class="btn btn-sm" onclick="viewCustomerHistory(${c.id})">History</button>
          <button class="btn btn-sm" onclick="openCustomerModal(${c.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteCustomer(${c.id})">Delete</button>
        </td>
      </tr>
    `;
  }).join("");
}

function openCustomerModal(id = null) {
  const existing = id ? customersCache.find(c => c.id === id) : null;
  showModal({
    title: existing ? "Edit customer" : "New customer",
    bodyHtml: `
      <label class="field-label">Name</label>
      <input type="text" id="customerNameInput" value="${existing ? escapeHtml(existing.name) : ""}">
      <label class="field-label" style="margin-top:10px;">Phone (optional)</label>
      <input type="text" id="customerPhoneInput" value="${existing ? escapeHtml(existing.phone || "") : ""}">
      <label class="field-label" style="margin-top:10px;">Notes (optional)</label>
      <input type="text" id="customerNotesInput" value="${existing ? escapeHtml(existing.notes || "") : ""}" placeholder="e.g. prefers WhatsApp, usual order">
    `,
    saveLabel: "Save customer",
    onSave: async () => {
      const name = document.getElementById("customerNameInput").value.trim();
      const phone = document.getElementById("customerPhoneInput").value.trim();
      const notes = document.getElementById("customerNotesInput").value.trim();
      if (!name) return alert("Enter a name.");

      const record = existing ? { ...existing, name, phone, notes } : { name, phone, notes, createdAt: new Date().toISOString() };
      await dbPut("customers", record);
      closeModal();
      renderCustomersPage();
    }
  });
}

async function deleteCustomer(id) {
  if (!(await authorizePin("delete a customer"))) return;
  if (!confirm("Delete this customer? Their past invoices stay in history, just without a linked customer record.")) return;
  await dbDelete("customers", id);
  renderCustomersPage();
}

async function viewCustomerHistory(id) {
  const customer = customersCache.find(c => c.id === id);
  if (!customer) return;

  const history = (await dbGetAll("history"))
    .filter(inv => Number(inv.customerId) === Number(id))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  showModal({
    title: `${customer.name} — order history`,
    bodyHtml: history.length
      ? history.map(inv => `
          <div class="recent-sale-row">
            <span>${inv.invoiceNo} <small style="color:var(--ink-soft);">— ${new Date(inv.date).toLocaleDateString()}</small></span>
            <span class="money">${money(inv.total)}</span>
          </div>
        `).join("")
      : `<div class="empty-state">No orders yet from this customer.</div>`,
    hideFooter: true
  });
}

// Called from the checkout flow: finds a customer by exact name match,
// or creates one automatically so repeat clients get tracked without
// forcing the cashier through an extra "save customer" step.
async function findOrCreateCustomerByName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "walk-in") return null;

  const all = await dbGetAll("customers");
  const existing = all.find(c => c.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;

  return await dbPut("customers", { name: trimmed, phone: "", notes: "", createdAt: new Date().toISOString() });
}
