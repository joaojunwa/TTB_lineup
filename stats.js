/* ── Player Stats ── */

const STATS_KEY        = "ttb_player_stats_v2";
const STATS_SORT_KEY   = "ttb_stats_sort";
const STATS_SOURCE_KEY = "ttb_stats_sources";
const STATS_UPDATED_KEY = "ttb_player_stats_updated_at";
const STATS_REMOTE_ID   = "ttb_player_stats_global";
const LIVE_BP_CACHE_KEY = "ttb_live_bp_stats_cache";
const LIVE_BP_STATS_KEY = "ttb_live_bp_player_stats_v1";
const LIVE_BP_STATS_UPDATED_KEY = "ttb_live_bp_player_stats_updated_at";
const LIVE_BP_STATS_REMOTE_ID = "ttb_live_bp_player_stats_global";
const AVG_QUALIFYING_APPEARANCES = 4;

const STAT_SOURCE_CONFIG = {
  game: {
    key: STATS_KEY,
    updatedKey: STATS_UPDATED_KEY,
    remoteId: STATS_REMOTE_ID,
  },
  liveBp: {
    key: LIVE_BP_STATS_KEY,
    updatedKey: LIVE_BP_STATS_UPDATED_KEY,
    remoteId: LIVE_BP_STATS_REMOTE_ID,
  },
};

/* ─── Storage ─────────────────────────────────────── */

function _loadAllStats() {
  return _loadSourceStats("game");
}

function _loadSourceStats(source = "game") {
  const config = STAT_SOURCE_CONFIG[source] || STAT_SOURCE_CONFIG.game;
  try { return JSON.parse(localStorage.getItem(config.key)) || {}; }
  catch (_) { return {}; }
}

function _loadStatsSources() {
  return { game: false, liveBp: false };
}

function _saveStatsSources() {
  try { localStorage.removeItem(STATS_SOURCE_KEY); }
  catch (_) {}
}

function _saveAllStats(stats, options = {}) {
  _saveSourceStats("game", stats, options);
}

function _saveSourceStats(source = "game", stats, options = {}) {
  const config = STAT_SOURCE_CONFIG[source] || STAT_SOURCE_CONFIG.game;
  try {
    localStorage.setItem(config.key, JSON.stringify(stats));
    if (options.updatedAt) localStorage.setItem(config.updatedKey, options.updatedAt);
    else if (options.touch !== false) localStorage.setItem(config.updatedKey, new Date().toISOString());
  }
  catch (_) {}
  if (options.remote !== false) _scheduleRemoteStatsSave(source, stats);
}

function _canUseRemoteStats() {
  return typeof AUTH_SUPABASE_URL !== "undefined" && typeof AUTH_SUPABASE_KEY !== "undefined";
}

function _remoteStatsHeaders(extra = {}) {
  return {
    apikey: AUTH_SUPABASE_KEY,
    Authorization: `Bearer ${AUTH_SUPABASE_KEY}`,
    ...extra,
  };
}

function _remoteStatsUrl(params = "") {
  return `${AUTH_SUPABASE_URL}/rest/v1/jogos${params}`;
}

async function _fetchRemoteStats(source = "game") {
  if (!_canUseRemoteStats()) return null;
  const config = STAT_SOURCE_CONFIG[source] || STAT_SOURCE_CONFIG.game;
  const res = await fetch(
    _remoteStatsUrl(`?select=state,updated_at&id=eq.${encodeURIComponent(config.remoteId)}`),
    { headers: _remoteStatsHeaders() },
  );
  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  const row = rows[0];
  if (!row?.state) return null;
  return {
    stats: row.state.stats || {},
    updatedAt: row.updated_at || row.state.updated_at || "",
  };
}

async function _saveRemoteStats(source = "game", stats, updatedAt = new Date().toISOString()) {
  if (!_canUseRemoteStats()) return;
  const config = STAT_SOURCE_CONFIG[source] || STAT_SOURCE_CONFIG.game;
  const res = await fetch(_remoteStatsUrl("?on_conflict=id"), {
    method: "POST",
    headers: _remoteStatsHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      id: config.remoteId,
      state: { stats, updated_at: updatedAt },
      updated_at: updatedAt,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
}

const _remoteSaveTimers = {};

function _scheduleRemoteStatsSave(source = "game", stats) {
  if (!_canUseRemoteStats()) return;
  const config = STAT_SOURCE_CONFIG[source] || STAT_SOURCE_CONFIG.game;
  clearTimeout(_remoteSaveTimers[source]);
  const snapshot = JSON.parse(JSON.stringify(stats || {}));
  const updatedAt = new Date().toISOString();
  try { localStorage.setItem(config.updatedKey, updatedAt); } catch (_) {}
  _remoteSaveTimers[source] = setTimeout(() => {
    _saveRemoteStats(source, snapshot, updatedAt).catch((err) => console.warn("Erro ao salvar stats:", err));
  }, 500);
}

async function _syncRemoteStats(source = "game") {
  if (!_canUseRemoteStats()) return;
  const config = STAT_SOURCE_CONFIG[source] || STAT_SOURCE_CONFIG.game;
  try {
    const remote = await _fetchRemoteStats(source);
    const localStats = _loadSourceStats(source);
    const localUpdated = localStorage.getItem(config.updatedKey) || "";
    const remoteHasStats = Object.keys(remote?.stats || {}).length > 0;
    const localHasStats = Object.keys(localStats).length > 0;

    if (remoteHasStats && (!localHasStats || !localUpdated || !remote.updatedAt || remote.updatedAt >= localUpdated)) {
      _saveSourceStats(source, remote.stats, { remote: false, touch: false, updatedAt: remote.updatedAt });
      renderStatsPage();
      return;
    }

    if (localHasStats) {
      await _saveRemoteStats(source, localStats, localUpdated || new Date().toISOString());
    }
  } catch (err) {
    console.warn("Stats em modo local:", err);
  }
}

function _emptyStat() {
  return { h: 0, ab: 0, bb: 0, hbp: 0, k: 0, hr: 0 };
}

function _addStats(target, id, source = {}) {
  if (!target[id]) target[id] = _emptyStat();
  target[id].h  += source.h  || source.hits || 0;
  target[id].ab += source.ab || 0;
  target[id].bb += source.bb || 0;
  target[id].hbp += source.hbp || source.hitByPitch || 0;
  target[id].k  += source.k  || 0;
  target[id].hr += source.hr || source.homeRuns || 0;
}

function _normalizeStat(source = {}) {
  return {
    h: Math.max(0, Number(source.h || source.hits || 0) || 0),
    ab: Math.max(0, Number(source.ab || 0) || 0),
    bb: Math.max(0, Number(source.bb || 0) || 0),
    hbp: Math.max(0, Number(source.hbp || source.hitByPitch || 0) || 0),
    k: Math.max(0, Number(source.k || 0) || 0),
    hr: Math.max(0, Number(source.hr || source.homeRuns || 0) || 0),
  };
}

function _hasStats(stat = {}) {
  return (stat.ab || 0) > 0 || (stat.h || 0) > 0 || (stat.bb || 0) > 0 || (stat.hbp || 0) > 0 || (stat.k || 0) > 0 || (stat.hr || 0) > 0;
}

function _hasAnyStats(stats = {}) {
  return Object.values(stats || {}).some((stat) => _hasStats(stat));
}

function _combineStats(...sources) {
  const combined = {};
  sources.forEach((source) => {
    Object.entries(source || {}).forEach(([id, stat]) => _addStats(combined, id, stat));
  });
  return combined;
}

function _mergeStats(base = {}, incoming = {}) {
  const merged = {};
  Object.entries(base || {}).forEach(([id, stat]) => {
    merged[id] = _normalizeStat(stat);
  });
  Object.entries(incoming || {}).forEach(([id, stat]) => {
    _addStats(merged, id, stat);
  });
  return merged;
}

function _containsStats(container = {}, incoming = {}) {
  return Object.entries(incoming || {}).every(([id, stat]) => {
    const current = _normalizeStat(container[id] || {});
    const needed = _normalizeStat(stat);
    return current.h >= needed.h && current.ab >= needed.ab && current.bb >= needed.bb && current.hbp >= needed.hbp && current.k >= needed.k && current.hr >= needed.hr;
  });
}

function _recoverLiveBpToGameIfNeeded() {
  const game = _loadSourceStats("game");
  if (_hasAnyStats(game)) return;
  const liveBp = _loadSourceStats("liveBp");
  if (_hasAnyStats(liveBp)) {
    _saveSourceStats("game", liveBp, { remote: false });
  }
}

function _nameKey(value) {
  const normalizer = (typeof slug === "function") ? slug : (v) =>
    String(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return normalizer(value);
}

let _liveBpByName = {};
let _liveBpLoaded = false;

function _loadCachedLiveBpStats() {
  try {
    const cached = JSON.parse(localStorage.getItem(LIVE_BP_CACHE_KEY));
    if (cached && typeof cached === "object") {
      _liveBpByName = cached;
      _liveBpLoaded = true;
    }
  } catch (_) {}
}

async function _fetchLiveBpStats() {
  if (!_canUseRemoteStats()) return;
  try {
    const res = await fetch(
      `${AUTH_SUPABASE_URL}/rest/v1/treinos?select=nome_jogador,ab,hits,bb,k&limit=5000`,
      { headers: _remoteStatsHeaders() },
    );
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    const byName = {};
    rows.forEach((row) => {
      const key = _nameKey(row.nome_jogador || "");
      if (!key) return;
      if (!byName[key]) byName[key] = _emptyStat();
      byName[key].name = row.nome_jogador || byName[key].name || key;
      byName[key].ab += (Number(row.ab) || 0) + (Number(row.bb) || 0) + (Number(row.hbp || row.hitByPitch) || 0);
      byName[key].h  += Number(row.hits) || 0;
      byName[key].bb += Number(row.bb) || 0;
      byName[key].hbp += Number(row.hbp || row.hitByPitch) || 0;
      byName[key].k  += Number(row.k) || 0;
      byName[key].hr += Number(row.hr || row.homeRuns) || 0;
    });
    _liveBpByName = byName;
    _liveBpLoaded = true;
    localStorage.setItem(LIVE_BP_CACHE_KEY, JSON.stringify(byName));
    renderStatsPage();
  } catch (err) {
    console.warn("Live BP em modo local:", err);
  }
}

function _mapLiveBpStatsToPlayers(players) {
  const mapped = {};
  players.forEach((player) => {
    const stat = _liveBpByName[_nameKey(player.name)];
    if (stat) mapped[player.id] = _normalizeStat(stat);
  });
  return mapped;
}

function _buildLiveBpStats(players) {
  const stats = _mapLiveBpStatsToPlayers(players);
  const saved = _loadSourceStats("liveBp");
  Object.entries(saved).forEach(([id, stat]) => {
    stats[id] = _normalizeStat(stat);
  });
  return stats;
}

/* ─── Math ─────────────────────────────────────────── */

function _officialAtBats(ab, bb, hbp = 0) {
  return Math.max(0, (Number(ab) || 0) - (Number(bb) || 0) - (Number(hbp) || 0));
}

function _calcAvg(h, ab, bb = 0, hbp = 0) {
  const officialAb = _officialAtBats(ab, bb, hbp);
  if (!officialAb || officialAb <= 0 || h < 0) return null;
  return Math.min(h / officialAb, 1); /* cap at 1.000 if data error */
}

function _fmtAvg(h, ab, bb = 0, hbp = 0) {
  const avg = _calcAvg(h, ab, bb, hbp);
  if (avg === null) return "—";
  return avg.toFixed(3).replace(/^0/, "");
}

function _avgClass(h, ab, bb = 0, hbp = 0) {
  const avg = _calcAvg(h, ab, bb, hbp);
  if (avg === null)  return "stats-avg-none";
  if (avg >= 0.400)  return "stats-avg-elite";
  if (avg >= 0.300)  return "stats-avg-good";
  if (avg >= 0.200)  return "stats-avg-ok";
  return "stats-avg-low";
}

/* ─── Player list (rebuilt from globals — roster const is not on window) ── */

function _buildStatPlayers() {
  const players = [];
  const seen    = new Set();
  /* `slug` is a function declaration in app.js, available globally */
  const _s = (typeof slug === "function") ? slug : (v) =>
    String(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  (window.LINEUP_DATA || []).forEach((p, i) => {
    const id = `lineup-${i}-${_s(p.name)}-${p.number || "sn"}`;
    if (!seen.has(id)) { seen.add(id); players.push({ id, name: p.name, number: p.number || "", photo: p.photo || "" }); }
  });

  (window.BENCH_DATA || []).forEach((p, i) => {
    const id = `bench-${i}-${_s(p.name)}-${p.number || "sn"}`;
    if (!seen.has(id)) { seen.add(id); players.push({ id, name: p.name, number: p.number || "", photo: p.photo || "" }); }
  });

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

/* ─── Sorting ──────────────────────────────────────── */

let _statsSearch = "";
let _statsSort   = localStorage.getItem(STATS_SORT_KEY) || "avg";
let _statsSources = _loadStatsSources();

function _sortPlayers(players, stats) {
  return [...players].sort((a, b) => {
    const sa = stats[a.id] || { h: 0, ab: 0 };
    const sb = stats[b.id] || { h: 0, ab: 0 };

    if (_statsSort === "avg") {
      const aa = _calcAvg(sa.h, sa.ab, sa.bb, sa.hbp);
      const ba = _calcAvg(sb.h, sb.ab, sb.bb, sb.hbp);
      const officialAa = _officialAtBats(sa.ab, sa.bb, sa.hbp);
      const officialBa = _officialAtBats(sb.ab, sb.bb, sb.hbp);
      const appearancesA = Number(sa.ab) || 0;
      const appearancesB = Number(sb.ab) || 0;
      const qualifiedA = appearancesA >= AVG_QUALIFYING_APPEARANCES;
      const qualifiedB = appearancesB >= AVG_QUALIFYING_APPEARANCES;
      if (aa === null && ba === null) return (sb.h || 0) - (sa.h || 0);
      if (aa === null) return 1;
      if (ba === null) return -1;
      if (qualifiedA !== qualifiedB) return qualifiedB ? 1 : -1;
      if (Math.abs(ba - aa) > 1e-9) return ba - aa;
      if ((sb.hr || 0) !== (sa.hr || 0)) return (sb.hr || 0) - (sa.hr || 0);
      if (appearancesB !== appearancesA) return appearancesB - appearancesA;
      if (officialBa !== officialAa) return officialBa - officialAa;
      return (sb.h || 0) - (sa.h || 0);
    }
    if (_statsSort === "hits") return (sb.h || 0) - (sa.h || 0);
    if (_statsSort === "hr")   return (sb.hr || 0) - (sa.hr || 0);
    if (_statsSort === "ab")   return (sb.ab || 0) - (sa.ab || 0);
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

/* ─── Debounced re-sort ─────────────────────────────── */

let _resortTimer = null;

function _scheduleResort() {
  clearTimeout(_resortTimer);
  _resortTimer = setTimeout(() => renderStatsPage(), 1500);
}

/* ─── Render ─────────────────────────────────────────── */

function renderStatsPage() {
  const tbody = document.getElementById("statsBody");
  if (!tbody) return;

  clearTimeout(_resortTimer);

  let players = _buildStatPlayers();
  const useAllSources = !_statsSources.game && !_statsSources.liveBp;
  const useGameStats = _statsSources.game || useAllSources;
  const useLiveBpStats = _statsSources.liveBp || useAllSources;
  const gameStats = useGameStats ? _loadAllStats() : {};
  const liveBpStats = useLiveBpStats ? _buildLiveBpStats(players) : {};
  const stats = _combineStats(gameStats, liveBpStats);
  const editSource =
    _statsSources.game && !_statsSources.liveBp ? "game" :
    _statsSources.liveBp && !_statsSources.game ? "liveBp" :
    "";
  const canEdit =
    Boolean(editSource) &&
    !(typeof isSpectator === "function" && isSpectator());

  const term = _statsSearch.trim().toLowerCase();
  if (term) {
    players = players.filter((p) =>
      p.name.toLowerCase().includes(term) || String(p.number).includes(term),
    );
  }

  if (!canEdit) players = players.filter((p) => _hasStats(stats[p.id]));

  players = _sortPlayers(players, stats);

  /* ── Team totals ── */
  let teamH = 0, teamAb = 0, teamBb = 0, teamHbp = 0, teamK = 0, teamHr = 0;
  players.forEach((p) => {
    const s = stats[p.id] || {};
    teamH  += s.h  || 0;
    teamAb += s.ab || 0;
    teamBb += s.bb || 0;
    teamHbp += s.hbp || 0;
    teamK  += s.k  || 0;
    teamHr += s.hr || 0;
  });

  tbody.innerHTML = "";

  players.forEach((player, idx) => {
    const s  = stats[player.id] || _emptyStat();
    const id = player.id;
    const rank = _statsSort === "avg" || _statsSort === "hits" || _statsSort === "hr" || _statsSort === "ab" ? idx + 1 : null;
    const hasData = _hasStats(s);

    const tr = document.createElement("tr");
    tr.className = "stats-row";
    tr.dataset.playerId = id;

    /* Rank cell */
    const tdRank = document.createElement("td");
    tdRank.className = "stats-td-rank";
    if (rank && hasData) {
      tdRank.textContent = `#${rank}`;
      if (rank === 1) tdRank.classList.add("stats-rank-gold");
      else if (rank === 2) tdRank.classList.add("stats-rank-silver");
      else if (rank === 3) tdRank.classList.add("stats-rank-bronze");
    }

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

    const nameWrap = document.createElement("span");
    nameWrap.className = "stats-player-info";
    const nameSpan = document.createElement("span");
    nameSpan.className = "stats-name";
    nameSpan.textContent = player.name;
    const numSpan = document.createElement("span");
    numSpan.className = "stats-number";
    numSpan.textContent = player.number ? `#${player.number}` : "";
    nameWrap.append(nameSpan, numSpan);
    tdPlayer.append(img, nameWrap);

    /* Clear button (admin only) */
    if (canEdit && hasData) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "stats-clear-btn";
      clearBtn.title = "Limpar estatísticas";
      clearBtn.textContent = "×";
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const all = _loadSourceStats(editSource);
        if (editSource === "liveBp") all[id] = _emptyStat();
        else delete all[id];
        _saveSourceStats(editSource, all);
        renderStatsPage();
      });
      tdPlayer.append(clearBtn);
    }

    /* AB input */
    const tdAb = document.createElement("td");
    tdAb.className = "stats-td-num";
    const abInput = _makeStatInput("AB de " + player.name, s.ab || 0, canEdit);
    abInput.dataset.playerId = id;
    abInput.dataset.field = "ab";
    tdAb.append(abInput);

    /* H input */
    const tdH = document.createElement("td");
    tdH.className = "stats-td-num";
    const hInput = _makeStatInput("Hits de " + player.name, s.h || 0, canEdit);
    hInput.dataset.playerId = id;
    hInput.dataset.field = "h";
    tdH.append(hInput);

    /* HR input */
    const tdHr = document.createElement("td");
    tdHr.className = "stats-td-num";
    const hrInput = _makeStatInput("Home runs de " + player.name, s.hr || 0, canEdit);
    hrInput.dataset.playerId = id;
    hrInput.dataset.field = "hr";
    tdHr.append(hrInput);

    /* BB input */
    const tdBb = document.createElement("td");
    tdBb.className = "stats-td-num";
    const bbInput = _makeStatInput("BB de " + player.name, s.bb || 0, canEdit);
    bbInput.dataset.playerId = id;
    bbInput.dataset.field = "bb";
    tdBb.append(bbInput);

    /* HBP input */
    const tdHbp = document.createElement("td");
    tdHbp.className = "stats-td-num";
    const hbpInput = _makeStatInput("HBP de " + player.name, s.hbp || 0, canEdit);
    hbpInput.dataset.playerId = id;
    hbpInput.dataset.field = "hbp";
    tdHbp.append(hbpInput);

    /* K input */
    const tdK = document.createElement("td");
    tdK.className = "stats-td-num";
    const kInput = _makeStatInput("K de " + player.name, s.k || 0, canEdit);
    kInput.dataset.playerId = id;
    kInput.dataset.field = "k";
    tdK.append(kInput);

    /* AVG cell */
    const tdAvg = document.createElement("td");
    tdAvg.className = `stats-td-avg ${_avgClass(s.h, s.ab, s.bb, s.hbp)}`;
    tdAvg.dataset.avgFor = id;
    tdAvg.textContent = _fmtAvg(s.h, s.ab, s.bb, s.hbp);

    tr.append(tdRank, tdPlayer, tdAb, tdH, tdHr, tdBb, tdHbp, tdK, tdAvg);
    tbody.append(tr);

    /* Input handlers */
    function onInputChange(e) {
      const field = e.target.dataset.field;
      const val   = Math.max(0, parseInt(e.target.value, 10) || 0);
      e.target.value = val;

      const all = _loadSourceStats(editSource);
      if (!all[id]) all[id] = _normalizeStat(s);
      all[id][field] = val;

      /* AVG uses official at-bats: total AB minus BB. */
      let currentH  = field === "h"  ? val : (all[id].h  || 0);
      const currentAb = field === "ab" ? val : (all[id].ab || 0);
      const currentBb = field === "bb" ? val : (all[id].bb || 0);
      const currentHbp = field === "hbp" ? val : (all[id].hbp || 0);
      const currentHr = field === "hr" ? val : (all[id].hr || 0);
      /* HR também é hit: ao digitar um HR acima do H atual, o H sobe junto
         para o home run contar no AVG automaticamente */
      if (field === "hr" && currentHr > currentH) {
        currentH = currentHr;
        all[id].h = currentH;
        hInput.value = currentH;
      }
      const officialAb = _officialAtBats(currentAb, currentBb, currentHbp);
      [bbInput, hbpInput, hInput, hrInput].forEach((input) => {
        input.classList.remove("stats-input-invalid");
        input.title = "";
      });
      if (currentBb + currentHbp > currentAb) {
        bbInput.classList.add("stats-input-invalid");
        hbpInput.classList.add("stats-input-invalid");
        bbInput.title = "BB + HBP nao pode ser maior que AB";
        hbpInput.title = "BB + HBP nao pode ser maior que AB";
      } else if (currentH > officialAb) {
        hInput.classList.add("stats-input-invalid");
        hInput.title = "Hits nao pode ser maior que AB menos BB e HBP";
      } else if (currentHr > currentH) {
        hrInput.classList.add("stats-input-invalid");
        hrInput.title = "Home runs nao pode ser maior que Hits";
      } else {
        all[id].h  = currentH;
        all[id].ab = currentAb;
        all[id].bb = currentBb;
        all[id].hbp = currentHbp;
        all[id].hr = currentHr;
        _saveSourceStats(editSource, all);
      }

      /* Update AVG in place */
      tdAvg.textContent = _fmtAvg(all[id].h, all[id].ab, all[id].bb, all[id].hbp);
      tdAvg.className = `stats-td-avg ${_avgClass(all[id].h, all[id].ab, all[id].bb, all[id].hbp)}`;
      _scheduleResort();
    }

    abInput.addEventListener("change", onInputChange);
    hInput.addEventListener("change", onInputChange);
    hrInput.addEventListener("change", onInputChange);
    bbInput.addEventListener("change", onInputChange);
    hbpInput.addEventListener("change", onInputChange);
    kInput.addEventListener("change", onInputChange);
  });

  /* ── Totals row ── */
  if (players.length > 0 && teamAb > 0) {
    const tfootTr = document.createElement("tr");
    tfootTr.className = "stats-totals-row";
    const tdEmpty = document.createElement("td");
    const tdLabel = document.createElement("td");
    tdLabel.className = "stats-td-player stats-totals-label";
    tdLabel.textContent = "Time";
    const tdTotalAb = document.createElement("td");
    tdTotalAb.className = "stats-td-num";
    tdTotalAb.textContent = teamAb;
    const tdTotalH = document.createElement("td");
    tdTotalH.className = "stats-td-num";
    tdTotalH.textContent = teamH;
    const tdTotalHr = document.createElement("td");
    tdTotalHr.className = "stats-td-num";
    tdTotalHr.textContent = teamHr;
    const tdTotalBb = document.createElement("td");
    tdTotalBb.className = "stats-td-num";
    tdTotalBb.textContent = teamBb;
    const tdTotalHbp = document.createElement("td");
    tdTotalHbp.className = "stats-td-num";
    tdTotalHbp.textContent = teamHbp;
    const tdTotalK = document.createElement("td");
    tdTotalK.className = "stats-td-num";
    tdTotalK.textContent = teamK;
    const tdTotalAvg = document.createElement("td");
    tdTotalAvg.className = `stats-td-avg ${_avgClass(teamH, teamAb, teamBb, teamHbp)}`;
    tdTotalAvg.textContent = _fmtAvg(teamH, teamAb, teamBb, teamHbp);
    tfootTr.append(tdEmpty, tdLabel, tdTotalAb, tdTotalH, tdTotalHr, tdTotalBb, tdTotalHbp, tdTotalK, tdTotalAvg);
    tbody.append(tfootTr);
  }
}

function _makeStatInput(label, value, enabled) {
  const input = document.createElement("input");
  input.className = "stats-input";
  input.type = "number";
  input.min = "0";
  input.value = value;
  input.setAttribute("aria-label", label);
  if (!enabled) input.disabled = true;
  return input;
}

/* ─── Init ───────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
  if (document.documentElement.dataset.page !== "stats") return;

  const sortSelect = document.getElementById("statsSort");
  if (sortSelect) sortSelect.value = _statsSort;
  const gameSource = document.getElementById("statsSourceGame");
  const liveBpSource = document.getElementById("statsSourceLiveBp");
  if (gameSource) gameSource.checked = _statsSources.game;
  if (liveBpSource) liveBpSource.checked = _statsSources.liveBp;

  document.getElementById("statsSearch")?.addEventListener("input", (e) => {
    _statsSearch = e.target.value;
    renderStatsPage();
  });

  sortSelect?.addEventListener("change", (e) => {
    _statsSort = e.target.value;
    localStorage.setItem(STATS_SORT_KEY, _statsSort);
    renderStatsPage();
  });

  function onSourceChange() {
    _statsSources = {
      game: Boolean(gameSource?.checked),
      liveBp: Boolean(liveBpSource?.checked),
    };
    _saveStatsSources();
    if (_statsSources.liveBp && !_liveBpLoaded) _fetchLiveBpStats();
    renderStatsPage();
  }

  gameSource?.addEventListener("change", onSourceChange);
  liveBpSource?.addEventListener("change", onSourceChange);

  _recoverLiveBpToGameIfNeeded();
  _loadCachedLiveBpStats();
  renderStatsPage();
  _syncRemoteStats("game");
  _syncRemoteStats("liveBp");
  _fetchLiveBpStats();

  window.addEventListener("online", () => {
    _syncRemoteStats("game");
    _syncRemoteStats("liveBp");
    _fetchLiveBpStats();
  });
});
