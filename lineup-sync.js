/* ── Lineup Sync — salva o lineup de cada jogador e permite ver o de outros ── */

let _viewingUser       = null; /* null = vendo meu próprio lineup */
let _hasUnsavedChanges = false;

/* ── Chamado por saveLineupState() no app.js após cada mudança ──
   Apenas marca como não-salvo; não envia ao Supabase automaticamente. */
function autosaveLineup() {
  if (_viewingUser !== null || !isAdmin()) return;
  _hasUnsavedChanges = true;
  _updateSaveButton();
}

/* ── Atualiza visual do botão de salvar ── */
function _updateSaveButton() {
  const btn = document.getElementById("saveLineup");
  if (!btn) return;
  btn.classList.toggle("has-unsaved", _hasUnsavedChanges);
}

/* ── Publicar lineup para outros verem (chamado pelo botão "Salvar Line Up") ── */
async function publishLineup() {
  if (_viewingUser !== null || !isAdmin()) return;
  const btn = document.getElementById("saveLineup");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Salvando...";
  }
  await _doSaveLineup();
  _hasUnsavedChanges = false;
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<span class="label-full">Salvar Line Up</span><span class="label-short">Salvar</span>';
    btn.classList.remove("has-unsaved");
    btn.classList.add("is-saved");
    setTimeout(() => btn.classList.remove("is-saved"), 2000);
  }
}

async function _doSaveLineup() {
  if (_viewingUser !== null || !isAdmin()) return;
  const u   = getUser();
  const raw = localStorage.getItem("ttb_lineup_" + u);
  if (!raw) return;
  try {
    await fetch(`${AUTH_SUPABASE_URL}/rest/v1/lineups?on_conflict=username`, {
      method:  "POST",
      headers: {
        apikey:          AUTH_SUPABASE_KEY,
        Authorization:   `Bearer ${AUTH_SUPABASE_KEY}`,
        "Content-Type":  "application/json",
        Prefer:          "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ username: u, state: JSON.parse(raw), updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error("Erro ao salvar lineup:", err);
  }
}

/* ── Carrega lineup de outro usuário ── */
async function _loadUserLineup(username) {
  try {
    const res = await fetch(
      `${AUTH_SUPABASE_URL}/rest/v1/lineups?select=state&username=eq.${encodeURIComponent(username)}`,
      {
        headers: {
          apikey:        AUTH_SUPABASE_KEY,
          Authorization: `Bearer ${AUTH_SUPABASE_KEY}`,
        },
      },
    );
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    return rows[0]?.state || null;
  } catch {
    return null;
  }
}

/* ── Aplica um estado no campo sem salvar ── */
function _applyState(state) {
  if (!state) {
    assignments   = buildEmptyAssignments();
    battingOrders = {};
    lineupPending = new Set();
    bancoPlayers  = new Set();
    dhEnabled     = false;
    dhAssignment  = "";
  } else {
    if (state.assignments)   assignments   = state.assignments;
    if (state.battingOrders) battingOrders = state.battingOrders;
    if (state.lineupPending) lineupPending = new Set(state.lineupPending);
    if (state.bancoPlayers)  bancoPlayers  = new Set(state.bancoPlayers);
    dhEnabled    = state.dhEnabled    ?? false;
    dhAssignment = state.dhAssignment ?? "";
  }
  render();
}

/* ── Troca de usuário no switcher ── */
async function switchToUser(username) {
  const me = getUser();
  _viewingUser = (username === me && isAdmin()) ? null : username;

  if (_viewingUser === null) {
    document.body.classList.remove("is-viewing-other");
    loadLineupState();
    render();
  } else {
    document.body.classList.add("is-viewing-other");
    const state = await _loadUserLineup(_viewingUser);
    _applyState(state);
    /* Abre o painel automaticamente para espectadores e admins visualizando */
    if (typeof setLineupPanelCollapsed === "function") {
      setLineupPanelCollapsed(false);
    }
  }

  _renderSwitcher();
}

/* ── Desenha o switcher de usuários ── */
function _renderSwitcher() {
  const container = document.getElementById("lineupSwitcher");
  if (!container) return;

  const me      = getUser();
  const members = (getAdminProfiles() || []).map((p) => p.login);

  container.innerHTML = "";

  /* Botão "Meu lineup" para admins */
  if (isAdmin()) {
    const myBtn = document.createElement("button");
    myBtn.className   = "lsw-btn" + (_viewingUser === null ? " is-active" : "");
    myBtn.textContent = "Meu lineup";
    myBtn.addEventListener("click", () => switchToUser(me));
    container.appendChild(myBtn);
  }

  /* Botões para cada membro (exceto eu mesmo se já tenho "Meu lineup") */
  members.forEach((u) => {
    if (u === me && isAdmin()) return;
    const btn = document.createElement("button");
    btn.className   = "lsw-btn" + (_viewingUser === u ? " is-active" : "");
    btn.textContent = u;
    btn.addEventListener("click", () => switchToUser(u));
    container.appendChild(btn);
  });

  /* Label de quem está sendo visto */
  if (_viewingUser) {
    const lbl = document.createElement("span");
    lbl.className   = "lsw-viewing-label";
    lbl.textContent = `👁 Vendo lineup de ${_viewingUser}`;
    container.appendChild(lbl);
  }

  container.hidden = members.length < 2 && !isSpectator();
}

/* ── Init ── */
document.addEventListener("DOMContentLoaded", () => {
  if (document.documentElement.dataset.page !== "lineup") return;

  /* Mostra e conecta o botão "Salvar Line Up" apenas para admins */
  const saveBtn = document.getElementById("saveLineup");
  if (saveBtn && isAdmin()) {
    saveBtn.hidden = false;
    saveBtn.addEventListener("click", publishLineup);
  }

  _renderSwitcher();
  /* Re-renderiza após os perfis online carregarem */
  getAdminProfilesOnline().then(() => _renderSwitcher()).catch(() => {});

  /* Fallback: se localStorage estiver vazio, tenta carregar do Supabase */
  if (isAdmin()) {
    const u = getUser();
    const localRaw = localStorage.getItem("ttb_lineup_" + u);
    if (!localRaw) {
      _loadUserLineup(u).then((state) => {
        if (state) {
          _applyState(state);
          _hasUnsavedChanges = false;
          _updateSaveButton();
        }
      }).catch(() => {});
    }
  }
});
