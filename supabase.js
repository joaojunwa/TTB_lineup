const SUPABASE_URL = "https://kosjrebuehulcccbjmks.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvc2pyZWJ1ZWh1bGNjY2JqbWtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNDk0MjgsImV4cCI6MjA5MzcyNTQyOH0.ykX3sBp9wJvJx88NYO1Rw470UDseND6bSmFc190YLII";

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbSelect(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbDelete(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=minimal",
    },
  });
  if (!res.ok) throw new Error(await res.text());
}

function formatAvgDecimal(decimal) {
  return "." + String(Math.round(decimal * 1000)).padStart(3, "0");
}

function mostrarToast(msg, tipo = "ok") {
  const toast = document.querySelector("#testeToast");
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `teste-toast is-visible${tipo === "erro" ? " is-erro" : ""}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("is-visible"), 3500);
}

/* ── Salvar treino atual ── */

async function salvarTreino() {
  const pitcher = document.querySelector("#testePitcherInput")?.value.trim() || null;
  const comAB = testeState.batters.filter((b) => testeBatterAB(b) > 0);

  if (comAB.length === 0) {
    mostrarToast("Nenhum rebatedor com at-bats para salvar.", "erro");
    return;
  }

  const btn = document.querySelector("#testeSalvar");
  if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }

  try {
    const sessionId = Date.now().toString();
    const rows = comAB.map((b) => ({
      session_id: sessionId,
      pitcher,
      nome_jogador: b.name,
      ab: testeBatterAB(b),
      hits: testeBatterHits(b),
      bb: testeBatterBB(b),
      k: testeBatterK(b),
      avg_decimal: testeBatterAB(b) > 0 ? testeBatterHits(b) / testeBatterAB(b) : 0,
    }));

    await sbInsert("treinos", rows);
    mostrarToast("Treino salvo!");
    await carregarHistorico();
  } catch (err) {
    mostrarToast("Erro ao salvar: " + err.message, "erro");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Salvar Treino"; }
  }
}

/* ── Apagar sessão ── */

async function apagarSessao(sessionId) {
  if (!confirm("Apagar este treino do banco?")) return;
  try {
    await sbDelete("treinos", `session_id=eq.${encodeURIComponent(sessionId)}`);
    mostrarToast("Treino apagado.");
    await carregarHistorico();
  } catch (err) {
    mostrarToast("Erro ao apagar: " + err.message, "erro");
  }
}

/* ── Apagar tudo ── */

async function apagarTudo() {
  if (!confirm("Apagar TODOS os treinos do banco? Isso não pode ser desfeito.")) return;
  if (!confirm("Tem certeza? Todo o histórico será perdido.")) return;
  try {
    await sbDelete("treinos", "id=gte.0");
    mostrarToast("Histórico apagado.");
    await carregarHistorico();
  } catch (err) {
    mostrarToast("Erro ao apagar: " + err.message, "erro");
  }
}

/* ── Carregar e renderizar histórico ── */

async function carregarHistorico() {
  const container = document.querySelector("#testeHistorico");
  if (!container) return;
  container.innerHTML = `<p style="color:var(--text-muted);padding:12px 0">Carregando...</p>`;
  try {
    const records = await sbSelect("treinos", "select=*&order=created_at.desc&limit=500");
    renderHistorico(records);
  } catch (_) {
    container.innerHTML = `<p style="color:var(--text-muted)">Erro ao carregar histórico.</p>`;
  }
}

function renderHistorico(records) {
  const container = document.querySelector("#testeHistorico");
  if (!container) return;

  if (records.length === 0) {
    container.innerHTML = `
      <p style="color:var(--text-muted);padding:12px 0">Nenhum treino salvo ainda.</p>
    `;
    return;
  }

  /* ── Histórico Geral: soma por jogador ── */
  const byPlayer = {};
  records.forEach((r) => {
    if (!byPlayer[r.nome_jogador]) {
      byPlayer[r.nome_jogador] = { nome: r.nome_jogador, ab: 0, hits: 0, bb: 0, k: 0 };
    }
    byPlayer[r.nome_jogador].ab   += r.ab;
    byPlayer[r.nome_jogador].hits += r.hits;
    byPlayer[r.nome_jogador].bb   += r.bb;
    byPlayer[r.nome_jogador].k    += r.k;
  });
  const playerStats = Object.values(byPlayer)
    .map((p) => ({ ...p, avg: p.ab > 0 ? p.hits / p.ab : 0 }))
    .sort((a, b) => b.avg - a.avg);

  /* ── Histórico Por Dia: agrupa sessões por data ── */
  const byDay = {};
  records.forEach((r) => {
    const day = r.created_at.slice(0, 10);
    if (!byDay[day]) byDay[day] = {};
    if (!byDay[day][r.session_id]) {
      byDay[day][r.session_id] = { pitcher: r.pitcher, created_at: r.created_at, rows: [] };
    }
    byDay[day][r.session_id].rows.push(r);
  });
  const sortedDays = Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a));

  container.innerHTML = `
    <div class="historico-header">
      <div class="historico-tabs">
        <button class="historico-tab is-active" data-tab="geral">📊 Geral</button>
        <button class="historico-tab" data-tab="dias">📅 Por Dia</button>
      </div>
      <button class="historico-apagar-tudo" id="btnApagarTudo">Apagar tudo</button>
    </div>

    <div id="historicoGeral" class="historico-panel">
      <table class="teste-stats-table">
        <thead>
          <tr><th>Jogador</th><th>AB</th><th>H</th><th>BB</th><th>K</th><th>AVG</th></tr>
        </thead>
        <tbody>
          ${playerStats.map((p) => `
            <tr>
              <td>${escapeHtml(p.nome)}</td>
              <td>${p.ab}</td>
              <td>${p.hits}</td>
              <td>${p.bb}</td>
              <td>${p.k}</td>
              <td class="avg-cell">${formatAvgDecimal(p.avg)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div id="historicoDias" class="historico-panel" hidden>
      ${sortedDays.map(([day, sessions]) => {
        const dateLabel = new Date(day + "T12:00:00").toLocaleDateString("pt-BR", {
          weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
        });
        const sortedSessions = Object.entries(sessions)
          .sort(([, a], [, b]) => new Date(b.created_at) - new Date(a.created_at));
        return `
          <div class="historico-day">
            <h4 class="historico-day-title">${dateLabel}</h4>
            ${sortedSessions.map(([sessionId, s]) => `
              <details class="historico-session">
                <summary class="historico-summary">
                  <span>${new Date(s.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  ${s.pitcher ? `<span style="color:var(--text-muted)"> · Pitcher: ${escapeHtml(s.pitcher)}</span>` : ""}
                  <span style="color:var(--text-muted)"> · ${s.rows.length} rebatedor${s.rows.length !== 1 ? "es" : ""}</span>
                  <button class="historico-apagar-sessao" data-session="${escapeHtml(sessionId)}">Apagar</button>
                </summary>
                <table class="teste-stats-table" style="margin-top:8px">
                  <thead><tr><th>Rebatedor</th><th>AB</th><th>H</th><th>BB</th><th>K</th><th>AVG</th></tr></thead>
                  <tbody>
                    ${[...s.rows].sort((a, b) => b.avg_decimal - a.avg_decimal).map((r) => `
                      <tr>
                        <td>${escapeHtml(r.nome_jogador)}</td>
                        <td>${r.ab}</td>
                        <td>${r.hits}</td>
                        <td>${r.bb}</td>
                        <td>${r.k}</td>
                        <td class="avg-cell">${formatAvgDecimal(r.avg_decimal)}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </details>
            `).join("")}
          </div>
        `;
      }).join("")}
    </div>
  `;

  /* ── Tab switching ── */
  container.querySelectorAll(".historico-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".historico-tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const target = tab.dataset.tab;
      document.querySelector("#historicoGeral").hidden = target !== "geral";
      document.querySelector("#historicoDias").hidden  = target !== "dias";
    });
  });

  /* ── Apagar sessão ── */
  container.querySelectorAll(".historico-apagar-sessao").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      apagarSessao(btn.dataset.session);
    });
  });

  /* ── Apagar tudo ── */
  document.querySelector("#btnApagarTudo")?.addEventListener("click", apagarTudo);
}

if (PAGE === "teste") {
  document.querySelector("#testeSalvar")?.addEventListener("click", salvarTreino);
  carregarHistorico();
}
