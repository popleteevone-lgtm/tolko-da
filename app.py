"""Только Да — рабочий прототип. Запуск: python3 app.py (порт 5173)."""
import os, io, json, time, datetime
from flask import Flask, request, jsonify, render_template, abort, redirect, url_for, Response, send_from_directory
import storage, channels

from werkzeug.middleware.proxy_fix import ProxyFix

ASSET_VERSION = str(int(time.time()))  # сбрасывает кэш css/js при каждом запуске сервера

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024  # images arrive as data URLs inside JSON
# behind a tunnel or reverse proxy (cloudflared, ngrok, nginx) trust X-Forwarded-* so links are https and public
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


@app.context_processor
def inject_asset_version():
    return {"v": ASSET_VERSION}

MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
          "августа", "сентября", "октября", "ноября", "декабря"]


def human_date(iso):
    try:
        d = datetime.date.fromisoformat(iso)
        return f"{d.day} {MONTHS[d.month - 1]}"
    except Exception:
        return iso or ""


def public_inv(inv):
    """What the recipient page is allowed to see."""
    return {
        "code": inv["code"],
        "card": inv["card"],
        "answers": inv["answers"],
        "status": inv["status"],
        "expired": time.time() > inv["expires_at"],
    }


def base_url():
    return os.environ.get("PUBLIC_URL", request.url_root.rstrip("/"))


# ------------------------------------------------------------------ pages
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/create")
def create():
    return render_template("create.html", channels=channels.describe())


@app.get("/sent/<code>")
def sent(code):
    inv = storage.get_invitation(code)
    if not inv or request.args.get("key") != inv["owner_key"]:
        abort(404)
    return render_template("sent.html", inv=inv, code=code, key=inv["owner_key"],
                           link=f"{base_url()}/i/{code}", channels=channels.describe(),
                           deep={"telegram": channels.Telegram.deep_link(inv["owner_key"]),
                                 "max": channels.Max.deep_link(inv["owner_key"]),
                                 "vk": channels.VK.deep_link(inv["owner_key"])})


@app.get("/i/<code>")
def card(code):
    inv = storage.get_invitation(code)
    if not inv:
        abort(404)
    if time.time() > inv["expires_at"]:
        return render_template("expired.html"), 410
    preview = request.args.get("preview") == "1"
    return render_template("card.html", inv=public_inv(inv), code=code, preview=preview,
                           og_title=inv["card"]["blocks"][0].get("title", "Тебе приглашение"),
                           og_url=f"{base_url()}/i/{code}")


@app.get("/manifest.json")
def manifest():
    return jsonify({
        "name": "Только Да", "short_name": "Только Да", "start_url": "/",
        "display": "standalone", "background_color": "#FBF0F3", "theme_color": "#D62F6A",
        "icons": [{"src": "/static/icon.svg", "sizes": "any", "type": "image/svg+xml"}],
    })


@app.get("/sw.js")
def sw():
    return send_from_directory("static", "sw.js", mimetype="application/javascript")


# ------------------------------------------------------------------ API
@app.post("/api/invitations")
def api_create():
    data = request.get_json(force=True)
    card = data.get("card") or {}
    blocks = card.get("blocks")
    if not isinstance(blocks, list) or not blocks or len(blocks) > 12:
        return jsonify({"error": "empty card"}), 400
    if any(not isinstance(b, dict) or b.get("type") not in ("yesno", "message", "datetime", "choice", "final") for b in blocks):
        return jsonify({"error": "bad block"}), 400
    chans = {k: v for k, v in (data.get("channels") or {}).items() if k in channels.CHANNELS and isinstance(v, dict)}
    inv = storage.create_invitation({"card": card, "channels": chans})
    return jsonify({"code": inv["code"], "key": inv["owner_key"],
                    "sent_url": f"/sent/{inv['code']}?key={inv['owner_key']}"})


def _owner(code):
    inv = storage.get_invitation(code)
    if not inv or request.args.get("key") != inv["owner_key"]:
        abort(404)
    return inv


@app.get("/api/invitations/<code>/status")
def api_status(code):
    inv = _owner(code)
    return jsonify({"status": inv["status"], "answers": inv["answers"], "channels": inv["channels"],
                    "events": storage.list_events(code), "notify_log": inv["notify_log"],
                    "expires_at": inv["expires_at"]})


@app.post("/api/invitations/<code>/channels")
def api_channels(code):
    """Sender adds / changes channels after creation (push subscription, email, etc.)."""
    _owner(code)
    patch = request.get_json(force=True)

    def mut(inv):
        for k, v in patch.items():
            if k not in channels.CHANNELS:
                continue
            if v is None:
                inv["channels"].pop(k, None)
            elif k == "push":
                cur = inv["channels"].setdefault("push", {"enabled": True, "subscriptions": []})
                sub = v.get("subscription")
                if sub and sub not in cur["subscriptions"]:
                    cur["subscriptions"].append(sub)
                cur["enabled"] = v.get("enabled", True)
            else:
                inv["channels"][k] = {**inv["channels"].get(k, {}), **v}
    inv = storage.update_invitation(code, mut)
    return jsonify({"channels": inv["channels"]})


@app.post("/api/invitations/<code>/test")
def api_test(code):
    inv = _owner(code)
    res = channels.notify(inv, "Проверка связи 💌 Сюда прилетит её ответ.",
                          {"subject": "Только Да: проверка", "url": f"/sent/{code}?key={inv['owner_key']}"})
    return jsonify({"results": res})


EVENT_TEXT = {
    "opened": "Она открыла приглашение 👀",
    "no_dodged": "Пыталась нажать «Нет», кнопка убежала 😏",
    "answered_yes": "Она сказала ДА ❤️",
    "picked_datetime": "Выбрала дату: {date} в {time}",
    "picked_choice": "Выбрала: {choice}",
    "completed": "Договорились! {date} в {time}. В планах: {choice}",
}
NOTIFY_ON = {"opened", "answered_yes", "picked_datetime", "picked_choice", "completed"}


@app.post("/api/i/<code>/events")
def api_event(code):
    inv = storage.get_invitation(code)
    if not inv or time.time() > inv["expires_at"]:
        abort(404)
    data = request.get_json(force=True)
    etype = data.get("type")
    payload = data.get("payload") or {}
    if etype not in EVENT_TEXT or not isinstance(payload, dict):
        return jsonify({"error": "unknown event"}), 400
    # the recipient is anonymous: validate everything she sends before it reaches the sender
    try:
        if etype == "picked_datetime":
            datetime.date.fromisoformat(payload["date"])
            datetime.datetime.strptime(payload["time"], "%H:%M")
            payload = {"date": payload["date"], "time": payload["time"]}
        elif etype == "picked_choice":
            label = str(payload.get("label", ""))[:40].strip()
            if not label:
                raise ValueError
            payload = {"label": label, "emoji": str(payload.get("emoji", ""))[:8]}
        elif etype == "answered_yes":
            payload = {"dodges": int(payload.get("dodges", 0))}
        else:
            payload = {}
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "bad payload"}), 400
    if data.get("preview"):
        return jsonify({"ok": True, "preview": True})

    # idempotency: one-shot events don't fire twice (reopen must not spam the sender)
    existing = storage.list_events(code)
    once = {"opened", "no_dodged", "answered_yes", "completed"}
    if etype in once and any(e["type"] == etype for e in existing):
        return jsonify({"ok": True, "duplicate": True})
    if len(existing) >= 30:  # anonymous endpoint: hard cap so nobody can flood the sender
        return jsonify({"error": "too many events"}), 429

    # remember answers on the invitation itself
    def mut(i):
        if etype == "picked_datetime":
            i["answers"].update({"date": payload.get("date"), "time": payload.get("time")})
        elif etype == "picked_choice":
            i["answers"].update({"choice": payload.get("label"), "choice_emoji": payload.get("emoji")})
        elif etype == "answered_yes":
            i["answers"]["yes"] = True
        elif etype == "completed":
            i["answers"]["completed_at"] = time.time()
    inv = storage.update_invitation(code, mut)
    storage.add_event(code, etype, payload)

    if etype in NOTIFY_ON:
        a = inv["answers"]
        text = EVENT_TEXT[etype].format(date=human_date(a.get("date", "")), time=a.get("time", ""),
                                        choice=a.get("choice", ""))
        link = f"{base_url()}/sent/{code}?key={inv['owner_key']}"
        channels.notify(inv, f"{text}\n\nСтатус: {link}",
                        {"subject": f"Только Да: {text[:40]}", "url": f"/sent/{code}?key={inv['owner_key']}"})
    return jsonify({"ok": True})


@app.get("/api/i/<code>/calendar.ics")
def api_ics(code):
    inv = storage.get_invitation(code)
    if not inv or not inv["answers"].get("date"):
        abort(404)
    a = inv["answers"]
    d = datetime.datetime.fromisoformat(f"{a['date']}T{a.get('time', '19:00')}:00")
    end = d + datetime.timedelta(hours=2)
    fmt = "%Y%m%dT%H%M%S"
    title = f"Свидание: {a.get('choice', '')}".strip(": ")
    ics = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Только Да//RU", "BEGIN:VEVENT",
        f"UID:{code}@tolko-da", f"DTSTAMP:{datetime.datetime.utcnow().strftime(fmt)}Z",
        f"DTSTART:{d.strftime(fmt)}", f"DTEND:{end.strftime(fmt)}", f"SUMMARY:{title}",
        "DESCRIPTION:Договорились! 💌", "END:VEVENT", "END:VCALENDAR", ""])
    return Response(ics, mimetype="text/calendar",
                    headers={"Content-Disposition": "attachment; filename=svidanie.ics"})


# ---------- OG-картинка под тему приглашения ----------
OG_THEMES = {
    "rose": ("#FFDCE7", "#FFF4EE", "#E0326E", "#2B1E25", "#8E7A84"),
    "lavender": ("#E6DBFF", "#F6F0FF", "#7B5BD6", "#2B1E25", "#8E7A84"),
    "peach": ("#FFD9C2", "#FFF3E8", "#F0653A", "#2B1E25", "#8E7A84"),
    "night": ("#2A1E4A", "#141026", "#FF5C8A", "#F6EEF6", "#B9A9C9"),
}
OG_DIR = os.path.join(storage.DATA_DIR, "og")
FONT_DIR = os.path.join(os.path.dirname(__file__), "static", "fonts")


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _font(name, size, weight):
    from PIL import ImageFont
    f = ImageFont.truetype(os.path.join(FONT_DIR, name), size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def _heart(cx, cy, r):
    import math
    pts = []
    for i in range(80):
        t = 2 * math.pi * i / 80
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * r / 16, cy - y * r / 16))
    return pts


def render_og(inv):
    from PIL import Image, ImageDraw
    import numpy as np
    theme = inv["card"].get("theme") or "rose"
    c1, c2, acc, ink, muted = OG_THEMES.get(theme, OG_THEMES["rose"])
    W, H = 1200, 630
    # диагональный градиент фона
    x = np.linspace(0, 1, W)[None, :]
    y = np.linspace(0, 1, H)[:, None]
    t = np.clip(x * 0.65 + y * 0.35, 0, 1)
    a, b = np.array(_rgb(c1), float), np.array(_rgb(c2), float)
    arr = (a[None, None, :] * (1 - t[..., None]) + b[None, None, :] * t[..., None]).astype("uint8")
    img = Image.fromarray(arr, "RGB").convert("RGBA")
    # мягкое свечение и сердца справа
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ar = _rgb(acc)
    d.ellipse((760, 120, 1360, 720), fill=ar + (38,))
    d.polygon(_heart(985, 300, 150), fill=ar + (235,))
    d.polygon(_heart(1110, 130, 48), fill=ar + (150,))
    d.polygon(_heart(845, 500, 40), fill=ar + (120,))
    img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)
    # тексты
    label = _font("Manrope-var.ttf", 26, 700)
    title_f = _font("Unbounded-var.ttf", 60, 700)
    foot = _font("Manrope-var.ttf", 28, 500)
    d.text((72, 84), "Т Е Б Е   П Р И Г Л А Ш Е Н И Е", font=label, fill=_rgb(acc))
    title = (inv["card"]["blocks"][0].get("title") or "Пойдёшь со мной на свидание?").strip()
    words, lines, cur = title.split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if d.textlength(test, font=title_f) <= 700:
            cur = test
        else:
            lines.append(cur); cur = w
        if len(lines) == 3:
            break
    if cur and len(lines) < 3:
        lines.append(cur)
    if len(lines) == 3 and len(words) > sum(len(l.split()) for l in lines):
        lines[2] = lines[2].rstrip(".,!?") + "…"
    yy = 150
    for l in lines:
        d.text((72, yy), l, font=title_f, fill=_rgb(ink))
        yy += 76
    d.text((72, 530), "только да  ·  открой, это для тебя", font=foot, fill=_rgb(muted))
    d.rounded_rectangle((72, 500, 132, 506), radius=3, fill=_rgb(acc))
    return img.convert("RGB")


@app.get("/i/<code>/og.png")
def og_image(code):
    inv = storage.get_invitation(code)
    if not inv:
        abort(404)
    import hashlib
    key = hashlib.md5(json.dumps([inv["card"].get("theme"), inv["card"]["blocks"][0].get("title")], ensure_ascii=False).encode()).hexdigest()[:10]
    os.makedirs(OG_DIR, exist_ok=True)
    path = os.path.join(OG_DIR, f"{code}-{key}.png")
    if not os.path.exists(path):
        render_og(inv).save(path, "PNG", optimize=True)
    resp = send_from_directory(OG_DIR, os.path.basename(path), mimetype="image/png")
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@app.get("/api/stats")
def api_stats():
    db = storage._load()
    invs = db["invitations"].values()
    return jsonify({"sent": len(db["invitations"]), "yes": sum(1 for i in invs if i["answers"].get("yes"))})


@app.get("/api/qr")
def api_qr():
    import qrcode, qrcode.image.svg
    url = request.args.get("url", "")
    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=1)
    buf = io.BytesIO()
    img.save(buf)
    return Response(buf.getvalue(), mimetype="image/svg+xml")


@app.errorhandler(404)
def nf(e):
    return render_template("expired.html", notfound=True), 404


if __name__ == "__main__":
    channels.start_pollers()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5173")), debug=False, threaded=True)
