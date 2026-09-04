/* Конструктор: состояние, переходы шагов, превью, попап каналов, отправка */
(function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LS = "tolkoda.draft", LSC = "tolkoda.channels";
  const STEPS = ["Повод", "Дата", "Планы", "Финал"];
  const TITLES = ["Повод и первые два экрана", "Экран с датой и временем", "Экран с планами на вечер", "Финальный экран и отправка"];
  const SCREEN_NAMES = ["Вопрос", "После «да»", "Дата", "Планы", "Финал"];

  let card = load() || TolkoPresets.build("first", "rose");
  let channels = JSON.parse(localStorage.getItem(LSC) || "{}");
  let step = 1, previewScreen = 0, previewApi = null, previewTimer = null, animating = false;

  function load() { try { const c = JSON.parse(localStorage.getItem(LS)); return c && c.blocks && c.blocks.length === 5 ? c : null; } catch (_) { return null; } }
  function save() { localStorage.setItem(LS, JSON.stringify(card)); localStorage.setItem(LSC, JSON.stringify(channels)); }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- шаги ---------- */
  function renderStepper() {
    $("#stepper .steps").innerHTML = STEPS.map((s, i) => `<div class="step ${i + 1 === step ? "active" : i + 1 < step ? "done" : ""}"><div class="dot">${i + 1 < step ? "✓" : i + 1}</div>${s}</div>`).join("");
    $("#stepper .fill").style.width = ((step - 1) / (STEPS.length - 1)) * 100 + "%";
    $("#stepLabel").textContent = `Шаг ${step} из 4`;
    $("#stepTitle").textContent = TITLES[step - 1];
    $("#back").style.visibility = step === 1 ? "hidden" : "visible";
    $("#next").textContent = step === 4 ? "Создать ссылку 💌" : "Дальше →";
    setPreview({ 1: 0, 2: 2, 3: 3, 4: 4 }[step]);
  }
  function goStep(n) {
    if (animating || n === step || n < 1 || n > 4) return;
    const cur = $(`[data-step="${step}"]`), nxt = $(`[data-step="${n}"]`), dir = n > step ? 1 : -1;
    animating = true;
    cur.style.setProperty("--dir", dir); cur.classList.add("leave");
    setTimeout(() => {
      cur.hidden = true; cur.classList.remove("leave");
      nxt.hidden = false; nxt.style.setProperty("--dir", dir); nxt.classList.add("enter");
      setTimeout(() => { nxt.classList.remove("enter"); animating = false; }, 460);
    }, 200);
    step = n; renderStepper();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("#back").addEventListener("click", () => goStep(step - 1));
  $("#next").addEventListener("click", () => {
    if (step < 4) return goStep(step + 1);
    if (!Object.keys(channels).length) openModal(); else submit();
  });

  /* ---------- повод и тема ---------- */
  function renderOccasions() {
    $("#occasions").innerHTML = TolkoPresets.occasions.map((o) => `<button class="tile" data-occ="${o.id}" aria-pressed="${card.occasion === o.id}"><span class="e">${o.emoji}</span>${o.label}</button>`).join("");
    $$("#occasions .tile").forEach((b) => b.addEventListener("click", () => {
      const fresh = TolkoPresets.build(b.dataset.occ, card.theme);
      card.occasion = fresh.occasion;
      ["title", "yes", "no"].forEach((k) => (card.blocks[0][k] = fresh.blocks[0][k]));
      ["title", "subtitle", "button"].forEach((k) => (card.blocks[1][k] = fresh.blocks[1][k]));
      renderOccasions(); bindInputs(); refresh(true);
    }));
  }
  function renderThemes() {
    $("#themes").innerHTML = TolkoPresets.themes.map((t) => `<button class="tile theme" data-theme="${t.id}" aria-pressed="${card.theme === t.id}"><span class="sw" style="background:${t.sw}"></span>${t.label}</button>`).join("");
    $$("#themes .tile").forEach((b) => b.addEventListener("click", () => { card.theme = b.dataset.theme; renderThemes(); refresh(true); }));
  }

  /* ---------- стикеры ---------- */
  function renderStickers() {
    $$("[data-stickers]").forEach((box) => {
      const i = +box.dataset.stickers, b = card.blocks[i], list = TolkoPresets.stickers[b.type] || [];
      const custom = b.sticker && b.sticker.startsWith("data:");
      box.innerHTML = list.map((s) => `<button type="button" class="sticker-btn" data-s="${s}" aria-pressed="${b.sticker === s}">${s.startsWith("/") ? `<img class="svg" src="${s}" alt="">` : s}</button>`).join("") +
        `${custom ? `<button type="button" class="sticker-btn" aria-pressed="true"><img src="${b.sticker}" alt=""></button>` : ""}
         <label class="sticker-btn upload">Загрузить<input type="file" accept="image/*" hidden></label>`;
      $$(".sticker-btn[data-s]", box).forEach((btn) => btn.addEventListener("click", () => { b.sticker = btn.dataset.s; renderStickers(); refresh(true); }));
      $("input[type=file]", box).addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (f.size > 7 * 1024 * 1024) return toast("Файл больше 7 МБ");
        const img = new Image(), url = URL.createObjectURL(f);
        img.onload = () => { const c = document.createElement("canvas"), s = 320; c.width = c.height = s; const x = c.getContext("2d");
          const m = Math.min(img.width, img.height); x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
          b.sticker = c.toDataURL("image/jpeg", 0.85); URL.revokeObjectURL(url); renderStickers(); refresh(true); toast("Картинка добавлена"); };
        img.onerror = () => toast("Не удалось прочитать картинку");
        img.src = url;
      });
    });
  }

  /* ---------- текстовые поля ---------- */
  function bindInputs() {
    $$("[data-bind]").forEach((inp) => {
      const [i, k] = inp.dataset.bind.split(".");
      inp.value = card.blocks[+i][k] ?? "";
      inp.oninput = () => { card.blocks[+i][k] = inp.value; updateCount(inp); refresh(); };
      updateCount(inp);
    });
  }
  function updateCount(inp) { const c = $(`[data-count="${inp.dataset.bind}"]`); if (c) c.textContent = `${inp.value.length}/${inp.maxLength}`; }

  /* ---------- варианты активности ---------- */
  function renderOptions() {
    const opts = card.blocks[3].options;
    while (opts.length < 6) opts.push({ emoji: "", label: "" });
    $("#options").innerHTML = opts.map((o, i) => `<div class="opt-row" style="--i:${i}">
      <input class="input" data-opt="${i}.emoji" value="${esc(o.emoji)}" placeholder="🍕" maxlength="4" style="text-align:center">
      <input class="input" data-opt="${i}.label" value="${esc(o.label)}" placeholder="Название" maxlength="18">
      <button class="link-btn" data-clear="${i}" title="Очистить">×</button></div>`).join("");
    $$("[data-opt]").forEach((inp) => inp.addEventListener("input", () => { const [i, k] = inp.dataset.opt.split("."); opts[+i][k] = inp.value; countOpts(); refresh(); }));
    $$("[data-clear]").forEach((b) => b.addEventListener("click", () => { opts[+b.dataset.clear] = { emoji: "", label: "" }; renderOptions(); refresh(true); }));
    countOpts();
  }
  function countOpts() { $("#optCount").textContent = `${card.blocks[3].options.filter((o) => o.label.trim()).length} из 6`; }

  /* ---------- превью ---------- */
  function renderTabs() {
    $("#previewTabs").innerHTML = SCREEN_NAMES.map((n, i) => `<button aria-selected="${i === previewScreen}" data-i="${i}">${n}</button>`).join("");
    $$("#previewTabs button").forEach((b) => b.addEventListener("click", () => setPreview(+b.dataset.i)));
  }
  function setPreview(i) { previewScreen = i; renderTabs(); refresh(true); }
  function refresh(now) {
    save();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (previewApi) previewApi.destroy();
      const el = $("#preview"); el.className = "screen";
      const first = card.blocks[3].options.find((o) => o.label) || {};
      previewApi = TolkoCard.mount(el, { card, preview: true, screen: previewScreen,
        answers: { date: new Date(Date.now() + 86400e3).toISOString().slice(0, 10), time: "20:00", choice: first.label || "Прогулка", choice_emoji: first.emoji || "✨" } });
      const ph = $(".preview-col .phone"); ph.classList.remove("pulse"); void ph.offsetWidth; ph.classList.add("pulse");
    }, now ? 0 : 220);
  }

  /* ---------- попап каналов ---------- */
  const CH = window.CHANNELS || {};
  const DEF = [
    { key: "email", ic: "✉️", t: "Почта", d: "Письмо на адрес. Самый надёжный вариант." },
    { key: "push", ic: "🔔", t: "Пуш на этот телефон", d: "Системное уведомление, мессенджер не нужен. На iPhone сначала добавь сайт на экран «Домой»." },
    { key: "vk", ic: "💙", t: "ВКонтакте", d: "Сообщение от нашего сообщества. Разрешишь одним тапом после создания ссылки." },
    { key: "telegram", ic: "✈️", t: "Telegram", d: "Бот пришлёт ответ. Работает там, где работает Telegram." },
    { key: "max", ic: "🟣", t: "MAX", d: "Бот в MAX. На iPhone только через веб-версию." },
  ];
  function chStatus(k) {
    if (k === "email") return channels.email?.address ? { c: "on", t: channels.email.address } : { c: "", t: "" };
    if (k === "push") return channels.push?.subscription ? { c: "on", t: "включено" } : { c: "", t: "" };
    if (!CH[k]?.configured) return { c: "warn", t: "демо" };
    return channels[k] ? { c: "wait", t: "привяжем после" } : { c: "", t: "" };
  }
  function renderChannels(animate) {
    $("#chList").innerHTML = DEF.map((c, i) => { const st = chStatus(c.key); return `
      <div style="--i:${animate ? i : 0}"><button type="button" class="ch" data-ch="${c.key}" aria-pressed="${!!channels[c.key]}">
        <span class="ic">${c.ic}</span><span><div class="t">${c.t}</div><div class="d">${c.d}</div></span><span class="st ${st.c}">${st.t}</span></button>
        ${c.key === "email" && channels.email ? `<div class="ch-extra"><input class="input" id="emailInput" type="email" placeholder="you@mail.ru" value="${esc(channels.email.address || "")}"></div>` : ""}
        ${c.key === "push" && channels.push && !channels.push.subscription ? `<div class="ch-extra"><button type="button" class="btn sm" id="pushBtn">Включить уведомления</button> <span class="small muted" id="pushNote"></span></div>` : ""}
      </div>`; }).join("") + `<div style="--i:${animate ? DEF.length : 0}"><div class="ch" style="opacity:.8;cursor:default"><span class="ic">💬</span><span><div class="t">Через неё саму</div><div class="d">На финальном экране у неё будет кнопка «Отправить ему ответ». Работает в любом мессенджере.</div></span><span class="st on">всегда</span></div></div>`;
    $$("#chList .ch[data-ch]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.ch;
      if (channels[k]) delete channels[k]; else channels[k] = k === "email" ? { address: channels.email?.address || "" } : {};
      renderChannels(false);
      if (k === "email") setTimeout(() => $("#emailInput")?.focus(), 0);
    }));
    $("#emailInput")?.addEventListener("input", (e) => { channels.email.address = e.target.value.trim(); save(); });
    $("#pushBtn")?.addEventListener("click", async () => {
      const note = $("#pushNote"); note.textContent = "…";
      try { channels.push = { subscription: await TolkoPush.subscribe(CH.push.vapid_public) }; save(); renderChannels(false); toast("Уведомления включены"); }
      catch (e) { note.textContent = e.message; }
    });
    renderChosen();
  }
  function renderChosen() {
    const names = { email: "✉️ Почта", push: "🔔 Пуш", vk: "💙 VK", telegram: "✈️ Telegram", max: "🟣 MAX" };
    const keys = Object.keys(channels);
    $("#chosenChannels").innerHTML = keys.length ? keys.map((k) => `<span class="chip on"><span class="s"></span>${names[k]}${k === "email" && channels.email.address ? ` · ${esc(channels.email.address)}` : ""}</span>`).join("") : `<span class="muted small">Спросим перед созданием ссылки.</span>`;
    $("#openChannels").textContent = keys.length ? "Изменить" : "Выбрать сейчас";
  }
  let lastFocus = null;
  function openModal() { lastFocus = document.activeElement; renderChannels(true); $("#chModal").classList.remove("closing"); $("#chModal").classList.add("open"); setTimeout(() => $("#chList .ch")?.focus(), 350); }
  function closeModal() { const m = $("#chModal"); m.classList.add("closing"); setTimeout(() => { m.classList.remove("open", "closing"); lastFocus?.focus?.(); }, 220); save(); renderChosen(); }
  $("#openChannels").addEventListener("click", openModal);
  $("#chSkip").addEventListener("click", () => { closeModal(); submit(); });
  $("#chDone").addEventListener("click", () => {
    if (channels.email && !/^\S+@\S+\.\S+$/.test(channels.email.address || "")) { const i = $("#emailInput"); i?.classList.add("shake"); setTimeout(() => i?.classList.remove("shake"), 350); i?.focus(); return toast("Введи адрес почты"); }
    if (channels.push && !channels.push.subscription) return toast("Включи уведомления или убери пуш из списка");
    closeModal(); submit();
  });
  $("#chModal").addEventListener("click", (e) => { if (e.target.id === "chModal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#chModal").classList.contains("open")) closeModal(); });

  /* ---------- отправка ---------- */
  async function submit() {
    const btn = $("#next"); btn.disabled = true; btn.textContent = "Создаём ссылку…";
    const clean = JSON.parse(JSON.stringify(card));
    clean.blocks[3].options = clean.blocks[3].options.filter((o) => o.label.trim());
    const chans = {}; Object.keys(channels).forEach((k) => (chans[k] = { enabled: true, ...channels[k], ...(k === "push" ? { subscriptions: channels.push.subscription ? [channels.push.subscription] : [] } : {}) }));
    try {
      const r = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: clean, channels: chans }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      localStorage.removeItem(LS);
      btn.textContent = "Готово ✓";
      location.href = j.sent_url;
    } catch (e) { toast("Не получилось создать ссылку: " + e.message); btn.disabled = false; btn.textContent = "Создать ссылку 💌"; }
  }

  $("#resetDraft")?.addEventListener("click", () => { if (confirm("Сбросить тексты и картинки к начальным?")) { localStorage.removeItem(LS); location.reload(); } });

  renderOccasions(); renderThemes(); renderStickers(); bindInputs(); renderOptions(); renderChosen(); renderStepper();
})();
