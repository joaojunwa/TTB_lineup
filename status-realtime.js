const GAME_ID       = "ttb_jogo_ativo";
const RT_URL        = "https://kosjrebuehulcccbjmks.supabase.co";
const RT_KEY        = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvc2pyZWJ1ZWh1bGNjY2JqbWtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNDk0MjgsImV4cCI6MjA5MzcyNTQyOH0.ykX3sBp9wJvJx88NYO1Rw470UDseND6bSmFc190YLII";

let _db         = null;
let _saveTimer  = null;
let _applying   = false;

/* Chamado pelo renderStatus() do app.js após cada ação */
function autosaveJogo() {
  if (_applying || !_db) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(salvarJogo, 500);
}

/* ── Coleta todo o estado atual da página ── */
function coletarEstado() {
  const innings = {};
  document.querySelectorAll("td[data-team][data-inning]").forEach((td) => {
    innings[`${td.dataset.team}_${td.dataset.inning}`] = td.textContent.trim();
  });

  const $ = (sel) => document.querySelector(sel);

  return {
    gameState:      JSON.parse(JSON.stringify(gameState)),
    innings,
    opponentLineup: JSON.parse(JSON.stringify(opponentLineup)),
    awayName:   $(`#awayName`)?.value   || "Visitante",
    homeName:   $(`#homeName`)?.value   || "TTB",
    awayHits:   $(`#awayHits`)?.textContent?.trim()   || "0",
    homeHits:   $(`#homeHits`)?.textContent?.trim()   || "0",
    awayErrors: $(`#awayErrors`)?.textContent?.trim() || "0",
    homeErrors: $(`#homeErrors`)?.textContent?.trim() || "0",
  };
}

/* ── Salva no Supabase ── */
async function salvarJogo() {
  if (!_db) return;
  setIndicador("saving");
  try {
    const { error } = await _db.from("jogos").upsert({
      id: GAME_ID,
      state: coletarEstado(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    setIndicador("connected");
  } catch (err) {
    console.error("Erro ao salvar jogo:", err);
    setIndicador("error");
  }
}

/* ── Aplica estado recebido do Supabase ── */
function aplicarEstado(estado) {
  if (!estado) return;
  _applying = true;
  try {
    if (estado.gameState) Object.assign(gameState, estado.gameState);

    if (estado.innings) {
      Object.entries(estado.innings).forEach(([key, val]) => {
        const [team, inning] = key.split("_");
        const td = document.querySelector(`td[data-team="${team}"][data-inning="${inning}"]`);
        if (td) td.textContent = val;
      });
    }

    const $ = (sel) => document.querySelector(sel);
    if (estado.awayName   && $(`#awayName`))   $(`#awayName`).value            = estado.awayName;
    if (estado.homeName   && $(`#homeName`))   $(`#homeName`).value            = estado.homeName;
    if (estado.awayHits   && $(`#awayHits`))   $(`#awayHits`).textContent      = estado.awayHits;
    if (estado.homeHits   && $(`#homeHits`))   $(`#homeHits`).textContent      = estado.homeHits;
    if (estado.awayErrors && $(`#awayErrors`)) $(`#awayErrors`).textContent    = estado.awayErrors;
    if (estado.homeErrors && $(`#homeErrors`)) $(`#homeErrors`).textContent    = estado.homeErrors;

    if (Array.isArray(estado.opponentLineup)) opponentLineup = estado.opponentLineup;

    computeRuns();
    renderStatus();
  } finally {
    _applying = false;
  }
}

/* ── Carrega o jogo salvo ao abrir a página ── */
async function carregarJogo() {
  if (!_db) return;
  setIndicador("connecting");
  try {
    const { data, error } = await _db
      .from("jogos")
      .select("state")
      .eq("id", GAME_ID)
      .maybeSingle();
    if (error) throw error;
    if (data?.state) aplicarEstado(data.state);
  } catch (err) {
    console.error("Erro ao carregar jogo:", err);
    setIndicador("error");
  }
}

/* ── Assina atualizações em tempo real ── */
function inscreverRealtime() {
  if (!_db) return;
  _db
    .channel("jogo-ao-vivo")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "jogos", filter: `id=eq.${GAME_ID}` },
      (payload) => {
        if (payload.new?.state) aplicarEstado(payload.new.state);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setIndicador("connected");
    });
}

/* ── Indicador visual no nav ── */
function setIndicador(status) {
  const dot  = document.querySelector("#gdRealtimeStatus");
  const lbl  = document.querySelector("#gdRealtimeLabel");
  if (!dot) return;
  dot.className = `gd-realtime-dot gd-rt-${status}`;
  const labels = {
    connected:  "Ao vivo",
    connecting: "Conectando...",
    saving:     "Salvando...",
    error:      "Erro",
  };
  dot.title = labels[status] || status;
  if (lbl) lbl.textContent = labels[status] || status;
}

/* ── Resetar jogo ── */
function novoJogo() {
  if (!confirm("Resetar o jogo atual? Placar e log serão apagados.")) return;
  Object.assign(gameState, {
    inning: 1, isTop: true, outs: 0, balls: 0, strikes: 0,
    bases: [false, false, false], currentBatterIndex: 0,
    batterIndexes: { away: 0, home: 0 }, plays: [], currentPitches: [],
  });
  document.querySelectorAll("td[data-team][data-inning]").forEach((td) => (td.textContent = ""));
  ["#awayHits", "#homeHits", "#awayErrors", "#homeErrors"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = "0";
  });
  computeRuns();
  renderStatus();
  salvarJogo();
}

/* ── Init ── */
if (PAGE === "status") {
  if (typeof window.supabase !== "undefined") {
    _db = window.supabase.createClient(RT_URL, RT_KEY);
    carregarJogo().then(() => inscreverRealtime());
  } else {
    console.warn("Supabase CDN não disponível — modo offline.");
  }
  document.querySelector("#btnNovoJogo")?.addEventListener("click", novoJogo);
}
