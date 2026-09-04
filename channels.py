"""Delivery channels for the sender's notifications.

Every channel exposes: available() -> bool (is it configured), send(inv, text, extra) -> (ok, note).
When a channel is not configured we write the message to data/outbox.log so the prototype
still shows the full flow ("демо-режим").
"""
import os, json, time, smtplib, threading, urllib.request, urllib.parse
from email.mime.text import MIMEText
from email.header import Header
import storage

OUTBOX = os.path.join(storage.DATA_DIR, "outbox.log")


def _outbox(channel, to, text):
    os.makedirs(storage.DATA_DIR, exist_ok=True)
    with open(OUTBOX, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {channel} -> {to}\n{text}\n\n")


def _http_json(url, data=None, headers=None, method=None):
    body = None
    hdrs = {"User-Agent": "tolko-da-proto"}
    if headers:
        hdrs.update(headers)
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


# ---------------------------------------------------------------- email
class Email:
    key = "email"
    label = "Почта"

    @staticmethod
    def available():
        return bool(os.environ.get("SMTP_HOST"))

    @staticmethod
    def send(inv, text, extra):
        to = inv["channels"].get("email", {}).get("address")
        if not to:
            return False, "адрес не указан"
        subject = extra.get("subject", "Только Да: новый ответ")
        if not Email.available():
            _outbox("email", to, f"{subject}\n{text}")
            return True, "демо: письмо записано в outbox.log"
        msg = MIMEText(text, "plain", "utf-8")
        msg["Subject"] = Header(subject, "utf-8")
        msg["From"] = os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER"))
        msg["To"] = to
        host, port = os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "465"))
        try:
            if port == 465:
                s = smtplib.SMTP_SSL(host, port, timeout=15)
            else:
                s = smtplib.SMTP(host, port, timeout=15)
                s.starttls()
            s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
            s.sendmail(msg["From"], [to], msg.as_string())
            s.quit()
            return True, "отправлено"
        except Exception as e:  # noqa
            return False, f"ошибка SMTP: {e}"


# ---------------------------------------------------------------- telegram
class Telegram:
    key = "telegram"
    label = "Telegram"

    @staticmethod
    def available():
        return bool(os.environ.get("TELEGRAM_BOT_TOKEN"))

    @staticmethod
    def bot_username():
        return os.environ.get("TELEGRAM_BOT_USERNAME", "")

    @staticmethod
    def deep_link(owner_key):
        u = Telegram.bot_username()
        return f"https://t.me/{u}?start={owner_key}" if u else ""

    @staticmethod
    def send(inv, text, extra):
        chat_id = inv["channels"].get("telegram", {}).get("chat_id")
        if not Telegram.available():
            _outbox("telegram", chat_id or "не привязан", text)
            return True, "демо: бот не настроен, записано в outbox.log"
        if not chat_id:
            return False, "бот ещё не привязан (нажми Старт в Telegram)"
        try:
            r = _http_json(
                f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage",
                {"chat_id": chat_id, "text": text},
            )
            return bool(r.get("ok")), "отправлено" if r.get("ok") else str(r)
        except Exception as e:  # noqa
            return False, f"ошибка Telegram API: {e}"

    @staticmethod
    def poll_loop():
        """Long-poll getUpdates and bind /start <owner_key> to invitations. No webhook needed."""
        token = os.environ.get("TELEGRAM_BOT_TOKEN")
        if not token:
            return
        offset = storage.meta_get("tg_offset", 0)
        while True:
            try:
                r = _http_json(f"https://api.telegram.org/bot{token}/getUpdates?timeout=25&offset={offset}")
                for upd in r.get("result", []):
                    offset = upd["update_id"] + 1
                    msg = upd.get("message") or {}
                    text = msg.get("text", "")
                    if text.startswith("/start "):
                        key = text.split(" ", 1)[1].strip()
                        inv = storage.find_by_owner_key(key)
                        if inv:
                            chat_id = msg["chat"]["id"]
                            storage.update_invitation(
                                inv["code"],
                                lambda i: i["channels"].setdefault("telegram", {}).update({"chat_id": chat_id, "linked": True}),
                            )
                            _http_json(
                                f"https://api.telegram.org/bot{token}/sendMessage",
                                {"chat_id": chat_id, "text": "Привязано ❤️ Сюда прилетит её ответ."},
                            )
                storage.meta_set("tg_offset", offset)
            except Exception:
                time.sleep(5)


# ---------------------------------------------------------------- MAX (VK's messenger, TamTam-based bot API)
class Max:
    key = "max"
    label = "MAX"
    API = "https://botapi.max.ru"

    @staticmethod
    def available():
        return bool(os.environ.get("MAX_BOT_TOKEN"))

    @staticmethod
    def deep_link(owner_key):
        u = os.environ.get("MAX_BOT_USERNAME", "")
        return f"https://max.ru/{u}?start={owner_key}" if u else ""

    @staticmethod
    def send(inv, text, extra):
        chat_id = inv["channels"].get("max", {}).get("chat_id")
        if not Max.available():
            _outbox("max", chat_id or "не привязан", text)
            return True, "демо: бот не настроен, записано в outbox.log"
        if not chat_id:
            return False, "бот ещё не привязан"
        try:
            r = _http_json(
                f"{Max.API}/messages?chat_id={chat_id}",
                {"text": text},
                headers={"Authorization": os.environ["MAX_BOT_TOKEN"]},
            )
            return "message" in r, "отправлено" if "message" in r else str(r)
        except Exception as e:  # noqa
            return False, f"ошибка MAX API: {e}"

    @staticmethod
    def poll_loop():
        token = os.environ.get("MAX_BOT_TOKEN")
        if not token:
            return
        marker = storage.meta_get("max_marker")
        while True:
            try:
                q = f"?timeout=25" + (f"&marker={marker}" if marker else "")
                r = _http_json(f"{Max.API}/updates{q}", headers={"Authorization": token})
                for upd in r.get("updates", []):
                    if upd.get("update_type") == "bot_started":
                        key = upd.get("payload") or ""
                        inv = storage.find_by_owner_key(key)
                        if inv:
                            chat_id = upd.get("chat_id")
                            storage.update_invitation(
                                inv["code"],
                                lambda i: i["channels"].setdefault("max", {}).update({"chat_id": chat_id, "linked": True}),
                            )
                marker = r.get("marker", marker)
                storage.meta_set("max_marker", marker)
            except Exception:
                time.sleep(5)


# ---------------------------------------------------------------- VK community messages
class VK:
    key = "vk"
    label = "ВКонтакте"
    V = "5.199"

    @staticmethod
    def available():
        return bool(os.environ.get("VK_GROUP_TOKEN") and os.environ.get("VK_GROUP_ID"))

    @staticmethod
    def deep_link(owner_key):
        g = os.environ.get("VK_GROUP_SCREEN_NAME", "")
        return f"https://vk.me/{g}?ref={owner_key}&ref_source=tolkoda" if g else ""

    @staticmethod
    def _call(method, **params):
        params.update({"access_token": os.environ["VK_GROUP_TOKEN"], "v": VK.V})
        data = urllib.parse.urlencode(params).encode()
        req = urllib.request.Request(f"https://api.vk.com/method/{method}", data=data)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())

    @staticmethod
    def send(inv, text, extra):
        user_id = inv["channels"].get("vk", {}).get("user_id")
        if not VK.available():
            _outbox("vk", user_id or "не привязан", text)
            return True, "демо: сообщество не настроено, записано в outbox.log"
        if not user_id:
            return False, "сообщения от сообщества ещё не разрешены"
        try:
            r = VK._call("messages.send", user_id=user_id, random_id=int(time.time() * 1000), message=text)
            return "response" in r, "отправлено" if "response" in r else str(r)
        except Exception as e:  # noqa
            return False, f"ошибка VK API: {e}"

    @staticmethod
    def poll_loop():
        if not VK.available():
            return
        gid = os.environ["VK_GROUP_ID"]
        while True:
            try:
                s = VK._call("groups.getLongPollServer", group_id=gid)["response"]
                server, key, ts = s["server"], s["key"], s["ts"]
                while True:
                    url = f"{server}?act=a_check&key={key}&ts={ts}&wait=25"
                    with urllib.request.urlopen(url, timeout=40) as r:
                        data = json.loads(r.read().decode())
                    if "failed" in data:
                        break
                    ts = data["ts"]
                    for upd in data.get("updates", []):
                        obj = upd.get("object", {})
                        ref = None
                        if upd["type"] == "message_allow":
                            ref = obj.get("key")
                            uid = obj.get("user_id")
                        elif upd["type"] == "message_new":
                            m = obj.get("message", {})
                            ref = m.get("ref")
                            uid = m.get("from_id")
                        if ref:
                            inv = storage.find_by_owner_key(ref)
                            if inv:
                                storage.update_invitation(
                                    inv["code"],
                                    lambda i: i["channels"].setdefault("vk", {}).update({"user_id": uid, "linked": True}),
                                )
            except Exception:
                time.sleep(5)


# ---------------------------------------------------------------- Web Push (works locally, no third party besides browser push service)
class WebPush:
    key = "push"
    label = "Пуш на телефон"

    @staticmethod
    def available():
        return True

    @staticmethod
    def keys():
        k = storage.meta_get("vapid")
        if not k:
            from py_vapid import Vapid
            from py_vapid.utils import b64urlencode
            from cryptography.hazmat.primitives import serialization
            v = Vapid()
            v.generate_keys()
            priv = v.private_key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
            ).decode()
            pub_raw = v.public_key.public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
            k = {"private_pem": priv, "public": b64urlencode(pub_raw)}
            storage.meta_set("vapid", k)
        return k

    @staticmethod
    def send(inv, text, extra):
        subs = inv["channels"].get("push", {}).get("subscriptions", [])
        if not subs:
            return False, "уведомления не включены"
        from pywebpush import webpush, WebPushException
        k = WebPush.keys()
        payload = json.dumps({"title": extra.get("subject", "Только Да"), "body": text, "url": extra.get("url", "/")})
        ok, notes = 0, []
        for s in subs:
            try:
                webpush(
                    subscription_info=s,
                    data=payload,
                    vapid_private_key=k["private_pem"],
                    vapid_claims={"sub": os.environ.get("VAPID_SUB", "mailto:hello@example.com")},
                    ttl=3600,
                )
                ok += 1
            except WebPushException as e:
                notes.append(str(e)[:80])
            except Exception as e:  # noqa
                notes.append(str(e)[:80])
        return ok > 0, f"отправлено на {ok} из {len(subs)}" + (f" ({'; '.join(notes)})" if notes else "")


CHANNELS = {c.key: c for c in (Email, Telegram, Max, VK, WebPush)}


def describe():
    """What the front-end needs to render the channel picker."""
    return {
        "email": {"label": Email.label, "configured": Email.available()},
        "telegram": {"label": Telegram.label, "configured": Telegram.available(), "bot": Telegram.bot_username()},
        "max": {"label": Max.label, "configured": Max.available(), "bot": os.environ.get("MAX_BOT_USERNAME", "")},
        "vk": {"label": VK.label, "configured": VK.available(), "group": os.environ.get("VK_GROUP_SCREEN_NAME", "")},
        "push": {"label": WebPush.label, "configured": True, "vapid_public": WebPush.keys()["public"]},
    }


def notify(inv, text, extra=None):
    """Fan out to every channel the sender selected. Returns list of (channel, ok, note)."""
    extra = extra or {}
    results = []
    for key, cfg in inv["channels"].items():
        ch = CHANNELS.get(key)
        if not ch or not cfg or not cfg.get("enabled", True):
            continue
        ok, note = ch.send(inv, text, extra)
        results.append({"channel": key, "ok": ok, "note": note, "at": time.time()})
    if results:
        storage.update_invitation(inv["code"], lambda i: i["notify_log"].extend(results))
    return results


def start_pollers():
    for fn in (Telegram.poll_loop, Max.poll_loop, VK.poll_loop):
        threading.Thread(target=fn, daemon=True).start()
