// Rätsel-Frontend (Wordle). Der Spielstand liegt auf dem Server; der Browser merkt sich
// nur die ID aus dem Newsletter-Link, eine anonyme ID und die Startzeit des Timers.
(function () {
  "use strict";

  const app = document.getElementById("app");
  const SLUG = app.dataset.slug;
  const API = "/api/" + encodeURIComponent(SLUG);

  const KEYBOARD_ROWS = [
    "QWERTYUIOP".split(""),
    "ASDFGHJKL".split(""),
    ["ENTER"].concat("ZXCVBNM".split(""), ["DELETE"]),
  ];
  const FLIP_STAGGER_MS = 180;
  const FLIP_HALF_MS = 250;
  const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  // ---- Speicher (kann in privaten Fenstern fehlen) ----
  function storeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* egal */ }
  }

  // ---- Identität ----
  // Die ID aus dem Newsletter merken und aus der Adresszeile entfernen, damit ein
  // geteilter Link nicht den eigenen Member-Status weitergibt.
  const params = new URLSearchParams(location.search);
  let playerId = params.get("id");
  if (playerId && !playerId.includes("*|")) {
    storeSet("raetsel_id", playerId);
  } else {
    playerId = storeGet("raetsel_id");
  }
  if (params.has("id")) {
    params.delete("id");
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  }
  let anonId = storeGet("raetsel_anon");
  if (!anonId) {
    anonId = "anon-" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
    storeSet("raetsel_anon", anonId);
  }
  const identity = { id: playerId || "", anon: anonId };

  // ---- Zustand ----
  let cfg = null; // Antwort von /state
  const state = {
    wordLength: 5,
    maxAttempts: 6,
    wordId: null,
    board: [], // { letters, feedback }
    letters: [],
    cursor: 0,
    finished: false,
    won: false,
    solution: null,
    keyStates: {},
    animating: false,
    blocked: false,
    timeSeconds: null,
  };

  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  const keyboardEl = $("keyboard");
  const messageEl = $("message");

  function pick(list) {
    return list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  function fill(text, vars) {
    return String(text || "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  function formatNextFree(date) {
    if (!date) return "nächste Woche";
    const d = new Date(date + "T12:00:00Z");
    const wd = WEEKDAYS[(d.getUTCDay() + 6) % 7];
    return wd + ", " + d.getUTCDate() + ". " + MONTHS[d.getUTCMonth()];
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return "–";
    const s = Math.max(0, Math.round(seconds));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function setMessage(text, type) {
    messageEl.textContent = text || "";
    messageEl.className = type || "";
  }

  // ---- Timer: startet beim ersten Buchstaben, übersteht ein Neuladen ----
  function timerKey() { return "raetsel_start_" + state.wordId; }
  function startTimer() {
    if (state.wordId && !storeGet(timerKey())) storeSet(timerKey(), String(Date.now()));
  }
  function elapsedSeconds() {
    const start = Number(storeGet(timerKey()));
    return start ? Math.round((Date.now() - start) / 1000) : null;
  }

  // ---- Darstellung ----
  function renderBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < state.maxAttempts; r++) {
      const row = document.createElement("div");
      row.className = "row";
      const submitted = state.board[r];
      const isCurrent = r === state.board.length && !state.finished && !state.blocked;
      for (let c = 0; c < state.wordLength; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        if (submitted) {
          tile.textContent = submitted.letters[c] || "";
          tile.classList.add("filled", submitted.feedback[c]);
        } else if (isCurrent) {
          const letter = state.letters[c];
          if (letter) {
            tile.textContent = letter;
            tile.classList.add("filled");
          }
          if (c === state.cursor) tile.classList.add("cursor");
          tile.style.cursor = "pointer";
          tile.addEventListener("click", () => {
            if (state.finished || state.animating) return;
            state.cursor = c;
            renderBoard();
          });
        }
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
    }
  }

  function renderKeyboard() {
    keyboardEl.innerHTML = "";
    KEYBOARD_ROWS.forEach((rowKeys) => {
      const row = document.createElement("div");
      row.className = "kb-row";
      rowKeys.forEach((key) => {
        const btn = document.createElement("button");
        btn.className = "key" + (key.length > 1 ? " wide" : "");
        if (key === "ENTER") btn.classList.add("enter");
        if (key === "DELETE") btn.classList.add("delete");
        btn.textContent = key;
        const cls = state.keyStates[key];
        if (cls) btn.classList.add(cls);
        btn.addEventListener("click", () => handleKey(key));
        row.appendChild(btn);
      });
      keyboardEl.appendChild(row);
    });
  }

  function updateKeyStates(letters, feedback) {
    const priority = { absent: 0, present: 1, correct: 2 };
    letters.forEach((letter, i) => {
      const current = state.keyStates[letter];
      if (!current || priority[feedback[i]] > priority[current]) state.keyStates[letter] = feedback[i];
    });
  }

  function revealRow(rowIndex, letters, feedback) {
    const rowEl = boardEl.querySelectorAll(".row")[rowIndex];
    if (!rowEl) return Promise.resolve();
    const tiles = rowEl.querySelectorAll(".tile");
    tiles.forEach((t) => t.classList.remove("cursor"));
    return new Promise((resolve) => {
      tiles.forEach((tile, i) => {
        setTimeout(() => {
          tile.classList.add("flip");
          setTimeout(() => {
            tile.textContent = letters[i];
            tile.classList.add("filled", feedback[i]);
          }, FLIP_HALF_MS);
        }, i * FLIP_STAGGER_MS);
      });
      setTimeout(resolve, (tiles.length - 1) * FLIP_STAGGER_MS + FLIP_HALF_MS * 2);
    });
  }

  function shakeCurrentRow() {
    const row = boardEl.querySelectorAll(".row")[state.board.length];
    if (!row) return;
    row.querySelectorAll(".tile").forEach((t) => t.classList.add("shake"));
    setTimeout(() => row.querySelectorAll(".tile").forEach((t) => t.classList.remove("shake")), 350);
  }

  // ---- Hinweise, Paywall, Ergebnis ----
  function renderHint(trialRemaining) {
    const hintEl = $("hint");
    const msg = pick(cfg.messages.trial_hint);
    if (cfg.access && cfg.access.kind === "trial" && trialRemaining !== null && trialRemaining <= 5 && msg) {
      hintEl.innerHTML = "";
      const span = document.createElement("span");
      span.textContent = fill(msg.text, { rest: trialRemaining });
      hintEl.appendChild(span);
      if (msg.buttonText && msg.buttonUrl) {
        const a = document.createElement("a");
        a.href = msg.buttonUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = msg.buttonText;
        hintEl.appendChild(a);
      }
      hintEl.classList.remove("hidden");
    } else {
      hintEl.classList.add("hidden");
    }
  }

  function showPaywall(access) {
    state.blocked = true;
    const msg = pick(cfg.messages.paywall) || {
      title: "Deine Gratis-Rätsel sind aufgebraucht",
      text: "Mit einer Membership rätselst du unbegrenzt mit. Dein nächstes Gratis-Rätsel gibt es am {naechstesGratis}.",
      buttonText: cfg.ctaUrl ? "Member werden" : null,
      buttonUrl: cfg.ctaUrl,
    };
    const vars = { naechstesGratis: formatNextFree(access && access.nextFree) };
    $("paywallTitle").textContent = fill(msg.title || "Deine Gratis-Rätsel sind aufgebraucht", vars);
    $("paywallText").textContent = fill(msg.text, vars);
    const btn = $("paywallBtn");
    if (msg.buttonText && msg.buttonUrl) {
      btn.textContent = msg.buttonText;
      btn.href = msg.buttonUrl;
      btn.classList.remove("hidden");
    } else {
      btn.classList.add("hidden");
    }
    $("graceBtn").classList.toggle("hidden", !cfg.graceAvailable);
    $("graceMsg").textContent = "";
    $("paywall").classList.remove("hidden");
    renderBoard();
  }

  function buildShareGrid() {
    const emoji = { correct: "🟩", present: "🟧", absent: "⬜" };
    return state.board.map((row) => row.feedback.map((f) => emoji[f]).join(" ")).join("\n");
  }

  function showResult(stats) {
    const won = state.won;
    const box = $("resultMessage");
    const msg = pick(won ? cfg.messages.win : cfg.messages.lose);
    const streak = stats ? stats.streak : 0;

    if (won) {
      const title = pick(cfg.messages.win_title);
      $("resultTitle").textContent = (title ? title.text : "Geschafft!") + " 🎉";
      $("resultSubtitle").innerHTML = "";
      $("resultSubtitle").append("Gelöst in ");
      const strong = document.createElement("strong");
      strong.textContent = formatDuration(state.timeSeconds);
      $("resultSubtitle").append(strong, " · 🔥 Serie: " + streak);
    } else {
      $("resultTitle").textContent = "Leider verloren 😔";
      $("resultSubtitle").innerHTML = "";
      $("resultSubtitle").append("Das Wort war ");
      const strong = document.createElement("strong");
      strong.textContent = state.solution || "?";
      $("resultSubtitle").append(strong);
    }

    if (msg) {
      $("resultMessageText").textContent = msg.text;
      const btn = $("resultMessageBtn");
      if (msg.buttonText && msg.buttonUrl) {
        btn.textContent = msg.buttonText;
        btn.href = msg.buttonUrl;
        btn.classList.remove("hidden");
      } else {
        btn.classList.add("hidden");
      }
      box.classList.remove("hidden");
    } else {
      box.classList.add("hidden");
    }

    const grid = buildShareGrid();
    $("shareGrid").textContent = won ? grid : "";
    $("shareGrid").style.fontSize = Math.max(14, 22 - (state.board.length - 1) * 1.4) + "px";
    $("shareRow").classList.toggle("hidden", !won);
    const shareText =
      cfg.puzzle.name + " ⏱ " + formatDuration(state.timeSeconds) + "\n" + grid +
      (cfg.puzzle.shareText ? "\n\n" + cfg.puzzle.shareText : "");
    $("shareWhatsapp").onclick = () => {
      // api.whatsapp.com statt wa.me: wa.me zeigt auf WhatsApp Web Emojis teils als «�»
      window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(shareText), "_blank");
    };
    $("copyResult").onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareText);
        $("copyFeedback").textContent = "In Zwischenablage kopiert!";
      } catch (e) {
        $("copyFeedback").textContent = "Kopieren nicht möglich.";
      }
      setTimeout(() => { $("copyFeedback").textContent = ""; }, 2000);
    };
    $("resultModal").classList.remove("hidden");
  }

  $("closeResult").addEventListener("click", () => $("resultModal").classList.add("hidden"));

  $("graceBtn").addEventListener("click", async () => {
    $("graceBtn").disabled = true;
    try {
      const res = await fetch(API + "/grace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identity),
      });
      const data = await res.json();
      if (data.ok) {
        $("paywall").classList.add("hidden");
        state.blocked = false;
        await load();
        setMessage("Für 48 Stunden freigeschaltet. Viel Spass!", "");
      } else {
        $("graceMsg").textContent = data.error || "Das hat nicht geklappt.";
      }
    } catch (e) {
      $("graceMsg").textContent = "Verbindung fehlgeschlagen.";
    }
    $("graceBtn").disabled = false;
  });

  // ---- Eingabe ----
  function handleKey(key) {
    if (state.finished || state.animating || state.blocked || !state.wordId) return;
    if (key === "ENTER") {
      submitGuess();
    } else if (key === "DELETE") {
      if (state.letters[state.cursor]) {
        state.letters[state.cursor] = "";
      } else if (state.cursor > 0) {
        state.cursor -= 1;
        state.letters[state.cursor] = "";
      }
      renderBoard();
    } else if (/^[A-Z]$/.test(key)) {
      startTimer();
      state.letters[state.cursor] = key;
      if (state.cursor < state.wordLength - 1) state.cursor += 1;
      renderBoard();
    }
  }

  function moveCursor(delta) {
    if (state.finished || state.animating || state.blocked) return;
    state.cursor = Math.min(state.wordLength - 1, Math.max(0, state.cursor + delta));
    renderBoard();
  }

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") handleKey("ENTER");
    else if (e.key === "Backspace") handleKey("DELETE");
    else if (e.key === "ArrowLeft") moveCursor(-1);
    else if (e.key === "ArrowRight") moveCursor(1);
    else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
  });

  async function submitGuess() {
    const guess = state.letters.join("");
    if (state.letters.some((l) => !l) || guess.length !== state.wordLength) {
      setMessage("Zu wenig Buchstaben.", "error");
      shakeCurrentRow();
      return;
    }
    setMessage("");
    state.animating = true;
    let data;
    let res;
    try {
      res = await fetch(API + "/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: identity.id,
          anon: identity.anon,
          wordId: state.wordId,
          guess: guess,
          elapsedSeconds: elapsedSeconds(),
        }),
      });
      data = await res.json();
    } catch (e) {
      state.animating = false;
      setMessage("Verbindung zum Server fehlgeschlagen.", "error");
      return;
    }

    if (res.status === 402 && data.paywall) {
      state.animating = false;
      showPaywall(data.access);
      return;
    }
    if (!res.ok) {
      state.animating = false;
      setMessage(data.error || "Fehler bei der Anfrage.", "error");
      if (data.reload) setTimeout(load, 1500);
      return;
    }
    if (!data.validWord) {
      state.animating = false;
      setMessage("Kein gültiges Wort.", "error");
      shakeCurrentRow();
      return;
    }

    const letters = guess.split("");
    const rowIndex = state.board.length;
    await revealRow(rowIndex, letters, data.feedback);
    state.animating = false;
    state.board.push({ letters: letters, feedback: data.feedback });
    updateKeyStates(letters, data.feedback);
    state.letters = new Array(state.wordLength).fill("");
    state.cursor = 0;
    if (data.trialRemaining !== null && data.trialRemaining !== undefined) renderHint(data.trialRemaining);

    if (data.finished) {
      state.finished = true;
      state.won = !!data.solved;
      state.solution = data.solution;
      state.timeSeconds = elapsedSeconds();
      renderBoard();
      renderKeyboard();
      showResult(data.stats);
      return;
    }
    renderBoard();
    renderKeyboard();
  }

  // ---- Laden ----
  async function load() {
    let data;
    try {
      const qs = new URLSearchParams({ id: identity.id, anon: identity.anon });
      const res = await fetch(API + "/state?" + qs.toString());
      data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Fehler");
    } catch (e) {
      setMessage((e && e.message) || "Verbindung zum Server fehlgeschlagen.", "error");
      return;
    }
    cfg = data;
    state.wordLength = data.puzzle.wordLength;
    state.maxAttempts = data.puzzle.maxAttempts;
    document.documentElement.style.setProperty("--cols", String(state.wordLength));
    document.documentElement.style.setProperty("--rows", String(state.maxAttempts));
    state.letters = new Array(state.wordLength).fill("");
    state.cursor = 0;
    state.board = [];
    state.keyStates = {};
    state.finished = false;
    state.blocked = false;

    if (!data.available) {
      renderBoard();
      renderKeyboard();
      setMessage("Aktuell ist kein Rätsel verfügbar. Schau morgen wieder vorbei!", "error");
      return;
    }

    state.wordId = data.wordId;
    if (data.play) {
      state.board = data.play.guesses;
      state.board.forEach((row) => updateKeyStates(row.letters, row.feedback));
      state.finished = data.play.finished;
      state.won = data.play.won;
      state.solution = data.play.solution;
      state.timeSeconds = data.play.timeSeconds;
    }
    renderBoard();
    renderKeyboard();
    renderHint(data.access ? data.access.trialRemaining : null);

    if (!data.play && data.access && data.access.kind === "blocked") {
      showPaywall(data.access);
    } else if (state.finished) {
      showResult(data.stats);
    }
  }

  renderBoard();
  renderKeyboard();
  load();
})();
