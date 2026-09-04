/* TolkoCard v2 — движок открытки: превью в конструкторе, автопоказ на лендинге и реальная страница /i/<code>. */
(function () {
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const humanDate = (iso) => { if (!iso) return ""; const d = new Date(iso + "T00:00:00"); return isNaN(d) ? iso : `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isImg = (s) => typeof s === "string" && (s.startsWith("data:") || s.startsWith("http") || s.startsWith("/"));
  const stk = (s) => s ? `<div class="stk">${isImg(s) ? `<img class="${s.endsWith(".svg") ? "svg" : "photo"}" src="${esc(s)}" alt="">` : esc(s)}</div>` : "";
  const fill = (tpl, a) => String(tpl || "").replace(/\{date\}/g, humanDate(a.date)).replace(/\{time\}/g, a.time || "").replace(/\{choice\}|\{food\}/g, a.choice || "");
  const SASS = ["Точно?", "Подумай ещё", "Ну нет же", "Не туда", "Мимо!", "Ладно, сдаюсь"];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const localISO = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const fx = () => window.TolkoFX;

  function mount(root, opts) {
    const { card, code, preview = false, expired = false, autoplay = false } = opts;
    const answers = Object.assign({}, opts.answers || {});
    const blocks = card.blocks || [];
    root.className = root.className.split(/\s+/).filter((c) => c && c !== "tc" && !c.startsWith("theme-")).concat(["tc", "theme-" + (card.theme || "rose")]).join(" ");
    root.innerHTML = `<div class="wm">💌 только да</div>`;
    let idx = 0, screenEl = null, dodges = 0, alive = true;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); return t; };

    const send = (type, payload) => {
      if (opts.onEvent) opts.onEvent(type, payload);
      if (preview || !code) return Promise.resolve();
      return fetch(`/api/i/${code}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, payload }) }).catch(() => {});
    };

    /* ---------- рендер экранов ---------- */
    function render(b) {
      switch (b.type) {
        case "yesno":
          return `${stk(b.sticker)}<div class="lbl">приглашение</div><h1>${esc(b.title)}</h1>
            <button class="b yes">${esc(b.yes || "Да")}</button><button class="no" type="button">${esc(b.no || "Нет")}</button>`;
        case "message":
          return `${stk(b.sticker)}<h1>${esc(b.title)}</h1>${b.subtitle ? `<p class="sub">${esc(b.subtitle)}</p>` : ""}<button class="b next">${esc(b.button || "Дальше")}</button>`;
        case "datetime": {
          const hh = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
          const mm = ["00","05","10","15","20","25","30","35","40","45","50","55"];
          return `${stk(b.sticker)}<h1>${esc(b.title)}</h1>
            <div class="fields">
              <div><label>Дата</label><input type="date" class="date" min="${localISO(Date.now())}" value="${esc(answers.date || "")}"></div>
              <div><label>Время</label><div class="row">
                <select class="hh"><option value="">ЧЧ</option>${hh.map((h) => `<option ${answers.time && answers.time.startsWith(h) ? "selected" : ""}>${h}</option>`).join("")}</select><span>:</span>
                <select class="mm"><option value="">ММ</option>${mm.map((m) => `<option ${answers.time && answers.time.endsWith(m) ? "selected" : ""}>${m}</option>`).join("")}</select></div></div>
            </div><button class="b next" disabled>${esc(b.button || "Выбери дату")}</button>`;
        }
        case "choice":
          return `${stk(b.sticker)}<h1>${esc(b.title)}</h1>${b.subtitle ? `<p class="sub">${esc(b.subtitle)}</p>` : ""}
            <div class="grid">${(b.options || []).filter((o) => o.label).map((o, i) => `<button class="opt rise" style="--i:${i + 2}" data-i="${i}"><span class="e">${esc(o.emoji)}</span>${esc(o.label)}</button>`).join("")}</div>`;
        case "final":
          return `<div class="ticket">${stk(b.sticker)}<h1>${esc(b.title || "Договорились!")}</h1><p class="desc">${esc(fill(b.description, answers))}</p>
            <ul class="facts"><li style="--i:0">📅 ${esc(humanDate(answers.date) || "дата")}</li><li style="--i:1">🕐 ${esc(answers.time || "время")}</li><li style="--i:2">${esc(answers.choice_emoji || "✨")} ${esc(answers.choice || "план")}</li></ul>
            <div class="hint">СОХРАНИ СКРИНШОТ 📸</div></div>
            <div class="final-actions">
              <a class="b cal" ${preview ? "" : `href="/api/i/${code}/calendar.ics"`}>В календарь 📅</a>
              <button class="b sec share">Отправить ему ответ 💬</button>
            </div>
            <p class="make-own">Хочешь так же позвать? <a href="/" target="_blank" rel="noopener">Собери своё 💌</a></p>`;
      }
      return `<p class="expired">Пустое приглашение</p>`;
    }

    function build(b, dir) {
      const el = document.createElement("div");
      el.className = "scr"; el.dataset.type = b.type; el.style.setProperty("--dir", dir);
      el.innerHTML = `<div class="inner">${render(b)}</div>`;
      // ступенчатое появление детей; после анимации снимаем класс, чтобы inline-transform (убегающее "Нет") работал
      [...el.firstElementChild.children].forEach((c, k) => { if (!c.classList.contains("stk") && !c.classList.contains("ticket")) { c.classList.add("rise"); c.style.setProperty("--i", k); } });
      el.addEventListener("animationend", (e) => { if (e.target.classList && e.target.classList.contains("rise")) e.target.classList.remove("rise"); });
      return el;
    }

    function show(i, dir = 1) {
      const b = blocks[i]; if (!b) return;
      const old = screenEl;
      if (old) { old.style.setProperty("--dir", dir); old.classList.add("out"); later(() => old.remove(), 380); }
      screenEl = build(b, dir); idx = i;
      root.appendChild(screenEl);
      root.dataset.screen = b.type;
      wire(b);
    }
    const next = () => { if (idx + 1 < blocks.length) show(idx + 1, 1); };

    function burstAt(el, kind, count) {
      const f = fx(); if (!f) return;
      const r = el.getBoundingClientRect(), p = root.getBoundingClientRect();
      f.burst(root, { x: r.left - p.left + r.width / 2, y: r.top - p.top + r.height / 2, kind, count });
    }

    /* ---------- поведение ---------- */
    function wire(b) {
      const q = (s) => screenEl.querySelector(s);
      if (b.type === "yesno") {
        const no = q(".no"), yes = q(".yes");
        const dodge = () => {
          if (!no.isConnected) return;
          dodges++;
          const W = root.clientWidth, H = root.clientHeight, w = no.offsetWidth, h = no.offsetHeight;
          const pr = screenEl.getBoundingClientRect();
          if (!no.classList.contains("loose")) {
            const r = no.getBoundingClientRect();
            no.style.left = (r.left - pr.left) + "px"; no.style.top = (r.top - pr.top) + "px";
            no.classList.add("loose"); void no.offsetWidth;
          }
          const yr = yes.getBoundingClientRect(), ky = { l: yr.left - pr.left - 20, t: yr.top - pr.top - 20, r: yr.right - pr.left + 20, b: yr.bottom - pr.top + 20 };
          const cx = parseFloat(no.style.left) || 0, cy = parseFloat(no.style.top) || 0;
          let x, y, n = 0;
          do { x = 12 + Math.random() * Math.max(1, W - w - 24); y = 56 + Math.random() * Math.max(1, H - h - 130); n++; }
          while (n < 14 && ((x < ky.r && x + w > ky.l && y < ky.b && y + h > ky.t) || (Math.abs(x - cx) < 70 && Math.abs(y - cy) < 70)));
          no.style.left = x + "px"; no.style.top = y + "px";
          no.style.transform = `scale(${Math.max(0.42, 1 - dodges * 0.1)})`;
          no.textContent = SASS[Math.min(dodges - 1, SASS.length - 1)];
          no.classList.remove("wobble"); void no.offsetWidth; no.classList.add("wobble");
          if (dodges === 1) send("no_dodged", {});
          if (dodges >= 7) { no.classList.add("poof"); later(() => no.remove(), 420); }
        };
        screenEl._dodge = dodge;
        no.addEventListener("pointerenter", dodge);
        no.addEventListener("pointerdown", (e) => { e.preventDefault(); dodge(); });
        no.addEventListener("click", (e) => e.preventDefault());
        yes.addEventListener("click", () => {
          if (yes.classList.contains("pressed")) return;
          yes.classList.add("pressed"); answers.yes = true;
          burstAt(yes, "hearts", 26);
          send("answered_yes", { dodges });
          later(() => next(), 380);
        });
      }
      if (b.type === "message") q(".next").addEventListener("click", () => { q(".next").classList.add("pressed"); later(next, 160); });
      if (b.type === "datetime") {
        const d = q(".date"), hh = q(".hh"), mm = q(".mm"), btn = q(".next");
        const check = () => { const ok = !!(d.value && hh.value && mm.value); if (ok && btn.disabled) { btn.disabled = false; btn.classList.add("ready"); } else if (!ok) btn.disabled = true; };
        [d, hh, mm].forEach((el) => el.addEventListener("input", check)); check();
        btn.addEventListener("click", () => { if (btn.disabled) return; answers.date = d.value; answers.time = `${hh.value}:${mm.value}`; send("picked_datetime", { date: answers.date, time: answers.time }); btn.classList.add("pressed"); later(next, 160); });
      }
      if (b.type === "choice") {
        const opts = [...screenEl.querySelectorAll(".opt")];
        opts.forEach((o) => o.addEventListener("click", () => {
          if (screenEl.dataset.locked) return; screenEl.dataset.locked = "1";
          const opt = b.options.filter((x) => x.label)[+o.dataset.i];
          o.classList.add("picked"); opts.forEach((x) => x !== o && x.classList.add("dim"));
          answers.choice = opt.label; answers.choice_emoji = opt.emoji;
          burstAt(o, "hearts", 14);
          send("picked_choice", { label: opt.label, emoji: opt.emoji });
          later(next, 520);
        }));
      }
      if (b.type === "final") {
        later(() => { const f = fx(); if (f) f.burst(root, { kind: "confetti", count: 90, y: root.clientHeight * 0.25 }); }, 350);
        if (!preview && !answers.completed_at) { answers.completed_at = Date.now(); send("completed", {}); }
        q(".share").addEventListener("click", () => {
          const text = `Я сказала да! 💌 Встречаемся ${humanDate(answers.date)} в ${answers.time}. В планах: ${answers.choice}.`;
          if (navigator.share) navigator.share({ text }).catch(() => {});
          else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("Текст ответа скопирован"));
        });
        if (preview) q(".cal").addEventListener("click", (e) => e.preventDefault());
      }
    }

    function toast(t) { let el = document.querySelector(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 1800); }

    /* ---------- автопоказ (лендинг) ---------- */
    let cursor = null;
    async function moveTo(el, ms = 520) {
      if (!el || !cursor) return;
      const r = el.getBoundingClientRect(), p = root.getBoundingClientRect();
      cursor.style.transitionDuration = ms + "ms";
      cursor.style.transform = `translate(${r.left - p.left + r.width / 2}px, ${r.top - p.top + r.height / 2}px)`;
      await wait(ms + 40);
    }
    async function tap(el) { if (!cursor) return; cursor.classList.add("tap"); await wait(150); cursor.classList.remove("tap"); if (el && alive) el.click(); await wait(120); }
    async function play() {
      cursor = document.createElement("div"); cursor.className = "tc-cursor"; root.appendChild(cursor);
      await wait(900);
      const offscreen = () => { const r = root.getBoundingClientRect(); return r.bottom < 0 || r.top > innerHeight; };
      while (alive) {
        if (document.hidden || offscreen()) { await wait(800); continue; }
        const b = blocks[idx], scr = screenEl; if (!b || !scr) return;
        const q = (s) => scr.querySelector(s);
        if (b.type === "yesno") {
          for (let k = 0; k < 2 && alive; k++) { const no = q(".no"); if (!no) break; await moveTo(no); if (scr._dodge) scr._dodge(); await wait(550); }
          await moveTo(q(".yes")); await tap(q(".yes"));
        } else if (b.type === "message") { await moveTo(q(".next")); await tap(q(".next")); }
        else if (b.type === "datetime") {
          await wait(300); await moveTo(q(".date")); q(".date").value = localISO(Date.now() + 86400e3); q(".date").dispatchEvent(new Event("input")); await wait(450);
          await moveTo(q(".hh")); q(".hh").value = "20"; q(".hh").dispatchEvent(new Event("input")); await wait(350);
          await moveTo(q(".mm")); q(".mm").value = "00"; q(".mm").dispatchEvent(new Event("input")); await wait(450);
          await moveTo(q(".next")); await tap(q(".next"));
        } else if (b.type === "choice") { const o = scr.querySelectorAll(".opt"); const pick = o[Math.min(o.length - 1, 4)] || o[0]; await wait(400); await moveTo(pick); await tap(pick); }
        else if (b.type === "final") {
          await wait(4200); if (!alive) return;
          Object.keys(answers).forEach((k) => delete answers[k]); dodges = 0;
          cursor.style.transform = "translate(-80px,-80px)"; show(0, -1); await wait(900);
        }
        await wait(700);
      }
    }

    /* ---------- старт ---------- */
    const idxOf = (t) => blocks.findIndex((b) => b.type === t);
    if (expired) { root.innerHTML = `<div class="scr"><div class="inner"><div class="stk">🕰</div><h1>Открытка истекла</h1><p class="sub">Ссылка жила 30 дней. Попроси прислать новую</p></div></div>`; return { destroy() {} }; }
    let start = opts.screen ?? 0;
    if (!preview) {
      if (answers.completed_at || answers.choice) start = idxOf("final");
      else if (answers.date) start = idxOf("choice");
      else if (answers.yes) start = idxOf("datetime");
      if (start < 0) start = 0;
      send("opened", {});
    }
    show(start, 1);
    if (autoplay && !(fx() && fx().reduced)) play();

    return { goto: (i) => show(i, 1), destroy() { alive = false; timers.forEach(clearTimeout); timers.clear(); }, get answers() { return answers; } };
  }

  window.TolkoCard = { mount, humanDate };
})();
