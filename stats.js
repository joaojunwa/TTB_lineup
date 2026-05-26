/* ── Player Stats ── */

const STATS_KEY = "ttb_player_stats_v2";

function _loadAllStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) || {};
  } catch (_) {
    return {};
  }
}

function _saveAllStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (_) {}
}

function _calcAvg(h, ab) {
  if (!ab || ab <= 0) return null;
  return h / ab;
}

function _fmtAvg(h, ab) {
  const avg = _calcAvg(h, ab);
  if (avg === null) return "—";
  return avg.toFixed(3).replace(/^0/, "");
}

/* Same slug logic as app.js so IDs match stored stats */
function _slug(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/* Build the full player list with stable IDs matching app.js */
function _buildStatPlayers() {
  const players = [];
  const seen = new Set();

  const lineupData = Array.isArray(window.LINEUP_DATA) ? window.LINEUP_DATA : [];
  const benchData  = Array.isArray(window.BENCH_DATA)  ? window.BENCH_DATA  : [];

  lineupData.forEach((p, i) => {
    const id = `lineup-${i}-${_slug(p.name)}-${p.number || "sn"}`;
    if (!seen.has(id)) {
      seen.add(id);
      players.push({ id, name: p.name, number: p.number || "", photo: p.photo || "" });
    }
  });

  benchData.forEach((p, i) => {
    const id = `bench-${i}-${_slug(p.name)}-${p.number || "sn"}`;
    if (!seen.has(id)) {
      seen.add(id);
      players.push({ id, name: p.name, number: p.number || "", photo: p.photo || "" });
    }
  });

  /* Custom players from localStorage */
  try {
    const cps = JSON.parse(localStorage.getItem("ttb_custom_players_v1")) || [];
    if (Array.isArray(cps)) {
      cps.forEach((cp) => {
        if (cp.id && !seen.has(cp.id)) {
          seen.add(cp.id);
          players.push({ id: cp.id, name: cp.name, number: cp.number || "", photo: cp.photo || "" });
        }
      });
    }
  } catch (_) {}

  return players;
}

/* ── State ── */
let _statsSearch = "";
let _statsSort   = "avg"; /* default: best AVG on top */

/* ── Render ── */
function renderStatsPage() {
  const tbody = document.getElementById("statsBody");
  if (!tbody) return;

  const stats = _loadAllStats();
  let players = _buildStatPlayers();

  /* Search filter */
  const term = _statsSearch.trim().toLowerCase();
  if (term) {
    players = players.filter((p) =>
      p.name.toLowerCase().includes(term) ||
      String(p.number || "").includes(term),
    );
  }

  /* Sort */
  players.sort((a, b) => {
    const sa = stats[a.id] || { h: 0, ab: 0 };
    const sb = stats[b.id] || { h: 0, ab: 0 };

    if (_statsSort === "avg") {
      const aa = _calcAvg(sa.h, sa.ab);
      const ba = _calcAvg(sb.h, sb.ab);
      /* Players with no AB go to the bottom */
      if (aa === null && ba === null) return (sb.h || 0) - (sa.h || 0);
      if (aa === null) return 1;
      if (ba === null) return -1;
      if (ba !== aa) return ba - aa;
      /* Same AVG: more hits on top */
      return (sb.h || 0) - (sa.h || 0);
    }

    if (_statsSort === "hits") return (sb.h || 0) - (sa.h || 0);
    if (_statsSort === "ab")   return (sb.ab || 0) - (sa.ab || 0);
    /* name */
    return a.name.localeCompare(b.name, "pt-BR");
  });

  tbody.innerHTML = "";
  players.forEach((player) => {
    const s  = stats[player.id] || { h: 0, ab: 0 };
    const id = player.id;
    const tr = document.createElement("tr");
    tr.className = "stats-row";

    /* Player cell */
    const tdPlayer = document.createElement("td");
    tdPlayer.className = "stats-td-player";
    const img = document.createElement("img");
    img.className = "stats-photo";
    img.alt = "";
    img.src = player.photo || "";
    img.addEventListener("error", () => {
      const initials = encodeURIComponent(
        String(player.name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?",
      );
      img.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'%3E%3Crect width='60' height='60' fill='%232b383b'/%3E%3Ctext x='30' y='38' text-anchor='middle' font-family='Arial,sans-serif' font-size='20' font-weight='700' fill='%23f7c948'%3E${initials}%3C/text%3E%3C/svg%3E`;
    }, { once: true });
    const nameSpan = document.createElement("span");
    nameSpan.className = "stats-name";
    nameSpan.textContent = player.name;
    const numSpan = document.createElement("span");
    numSpan.className = "stats-number";
    numSpan.textContent = player.number ? `#${player.number}` : "";
    tdPlayer.append(img, nameSpan, numSpan);

    /* AB cell */
    const tdAb = document.createElement("td");
    tdAb.className = "stats-td-num";
    const abInput = document.createElement("input");
    abInput.className = "stats-input";
    abInput.type = "number";
    abInput.min = "0";
    abInput.value = s.ab || 0;
    abInput.setAttribute("aria-label", `AB de ${player.name}`);
    abInput.dataset.playerId = id;
    abInput.dataset.field = "ab";
    tdAb.append(abInput);

    /* H cell */
    const tdH = document.createElement("td");
    tdH.className = "stats-td-num";
    const hInput = document.createElement("input");
    hInput.className = "stats-input";
    hInput.type = "number";
    hInput.min = "0";
    hInput.value = s.h || 0;
    hInput.setAttribute("aria-label", `Hits de ${player.name}`);
    hInput.dataset.playerId = id;
    hInput.dataset.field = "h";
    tdH.append(hInput);

    /* AVG cell */
    const tdAvg = document.createElement("td");
    tdAvg.className = "stats-td-avg";
    tdAvg.dataset.avgFor = id;
    tdAvg.textContent = _fmtAvg(s.h, s.ab);

    tr.append(tdPlayer, tdAb, tdH, tdAvg);
    tbody.append(tr);

    /* Save on change, update AVG live, re-sort */
    function onInputChange(e) {
      const field = e.target.dataset.field;
      const val   = Math.max(0, parseInt(e.target.value, 10) || 0);
      e.target.value = val;
      const all = _loadAllStats();
      if (!all[id]) all[id] = { h: 0, ab: 0 };
      all[id][field] = val;
      _saveAllStats(all);
      /* Update AVG display in this row without full re-sort */
      tdAvg.textContent = _fmtAvg(all[id].h, all[id].ab);
    }

    abInput.addEventListener("change", onInputChange);
    hInput.addEventListener("change", onInputChange);

    /* Disable inputs for spectators */
    if (typeof isSpectator === "function" && isSpectator()) {
      abInput.disabled = true;
      hInput.disabled  = true;
    }
  });
}

/* ── Init ── */
document.addEventListener("DOMContentLoaded", () => {
  if (document.documentElement.dataset.page !== "stats") return;

  /* Set default sort select value */
  const sortSelect = document.getElementById("statsSort");
  if (sortSelect) sortSelect.value = _statsSort;

  document.getElementById("statsSearch")?.addEventListener("input", (e) => {
    _statsSearch = e.target.value;
    renderStatsPage();
  });

  sortSelect?.addEventListener("change", (e) => {
    _statsSort = e.target.value;
    renderStatsPage();
  });

  renderStatsPage();
});
