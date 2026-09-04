/* Страница отправителя: ссылка, каналы, живой статус с анимацией новых событий */
(function () {
  const $ = (s) => document.querySelector(s);
  const { code, key, link, deep, cfg } = window.SENT;
  const api = (p, o) => fetch(`/api/invitations/${code}/${p}?key=${encodeURIComponent(key)}`, o).then((r) => r.json());
  const NAMES = { email: "✉️ Почта", push: "🔔 Пуш", vk: "💙 VK", telegram: "✈️ Telegram", max: "🟣 MAX" };
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const hd = (iso) => { if (!iso) return ""; const d = new Date(iso + "T00:00:00"); return isNaN(d) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const tm = (t) => new Date(t * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TXT = { opened: "Открыла открытку 👀", no_dodged: "Попыталась нажать «Нет». Не вышло 😏", answered_yes: "Сказала «да» ❤️", picked_datetime: (p) => `Выбрала ${esc(hd(p.date))} в ${esc(p.time)}`, picked_choice: (p) => `План на вечер: ${esc(p.emoji || "")} ${esc(p.label)}`, completed: "Дошла до финала. Договорились 🎉" };

  const flash = (btn, text) => { const old = btn.textContent; btn.textContent = text; btn.classList.add("ok"); setTimeout(() => { btn.textContent = old; btn.classList.remove("ok"); }, 1600); };
  const copy = (t) => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject());

  /* ссылка */
  $("#copy").addEventListener("click", (e) => { const b = e.currentTarget; copy(link).then(() => flash(b, "Скопировано ✓")).catch(() => toast("Скопируй вручную")); });
  $("#copyOwner").addEventListener("click", () => copy(location.href).then(() => toast("Ссылка на эту страницу скопирована. Никому её не отправляй")).catch(() => toast("Скопируй адрес из строки браузера")));
  $("#share").addEventListener("click", (e) => { const b = e.currentTarget; if (navigator.share) navigator.share({ title: "Тебе приглашение 💌", url: link }).catch(() => {}); else copy(link).then(() => flash(b, "Скопировано ✓")).catch(() => toast("Скопируй вручную")); });
  $("#mailShare").href = `mailto:?subject=${encodeURIComponent("Тебе приглашение 💌")}&body=${encodeURIComponent("Открой, это для тебя: " + link)}`;
  $("#qrBtn").addEventListener("click", async () => { const b = $("#qrBox"); b.hidden = !b.hidden; if (!b.hidden && !$("#qr").innerHTML) $("#qr").innerHTML = await fetch(`/api/qr?url=${encodeURIComponent(link)}`).then((r) => r.text()); });

  /* каналы */
  let state = null, seen = 0, celebrated = !!localStorage.getItem("tolkoda.celebrated." + code);
  function renderChannels(ch) {
    const keys = Object.keys(ch);
    $("#chips").innerHTML = (keys.length ? keys.map((k, i) => {
      const c = ch[k]; let cls = "on", extra = "";
      if (k === "email") extra = ` · ${esc(c.address)}`;
      if (k === "push") { cls = c.subscriptions?.length ? "on" : "wait"; extra = c.subscriptions?.length ? "" : " · не включён"; }
      if (["vk", "telegram", "max"].includes(k)) { if (!cfg[k].configured) { cls = "wait"; extra = " · демо"; } else if (!c.linked) { cls = "wait"; extra = " · ждёт привязки"; } }
      return `<span class="chip ${cls}" style="animation-delay:${i * 60}ms"><span class="s"></span>${NAMES[k]}${extra}</span>`;
    }).join("") : `<span class="chip"><span class="s"></span>Только эта страница</span>`) + `<span class="chip on" style="animation-delay:${keys.length * 60}ms"><span class="s"></span>💬 Через неё саму</span>`;

    const acts = [];
    ["telegram", "max", "vk"].forEach((k) => { if (ch[k] && !ch[k].linked && cfg[k].configured && deep[k]) acts.push(`<a class="btn sm" href="${deep[k]}" target="_blank" rel="noopener">Привязать ${NAMES[k]}</a>`); });
    if (!ch.push?.subscriptions?.length) acts.push(`<button class="btn ghost sm" id="addPush">🔔 Включить пуш на этом телефоне</button>`);
    if (!ch.email) acts.push(`<form id="addEmailForm" style="display:flex;gap:6px;align-items:center"><input class="input" type="email" required placeholder="Почта для ответов" style="padding:9px 12px;font-size:14px;width:220px"><button class="btn ghost sm">Добавить</button></form>`);
    $("#chActions").innerHTML = acts.join("");
    const notes = [];
    ["telegram", "max", "vk"].forEach((k) => { if (ch[k] && !cfg[k].configured) notes.push(`${NAMES[k]}: бот не настроен на сервере, сообщения пишутся в data/outbox.log`); });
    if (ch.email && !cfg.email.configured) notes.push("Почта: SMTP не настроен, письма пишутся в data/outbox.log");
    $("#chNote").textContent = notes.join(" · ");

    $("#addPush")?.addEventListener("click", async () => {
      try { const sub = await TolkoPush.subscribe(cfg.push.vapid_public); await api("channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ push: { subscription: sub, enabled: true } }) }); toast("Пуш включён"); poll(); }
      catch (e) { toast(e.message); }
    });
    $("#addEmailForm")?.addEventListener("submit", async (e) => {
      e.preventDefault(); const a = e.target.querySelector("input").value.trim(); if (!a) return;
      await api("channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: { address: a, enabled: true } }) }); toast("Почта добавлена"); poll();
    });
  }
  $("#test").addEventListener("click", async (e) => { const b = e.currentTarget; b.disabled = true; const r = await api("test", { method: "POST" }); b.disabled = false; if (!r.results.length) toast("Каналы не выбраны"); else flash(b, "Отправлено ✓"); poll(); });

  /* статус */
  function render(s) {
    const evs = s.events.filter((e) => TXT[e.type]);
    const st = { sent: "Ещё не открыла", opened: "Открыла и думает…", answered: "Сказала «да» ❤️", completed: "Договорились 🎉" }[s.status];
    const big = $("#statusBig");
    if (big.textContent !== st) { big.textContent = st; big.classList.remove("rise"); void big.offsetWidth; big.classList.add("rise"); }
    big.classList.toggle("done", s.status === "completed");
    const a = s.answers;
    $("#statusSub").textContent = s.status === "completed" ? `${hd(a.date)} в ${a.time} · ${a.choice_emoji || ""} ${a.choice}` : "Обновляется само. Можно закрыть и вернуться позже.";
    $("#result").hidden = !a.date;
    $("#timeline").innerHTML = evs.length ? evs.slice().reverse().map((e, i) => `<li class="${i < evs.length - seen ? "new" : ""}"><span class="m ${i === 0 && s.status !== "completed" ? "live" : ""}"></span><div>${typeof TXT[e.type] === "function" ? TXT[e.type](e.payload || {}) : TXT[e.type]}<br><time>${tm(e.at)}</time></div></li>`).join("")
      : `<li><span class="m dim live"></span><div class="muted">Пока тихо. Первая запись появится, как только она откроет ссылку.</div></li>`;
    seen = evs.length;
    $("#notifyLog").innerHTML = (s.notify_log || []).slice(-6).reverse().map((n) => `<li><span class="${n.ok ? "ok" : "fail"}">${n.ok ? "✓" : "✗"}</span> ${tm(n.at)} ${esc(NAMES[n.channel] || n.channel)}: ${esc(n.note)}</li>`).join("");
    if (JSON.stringify(s.channels) !== JSON.stringify(state?.channels)) renderChannels(s.channels);
    if (s.status === "completed" && !celebrated) { celebrated = true; localStorage.setItem("tolkoda.celebrated." + code, "1"); window.TolkoFX?.burst(document.body, { kind: "confetti", count: 160, fixed: true, y: 80 }); }
    state = s;
  }
  async function poll() { try { render(await api("status")); } catch (_) {} }
  poll(); setInterval(() => { if (!document.hidden) poll(); }, 3000);
})();
