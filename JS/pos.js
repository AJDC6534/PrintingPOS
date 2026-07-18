/***********************************
 * POS — ITEM GRID & CART
 ***********************************/

let posItemsCache = []; // flattened list of every item across every service
let cart = [];          // [{ key, name, price, qty, commission, materials }]
let currentOperatorId = null;

async function renderPosPage() {
  const services = await dbGetAll("services");
  posItemsCache = [];
  services.forEach(service => {
    (service.items || []).forEach((item, index) => {
      posItemsCache.push({ key: `${service.id}-${index}`, serviceName: service.name, ...item });
    });
  });

  renderPosGrid();
  renderOperatorDisplay();
  renderCart();
}

function renderOperatorDisplay() {
  const label = document.getElementById("currentOperatorName");
  if (!label) return;
  const staff = staffCache.find(s => s.id === currentOperatorId);
  label.textContent = staff ? staff.name : "-- No operator --";
}

// Switching who's ringing up sales requires that person's PIN if they
// have one set — this is the actual "can't just switch staff" gate.
async function openStaffSwitchModal() {
  const staff = (await dbGetAll("staff")).filter(s => s.active !== false);
  staffCache = staffCache.length ? staffCache : staff; // keep authorizePin() working even before Staff page has ever loaded

  showModal({
    title: "Switch operator",
    bodyHtml: staff.length
      ? `<div style="display:grid;gap:8px;">
          ${staff.map(s => `<button class="btn" style="text-align:left;" onclick="selectOperator(${s.id})">${escapeHtml(s.name)}${s.pin ? " 🔒" : ""}</button>`).join("")}
        </div>`
      : `<div class="empty-state">No staff yet — add one under Staff & Payroll.</div>`,
    hideFooter: true
  });
}

async function selectOperator(staffId) {
  const staffList = await dbGetAll("staff");
  const staff = staffList.find(s => s.id === staffId);
  if (!staff) return;

  if (staff.pin) {
    const entered = prompt(`Enter PIN for ${staff.name}:`);
    if (entered === null) return;
    if (String(entered).trim() !== String(staff.pin)) return alert("Incorrect PIN.");
  }

  currentOperatorId = staffId;
  currentOperatorIsManager = !!staff.isManager;
  closeModal();
  hideLockScreen();
  renderOperatorDisplay();
  applyRoleBasedUI();
}

function renderPosGrid() {
  const grid = document.getElementById("posGrid");
  const keyword = (document.getElementById("posSearch")?.value || "").trim().toLowerCase();

  const items = posItemsCache.filter(i => !keyword || i.name.toLowerCase().includes(keyword));

  if (!items.length) {
    grid.innerHTML = `<div class="empty-state">No items match. Add items under Services & Items first.</div>`;
    return;
  }

  grid.innerHTML = items.map(item => `
    <button class="pos-tile" onclick="addToCart('${item.key}')">
      <div class="pos-tile-name">${escapeHtml(item.name)}</div>
      <div class="pos-tile-price money">${money(item.price)}</div>
    </button>
  `).join("");
}

function addToCart(key) {
  const item = posItemsCache.find(i => i.key === key);
  if (!item) return;

  const line = cart.find(c => c.key === key);
  if (line) {
    line.qty += 1;
  } else {
    cart.push({ key, name: item.name, price: item.price, qty: 1, commission: item.commission || 0, materials: item.materials || [] });
  }
  renderCart();
}

function changeCartQty(key, delta) {
  const line = cart.find(c => c.key === key);
  if (!line) return;
  line.qty = Math.max(0, line.qty + delta);
  cart = cart.filter(c => c.qty > 0);
  renderCart();
}

function removeCartLine(key) {
  cart = cart.filter(c => c.key !== key);
  renderCart();
}

function getCartDiscount() {
  return Math.max(0, Number(document.getElementById("cartDiscount")?.value || 0));
}

function getCartSubtotal() {
  return cart.reduce((sum, line) => sum + line.price * line.qty, 0);
}

function renderCart() {
  const box = document.getElementById("cartLines");

  if (!cart.length) {
    box.innerHTML = `<div class="empty-state">No items yet — tap something to start a sale.</div>`;
  } else {
    box.innerHTML = cart.map(line => `
      <div class="cart-line">
        <div class="cart-line-name">${escapeHtml(line.name)}</div>
        <button class="qty-btn" onclick="changeCartQty('${line.key}', -1)">−</button>
        <span class="money">${line.qty}</span>
        <button class="qty-btn" onclick="changeCartQty('${line.key}', 1)">+</button>
        <div class="cart-line-sub money">${money(line.price * line.qty)}</div>
        <button class="btn btn-icon btn-sm" onclick="removeCartLine('${line.key}')">✕</button>
      </div>
    `).join("");
  }

  const subtotal = getCartSubtotal();
  const discount = Math.min(getCartDiscount(), subtotal);
  const total = Math.max(subtotal - discount, 0);

  document.getElementById("cartSubtotal").textContent = money(subtotal);
  document.getElementById("cartTotal").textContent = money(total);
}

function clearCart() {
  if (cart.length && !confirm("Clear this sale?")) return;
  cart = [];
  document.getElementById("cartDiscount").value = 0;
  renderCart();
}
