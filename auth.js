const AUTH_KEY   = "ttb_auth";
const ADMIN_USER = "jun";
const ADMIN_PASS = "kenjipequeno";

/* ── Leitura ── */
function getAuth()      { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; } }
function getRole()      { return getAuth()?.role || null; }
function getUser()      { return getAuth()?.user || ""; }
function isAdmin()      { return getRole() === "admin"; }
function isSpectator()  { return getRole() === "spectator"; }
function isLoggedIn()   { return isAdmin() || isSpectator(); }

/* ── Login / Logout ── */
function loginAdmin(user, pass) {
  if (user.trim() === ADMIN_USER && pass === ADMIN_PASS) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ role: "admin", user: user.trim() }));
    return true;
  }
  return false;
}

function loginSpectator(name) {
  if (!name?.trim()) return false;
  localStorage.setItem(AUTH_KEY, JSON.stringify({ role: "spectator", user: name.trim() }));
  return true;
}

function logout() {
  localStorage.removeItem(AUTH_KEY);
  window.location.replace("login.html");
}

/* ── Guarda o corpo invisível até autenticar (evita flash) ── */
if (document.documentElement.dataset.page !== "login") {
  document.documentElement.style.visibility = "hidden";
}

/* ── Verificação de acesso ── */
function checkAuth(adminOnly = false) {
  if (document.documentElement.dataset.page === "login") return true;

  if (!isLoggedIn()) {
    window.location.replace("login.html");
    return false;
  }

  const page = window.location.pathname.split("/").pop() || "index.html";

  if (isSpectator() && page !== "status.html") {
    window.location.replace("status.html");
    return false;
  }

  if (adminOnly && !isAdmin()) {
    window.location.replace("status.html");
    return false;
  }

  document.documentElement.style.visibility = "";
  return true;
}

/* ── Modo espectador: bloqueia controles via CSS ── */
function applySpectatorMode() {
  if (!isSpectator()) return;
  document.body.classList.add("is-spectator");
}

/* ── Badge de usuário + botão Sair ── */
document.addEventListener("DOMContentLoaded", () => {
  if (!isLoggedIn()) return;

  /* Botões de logout em qualquer página */
  document.querySelectorAll(".btn-logout").forEach((btn) => {
    btn.addEventListener("click", logout);
    btn.textContent = "Sair";
  });

  /* Badge no nav da página de status */
  const navRight = document.querySelector(".gd-nav-right");
  if (navRight && isLoggedIn()) {
    const badge = document.createElement("span");
    badge.className = `auth-badge${isSpectator() ? " auth-badge-spectator" : ""}`;
    badge.textContent = isSpectator() ? `👁 ${getUser()}` : `⚙ ${getUser()}`;
    navRight.prepend(badge);
  }

  applySpectatorMode();
});
