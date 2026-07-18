/***********************************
 * APP BOOTSTRAP & NAVIGATION
 ***********************************/

/***********************************
 * ROLE-BASED ACCESS
 * "Signed in as" (see pos.js's operator switch) isn't just for
 * attributing sales anymore — it also decides what's visible. Staff &
 * Payroll and Settings are Manager-only: a regular staff member can't
 * see them in the sidebar, and navigating there directly is blocked
 * too (not just hidden), so it's a real restriction, not decoration.
 ***********************************/
const MANAGER_ONLY_PAGES = ["staff", "settings"];
let currentOperatorIsManager = false;
let anyStaffExist = false; // stays false only until the very first staff member is ever created

function applyRoleBasedUI() {
  MANAGER_ONLY_PAGES.forEach(page => {
    const btn = document.querySelector(`.nav-btn[data-page="${page}"]`);
    if (btn) btn.style.display = (anyStaffExist && !currentOperatorIsManager) ? "none" : "";
  });

  // If access was just revoked (switched to a non-manager) while sitting
  // on a manager-only page, don't leave it visible on screen — bounce out.
  const activeSection = document.querySelector(".page.active");
  const activePageId = activeSection?.id?.replace("page-", "");
  if (anyStaffExist && !currentOperatorIsManager && MANAGER_ONLY_PAGES.includes(activePageId)) {
    goToPage("dashboard");
  }
}

function goToPage(pageId) {
  // Bootstrap exception: with zero staff ever created, nothing is
  // restricted — otherwise nobody could ever reach Staff & Payroll to
  // create the first person to sign in as.
  if (anyStaffExist) {
    if (!currentOperatorId && pageId !== "dashboard") {
      showLockScreen();
      return;
    }
    if (MANAGER_ONLY_PAGES.includes(pageId) && !currentOperatorIsManager) {
      alert("Only a Manager can access this. Use \"Switch\" at the top of the sidebar and sign in as a Manager first.");
      return;
    }
  }

  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(`page-${pageId}`)?.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`.nav-btn[data-page="${pageId}"]`)?.classList.add("active");

  // Each page loads its own fresh data when you land on it, so what you
  // see is never stale from before you switched tabs.
  if (pageId === "dashboard") renderDashboard();
  if (pageId === "pos") renderPosPage();
  if (pageId === "services") renderServices();
  if (pageId === "inventory") renderInventoryTable();
  if (pageId === "history") renderHistoryTable();
  if (pageId === "rejects") renderRejects();
  if (pageId === "workOrders") renderWorkOrdersPage();
  if (pageId === "delivery") renderDeliveryPage();
  if (pageId === "quotations") renderQuotationsPage();
  if (pageId === "purchaseOrders") renderPurchaseOrdersPage();
  if (pageId === "staff") renderStaffPage();
  if (pageId === "customers") renderCustomersPage();
  if (pageId === "settings") {
    const el = document.getElementById("shopNameInput");
    if (el) el.value = shopName;
  }
}

function money(value) {
  return "QR" + Number(value || 0).toFixed(2);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

let shopName = "Print Shop";

async function initApp() {
  await openDatabase();
  const saved = await dbGet("settings", "shopName");
  if (saved?.value) shopName = saved.value;
  document.getElementById("shopNameLabel").textContent = shopName;
  applyRoleBasedUI(); // no one's signed in yet — start in the restricted view
  await maybeShowLockScreen();
  await renderDashboard();
}

/***********************************
 * LOCK SCREEN
 * The whole app is unusable until an operator is chosen — not just
 * the Manager-only pages. The one deliberate exception: a brand-new
 * install with zero staff skips the lock, since otherwise nobody
 * could ever get in to create the first staff member.
 ***********************************/
async function maybeShowLockScreen() {
  const staff = await dbGetAll("staff");
  anyStaffExist = staff.length > 0;
  if (!staff.length) return; // nothing to sign in as yet — let them in to set up staff
  showLockScreen();
}

function showLockScreen() {
  document.getElementById("lockScreen").classList.remove("hidden"); // instant — no gap between blocking navigation and showing the block
  populateLockScreenStaffList();
}

async function populateLockScreenStaffList() {
  const staff = (await dbGetAll("staff")).filter(s => s.active !== false);
  document.getElementById("lockShopName").textContent = shopName;

  const box = document.getElementById("lockStaffList");
  box.innerHTML = staff.length
    ? staff.map(s => `<button class="lock-staff-btn" onclick="selectOperator(${s.id})">${escapeHtml(s.name)}${s.pin ? " 🔒" : ""}</button>`).join("")
    : `<div class="empty-state">No active staff to sign in as. Reactivate someone under Staff & Payroll.</div>`;
}

function hideLockScreen() {
  document.getElementById("lockScreen").classList.add("hidden");
}

function lockApp() {
  currentOperatorId = null;
  currentOperatorIsManager = false;
  renderOperatorDisplay();
  applyRoleBasedUI();
  showLockScreen();
}

async function saveShopName() {
  const input = document.getElementById("shopNameInput");
  const value = input.value.trim();
  if (!value) return alert("Enter a shop name.");
  shopName = value;
  await dbPut("settings", { key: "shopName", value });
  document.getElementById("shopNameLabel").textContent = value;
  alert("Shop name saved.");
}

document.addEventListener("DOMContentLoaded", initApp);

/***********************************
 * SHARED MODAL
 * One generic modal that every module reuses, instead of each
 * feature building its own popup markup from scratch.
 ***********************************/
function showModal({ title, bodyHtml, saveLabel = "Save", onSave, wide = false, hideFooter = false }) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-overlay" id="activeModalOverlay">
      <div class="modal-box ${wide ? "modal-wide" : ""}">
        <div class="modal-head">
          <h3>${title}</h3>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${hideFooter ? "" : `
          <div class="modal-foot">
            <button class="btn" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="modalSaveBtn">${saveLabel}</button>
          </div>
        `}
      </div>
    </div>
  `;
  if (!hideFooter) {
    document.getElementById("modalSaveBtn").onclick = onSave;
  }
}

function closeModal() {
  document.getElementById("modalRoot").innerHTML = "";
}

/***********************************
 * PIN AUTHORIZATION
 * Restricted to Managers specifically — not just anyone with a PIN.
 * Used for every delete/remove/refund action across the app (invoices,
 * staff, inventory, services, everything "important"). If no one is
 * set up as Manager yet, this blocks the action and tells you how to
 * fix it, rather than quietly letting anyone through.
 ***********************************/
async function authorizePin(actionLabel) {
  const allStaff = staffCache && staffCache.length ? staffCache : await dbGetAll("staff");
  const managers = allStaff.filter(s => s.isManager && s.pin);

  if (!managers.length) {
    alert(
      `Only a Manager can ${actionLabel}, but no Manager is set up yet.\n\n` +
      `Go to Staff & Payroll, edit a staff member, tick "Manager", and set their PIN — then this will work.`
    );
    return false;
  }

  const entered = prompt(`Enter MANAGER PIN to authorize: ${actionLabel}`);
  if (entered === null) return false;

  const match = managers.find(s => String(s.pin) === String(entered).trim());
  if (!match) { alert("Incorrect manager PIN."); return false; }
  return true;
}
