/* Scoreboard — scores, rounds and undo history saved in localStorage. Timer is Date-based. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var PALETTE = ["#3dd6d0", "#f5b971", "#ff7b9c", "#8ea2ff", "#6ee7a8", "#c084fc", "#facc15", "#38bdf8"];
  var MAX_PLAYERS = 24, MAX_LOG = 5000;

  // ---------- pure game logic ----------
  function newGame() { return { players: [], round: 1, history: [], step: 1, lowWins: false, target: null, timer: { acc: 0, startedAt: null } }; }
  function find(g, id) { return g.players.filter(function (p) { return p.id === id; })[0]; }
  function apply(g, id, d) { var p = find(g, id); if (!p || !isFinite(d) || !d) return false; p.score += d; g.history.push({ pid: id, d: d, r: g.round }); if (g.history.length > MAX_LOG) g.history.shift(); return true; }
  function undo(g) {
    var h = g.history.pop(); if (!h) return null;
    var p = find(g, h.pid); if (p) p.score -= h.d;
    if (h.r < g.round && !g.history.some(function (x) { return x.r === g.round; })) g.round = h.r; // undoing into the previous round
    return h;
  }
  function leaders(g) {
    if (g.players.length < 2) return [];
    var scores = g.players.map(function (p) { return p.score; }), best = g.lowWins ? Math.min.apply(null, scores) : Math.max.apply(null, scores);
    if (scores.every(function (s) { return s === best; })) return [];
    return g.players.filter(function (p) { return p.score === best; }).map(function (p) { return p.id; });
  }
  function roundTable(g) { // {rounds: [1..n], rows: {pid: [delta per round]}}
    var n = Math.max(g.round, g.history.reduce(function (m, h) { return Math.max(m, h.r); }, 1)), rows = {};
    g.players.forEach(function (p) { rows[p.id] = new Array(n).fill(0); });
    g.history.forEach(function (h) { if (rows[h.pid]) rows[h.pid][h.r - 1] += h.d; });
    return { n: n, rows: rows };
  }
  function elapsed(tm, now) { return tm.acc + (tm.startedAt != null ? now - tm.startedAt : 0); }
  function hexOk(c) { return /^#[0-9a-f]{6}$/i.test(c) ? c : PALETTE[0]; }
  function inkFor(hex) { var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? "#10141a" : "#ffffff"; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------- state (validated on load: localStorage could hold anything) ----------
  var g = (function () {
    var raw = S3.store("sb.game"), x = newGame();
    if (!raw || !Array.isArray(raw.players)) return x;
    raw.players.slice(0, MAX_PLAYERS).forEach(function (p) { if (p && typeof p.id === "string") x.players.push({ id: p.id, name: String(p.name || "").slice(0, 40), color: hexOk(p.color), score: isFinite(p.score) ? +p.score : 0 }); });
    x.round = Math.max(1, Math.floor(+raw.round) || 1);
    x.history = (Array.isArray(raw.history) ? raw.history : []).filter(function (h) { return h && isFinite(h.d) && isFinite(h.r) && find(x, h.pid); }).slice(-MAX_LOG);
    x.step = Math.max(1, Math.min(100000, Math.floor(+raw.step) || 1)); x.lowWins = raw.lowWins === true;
    x.target = isFinite(raw.target) && raw.target > 0 ? +raw.target : null;
    if (raw.timer && isFinite(raw.timer.acc)) x.timer = { acc: +raw.timer.acc, startedAt: isFinite(raw.timer.startedAt) && raw.timer.startedAt != null ? +raw.timer.startedAt : null };
    return x;
  })();
  function save() { S3.store("sb.game", g); }

  // ---------- render ----------
  function build() {
    var board = $("#board"); board.innerHTML = "";
    g.players.forEach(function (p, i) {
      var name = S3.h("input", { "class": "p-name", value: p.name, maxlength: "40", dir: "auto", "aria-label": "Name of player " + (i + 1) });
      name.addEventListener("input", function () { p.name = name.value.slice(0, 40); save(); renderSide(); });
      var color = S3.h("input", { type: "color", "class": "p-color", value: p.color, "aria-label": "Colour" });
      color.addEventListener("input", function () { p.color = hexOk(color.value); card.style.setProperty("--pc", p.color); plus.style.color = inkFor(p.color); save(); renderSide(); });
      var x = S3.h("button", { "class": "btn ghost icon small p-x", "aria-label": "Remove " + (p.name || "player"), html: S3.icon("x") });
      x.addEventListener("click", function () {
        if (p.score && !window.confirm("Remove " + (p.name || "this player") + " and their score?")) return;
        g.players = g.players.filter(function (q) { return q !== p; }); g.history = g.history.filter(function (h) { return h.pid !== p.id; }); save(); build();
      });
      var minus = S3.h("button", { "class": "btn minus", "aria-label": "Subtract points" }), plus = S3.h("button", { "class": "btn plus", "aria-label": "Add points" });
      minus.addEventListener("click", function () { change(p.id, -g.step); });
      plus.addEventListener("click", function () { change(p.id, g.step); });
      plus.style.color = inkFor(p.color);
      var amt = S3.h("input", { "class": "input", type: "number", placeholder: "± any amount", "aria-label": "Add any amount to " + (p.name || "player") });
      var go = S3.h("button", { "class": "btn small", text: "Add" });
      function addAmt() { var v = parseFloat(amt.value); if (isFinite(v) && v) { change(p.id, v); amt.value = ""; } }
      go.addEventListener("click", addAmt);
      amt.addEventListener("keydown", function (e) { if (e.key === "Enter") addAmt(); });
      var card = S3.h("article", { "class": "player", "data-id": p.id }, [
        i < 9 ? S3.h("kbd", { "class": "p-key", text: String(i + 1) }) : null,
        S3.h("div", { "class": "p-head" }, [S3.h("span", { "class": "p-crown", "aria-hidden": "true", text: "👑" }), name, color, x]),
        S3.h("div", { "class": "p-score", "aria-live": "polite" }),
        S3.h("div", { "class": "p-btns" }, [minus, plus]),
        S3.h("div", { "class": "p-custom" }, [amt, go])
      ]);
      card.style.setProperty("--pc", p.color);
      board.appendChild(card);
    });
    $("#noPlayers").hidden = g.players.length > 0;
    updateScores(); renderSide();
  }
  function fmtN(n) { return (Math.round(n * 100) / 100).toLocaleString(); }
  function updateScores(bumpId) {
    var lead = leaders(g);
    g.players.forEach(function (p) {
      var card = $('.player[data-id="' + p.id + '"]'); if (!card) return;
      var sc = $(".p-score", card); sc.textContent = fmtN(p.score);
      if (bumpId === p.id) { sc.classList.remove("bump"); void sc.offsetWidth; sc.classList.add("bump"); }
      card.classList.toggle("lead", lead.indexOf(p.id) >= 0);
    });
    $$(".p-btns .minus").forEach(function (b) { b.textContent = "−" + fmtN(g.step); });
    $$(".p-btns .plus").forEach(function (b) { b.textContent = "+" + fmtN(g.step); });
    $("#roundChip").textContent = "Round " + g.round;
    $("#undo").disabled = !g.history.length;
  }
  function renderSide() {
    var t = roundTable(g), tbl = $("#rounds"); tbl.innerHTML = "";
    if (!g.players.length) { $("#roundsWrap").hidden = true; } else {
      $("#roundsWrap").hidden = false;
      tbl.appendChild(S3.h("thead", null, [S3.h("tr", null, [S3.h("th", { text: "Round" })].concat(g.players.map(function (p) { return S3.h("th", { dir: "auto", text: p.name || "—" }); })))]));
      var body = S3.h("tbody");
      for (var r = 0; r < t.n; r++) body.appendChild(S3.h("tr", null, [S3.h("td", { text: String(r + 1) + (r + 1 === g.round ? " (now)" : "") })].concat(g.players.map(function (p) { var v = t.rows[p.id][r]; return S3.h("td", { text: v ? (v > 0 ? "+" : "") + fmtN(v) : "·" }); }))));
      tbl.appendChild(body);
      tbl.appendChild(S3.h("tfoot", null, [S3.h("tr", null, [S3.h("td", { text: "Total" })].concat(g.players.map(function (p) { return S3.h("td", { text: fmtN(p.score) }); })))]));
    }
    var log = $("#log"); log.innerHTML = "";
    g.history.slice(-30).reverse().forEach(function (h) {
      var p = find(g, h.pid); if (!p) return;
      var dot = S3.h("i"); dot.style.setProperty("--pc", p.color);
      log.appendChild(S3.h("li", null, [dot, S3.h("span", { dir: "auto", text: p.name || "—" }), S3.h("span", { "class": "d", text: (h.d > 0 ? "+" : "") + fmtN(h.d) }), S3.h("span", { "class": "r", text: "round " + h.r })]));
    });
    $("#noLog").hidden = g.history.length > 0;
  }
  function change(id, d) {
    var before = find(g, id) && find(g, id).score;
    if (!apply(g, id, d)) return;
    var p = find(g, id);
    if (g.target && !g.lowWins && before < g.target && p.score >= g.target) { S3.toast("🏆 " + (p.name || "A player") + " reached " + fmtN(g.target) + "!"); var c = $('.player[data-id="' + id + '"]'); if (c) c.classList.add("won"); S3.done(); }
    save(); updateScores(id); renderSide();
  }

  // ---------- timer ----------
  function fmtT(ms) { var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(s % 60).padStart(2, "0"); }
  function drawTimer() { $("#timer").textContent = fmtT(elapsed(g.timer, Date.now())); $("#timerGo").textContent = g.timer.startedAt != null ? "Pause" : elapsed(g.timer, 0) ? "Resume" : "Start timer"; }
  $("#timerGo").addEventListener("click", function () {
    var now = Date.now();
    if (g.timer.startedAt != null) { g.timer.acc = elapsed(g.timer, now); g.timer.startedAt = null; } else g.timer.startedAt = now;
    save(); drawTimer();
  });
  $("#timerReset").addEventListener("click", function () { g.timer = { acc: 0, startedAt: null }; save(); drawTimer(); });
  setInterval(drawTimer, 500);

  // ---------- controls ----------
  $("#addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (g.players.length >= MAX_PLAYERS) { S3.toast("Up to " + MAX_PLAYERS + " players", "error"); return; }
    var name = $("#pName").value.trim().slice(0, 40) || "Player " + (g.players.length + 1);
    g.players.push({ id: uid(), name: name, color: hexOk($("#pColor").value), score: 0 });
    $("#pName").value = ""; $("#pColor").value = PALETTE[g.players.length % PALETTE.length];
    save(); build(); $("#pName").focus();
  });
  function setStep(v) {
    g.step = Math.max(1, Math.min(100000, Math.floor(v) || 1)); save();
    $$("#step button").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.v === g.step)); });
    $("#customStep").value = [1, 2, 5, 10, 25, 100].indexOf(g.step) >= 0 ? "" : g.step;
    updateScores();
  }
  $$("#step button").forEach(function (b) { b.addEventListener("click", function () { setStep(+b.dataset.v); }); });
  $("#customStep").addEventListener("change", function () { if ($("#customStep").value) setStep(+$("#customStep").value); });
  $("#target").addEventListener("change", function () { var v = +$("#target").value; g.target = isFinite(v) && v > 0 ? v : null; save(); });
  $("#lowWins").addEventListener("change", function () { g.lowWins = $("#lowWins").checked; save(); updateScores(); });
  function nextRound() { g.round++; save(); updateScores(); renderSide(); S3.toast("Round " + g.round); }
  $("#newRound").addEventListener("click", nextRound);
  function doUndo() { var h = undo(g); if (!h) return; save(); updateScores(h.pid); renderSide(); var p = find(g, h.pid); S3.toast("Undid " + (h.d > 0 ? "+" : "") + fmtN(h.d) + (p ? " for " + (p.name || "player") : "")); }
  $("#undo").addEventListener("click", doUndo);
  $("#resetScores").addEventListener("click", function () {
    if (g.history.length && !window.confirm("Start a new game? Scores and rounds reset; players stay.")) return;
    g.players.forEach(function (p) { p.score = 0; }); g.history = []; g.round = 1; g.timer = { acc: 0, startedAt: null }; save(); build(); drawTimer(); S3.done();
  });
  $("#clearAll").addEventListener("click", function () { if (!window.confirm("Remove all players and scores?")) return; var keep = { step: g.step, lowWins: g.lowWins, target: g.target }; g = Object.assign(newGame(), keep); save(); build(); drawTimer(); });
  $("#fs").addEventListener("click", function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if ($("#boardWrap").requestFullscreen) $("#boardWrap").requestFullscreen().catch(function () { S3.toast("Fullscreen isn't available here", "error"); });
  });
  $("#copy").addEventListener("click", function () {
    if (!g.players.length) { S3.toast("No players yet", "error"); return; }
    var sorted = g.players.slice().sort(function (a, b) { return g.lowWins ? a.score - b.score : b.score - a.score; });
    S3.copy("Scores after round " + g.round + ":\n" + sorted.map(function (p, i) { return (i + 1) + ". " + (p.name || "Player") + ": " + fmtN(p.score); }).join("\n"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var m = /^Digit([1-9])$/.exec(e.code);
    if (m && g.players[+m[1] - 1]) { e.preventDefault(); change(g.players[+m[1] - 1].id, e.shiftKey ? -g.step : g.step); }
    else if (e.key === "n" || e.key === "N") nextRound();
  });

  if (!g.players.length) { g.players = [{ id: uid(), name: "Team A", color: PALETTE[0], score: 0 }, { id: uid(), name: "Team B", color: PALETTE[1], score: 0 }]; }
  $("#lowWins").checked = g.lowWins; if (g.target) $("#target").value = g.target;
  $("#pColor").value = PALETTE[g.players.length % PALETTE.length];
  build(); setStep(g.step); drawTimer();

  window.S3_DEMO = function () {
    g = newGame();
    [["Falcons", "#3dd6d0"], ["Lions", "#f5b971"], ["Eagles", "#ff7b9c"], ["Wolves", "#8ea2ff"]].forEach(function (x) { g.players.push({ id: uid(), name: x[0], color: x[1], score: 0 }); });
    [[0, 12, 1], [1, 8, 1], [2, 15, 1], [3, 5, 1], [0, 20, 2], [1, 18, 2], [2, 9, 2], [3, 14, 2], [0, 11, 3], [1, 25, 3], [2, 7, 3]].forEach(function (s) { g.round = s[2]; apply(g, g.players[s[0]].id, s[1]); });
    g.target = 100; g.step = 5; g.timer = { acc: 0, startedAt: Date.now() - (23 * 60 + 41) * 1000 };
    $("#target").value = 100; build(); setStep(5); drawTimer();
  };

  window.S3_SELFTEST = function () {
    var t = newGame();
    t.players = [{ id: "a", name: "A", color: "#ffffff", score: 0 }, { id: "b", name: "B", color: "#000000", score: 0 }];
    apply(t, "a", 5); apply(t, "b", 3); t.round = 2; apply(t, "a", -2); apply(t, "b", 10);
    var ok1 = t.players[0].score === 3 && t.players[1].score === 13 && leaders(t).join() === "b";
    t.lowWins = true; var ok2 = leaders(t).join() === "a"; t.lowWins = false;
    var rt = roundTable(t), ok3 = rt.n === 2 && rt.rows.a.join() === "5,-2" && rt.rows.b.join() === "3,10";
    undo(t); undo(t); var ok4 = t.players[0].score === 5 && t.players[1].score === 3 && t.round === 2 && t.history.length === 2;
    apply(t, "b", 2); var ok5 = leaders(t).length === 0; // 5 vs 5: a tie for everyone shows no leader
    var ok6 = !apply(t, "zzz", 3) && !apply(t, "a", NaN) && undo(newGame()) === null;
    var ok7 = elapsed({ acc: 1000, startedAt: 5000 }, 9000) === 5000 && elapsed({ acc: 1000, startedAt: null }, 9000) === 1000 && fmtT(3723000) === "1:02:03";
    var ok8 = hexOk("red;background:url(x)") === PALETTE[0] && hexOk("#A1b2C3") === "#A1b2C3" && inkFor("#ffffff") === "#10141a" && inkFor("#000000") === "#ffffff";
    return ok1 && ok2 && ok3 && ok4 && ok5 && ok6 && ok7 && ok8;
  };
})();
