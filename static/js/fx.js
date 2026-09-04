/* TolkoFX — частицы, появление по скроллу, ripple. Без зависимостей. */
window.TolkoFX = (() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PAL = ["#E0326E", "#FF8FB3", "#FFC1D4", "#7B5BD6", "#FFD166", "#FFFFFF"];

  function canvasIn(container, fixed) {
    const c = document.createElement("canvas");
    c.className = "fx-canvas";
    c.style.cssText = `position:${fixed ? "fixed" : "absolute"};inset:0;width:100%;height:100%;pointer-events:none;z-index:9`;
    if (!fixed && getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = container.getBoundingClientRect();
    const w = fixed ? innerWidth : r.width, h = fixed ? innerHeight : r.height;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    return { c, ctx, w, h };
  }

  function heart(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(-s * 0.7, -s * 0.15, -s * 0.45, -s * 0.75, 0, -s * 0.35);
    ctx.bezierCurveTo(s * 0.45, -s * 0.75, s * 0.7, -s * 0.15, 0, s * 0.35);
    ctx.fill();
  }

  /* Взрыв сердечек или конфетти из точки (x,y) внутри контейнера */
  function burst(container, o = {}) {
    if (reduced || !container) return;
    const kind = o.kind || "hearts", fixed = !!o.fixed, count = o.count || (kind === "confetti" ? 80 : 24);
    const { c, ctx, w, h } = canvasIn(container, fixed);
    const x = o.x ?? w / 2, y = o.y ?? h / 2, pal = o.colors || PAL;
    const P = Array.from({ length: count }, () => {
      const conf = kind === "confetti";
      const a = conf ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      const s = conf ? 5 + Math.random() * 9 : 3 + Math.random() * 5;
      return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (conf ? 3 : 0), g: conf ? 0.28 : 0.1, r: conf ? 5 + Math.random() * 5 : 7 + Math.random() * 9,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35, life: 1, decay: 0.008 + Math.random() * 0.01, col: pal[(Math.random() * pal.length) | 0], heart: !conf, sway: Math.random() * 6 };
    });
    const tick = () => {
      ctx.clearRect(0, 0, w, h); let live = 0;
      for (const p of P) {
        if (p.life <= 0) continue; live++;
        p.x += p.vx + (p.heart ? Math.sin(p.sway += 0.08) * 0.6 : 0); p.y += p.vy; p.vy += p.g; p.vx *= 0.985; p.rot += p.vr; p.life -= p.decay;
        ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4)); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col;
        if (p.heart) heart(ctx, p.r); else ctx.fillRect(-p.r / 2, -p.r / 3, p.r, p.r * 0.66);
        ctx.restore();
      }
      if (live) requestAnimationFrame(tick); else c.remove();
    };
    requestAnimationFrame(tick);
  }

  /* Медленно всплывающие сердечки на фоне секции. Возвращает stop(). */
  function ambient(container, o = {}) {
    if (reduced || !container) return () => {};
    let { c, ctx, w, h } = canvasIn(container, false);
    const n = o.count || 9, pal = o.colors || ["#E0326E", "#FF8FB3", "#7B5BD6"];
    const P = Array.from({ length: n }, (_, i) => ({ x: Math.random() * w, y: h + Math.random() * h, r: 6 + Math.random() * 10, v: 0.25 + Math.random() * 0.4, s: Math.random() * 6, col: pal[i % pal.length], a: 0.12 + Math.random() * 0.18 }));
    let run = true;
    const onResize = () => { c.remove(); ({ c, ctx, w, h } = canvasIn(container, false)); };
    addEventListener("resize", onResize);
    const tick = () => {
      if (!run) return;
      if (document.hidden) { setTimeout(tick, 500); return; }
      ctx.clearRect(0, 0, w, h);
      for (const p of P) {
        p.y -= p.v; p.s += 0.01; p.x += Math.sin(p.s) * 0.3;
        if (p.y < -20) { p.y = h + 20; p.x = Math.random() * w; }
        ctx.save(); ctx.globalAlpha = p.a; ctx.translate(p.x, p.y); ctx.fillStyle = p.col; heart(ctx, p.r); ctx.restore();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { run = false; removeEventListener("resize", onResize); c.remove(); };
  }

  /* Появление секций по скроллу: элементы видимы по умолчанию, скрываются только при поддержке JS */
  function reveal() {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reduced) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach((e) => io.observe(e));
  }

  /* Ripple на кнопках */
  function ripple(e) {
    const t = e.target.closest(".btn, .tile, .opt, .ch, .b:not(.no)");
    if (!t || reduced) return;
    const r = t.getBoundingClientRect(), s = document.createElement("span");
    s.className = "rp"; const d = Math.max(r.width, r.height) * 1.2;
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    t.appendChild(s); setTimeout(() => s.remove(), 650);
  }

  /* Счётчик, который "докручивается" до числа */
  function countUp(el, to, ms = 900) {
    if (reduced) { el.textContent = to; return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  return { burst, ambient, reveal, ripple, countUp, reduced };
})();
document.documentElement.classList.replace("no-js", "js");
document.addEventListener("DOMContentLoaded", () => { TolkoFX.reveal(); document.addEventListener("pointerdown", TolkoFX.ripple, { passive: true }); });
