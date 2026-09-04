"""Tiny JSON-file store. Enough for a prototype, swap for Postgres later."""
import json, os, threading, time, secrets, string

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DATA_DIR, "db.json")
_lock = threading.RLock()
_ALPHABET = string.ascii_lowercase + string.digits

EMPTY = {"invitations": {}, "events": [], "meta": {}}


def _load():
    if not os.path.exists(DB_PATH):
        return json.loads(json.dumps(EMPTY))
    with open(DB_PATH, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return json.loads(json.dumps(EMPTY))


def _save(db):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DB_PATH)


def new_code(n=6):
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


def create_invitation(payload, ttl_days=30):
    with _lock:
        db = _load()
        code = new_code()
        while code in db["invitations"]:
            code = new_code()
        now = time.time()
        inv = {
            "code": code,
            "owner_key": secrets.token_urlsafe(18),
            "created_at": now,
            "expires_at": now + ttl_days * 86400,
            "status": "sent",           # sent -> opened -> answered -> completed
            "channels": payload.get("channels", {}),
            "card": payload["card"],    # scenario, theme, blocks
            "answers": {},              # filled by recipient
            "notify_log": [],           # what we tried to send and how it went
        }
        db["invitations"][code] = inv
        _save(db)
        return inv


def get_invitation(code):
    with _lock:
        return _load()["invitations"].get(code)


def update_invitation(code, mutator):
    """mutator(inv) -> None, applied under lock."""
    with _lock:
        db = _load()
        inv = db["invitations"].get(code)
        if not inv:
            return None
        mutator(inv)
        _save(db)
        return inv


def add_event(code, etype, payload=None):
    with _lock:
        db = _load()
        inv = db["invitations"].get(code)
        if not inv:
            return None
        ev = {"code": code, "type": etype, "payload": payload or {}, "at": time.time()}
        db["events"].append(ev)
        # keep status monotonic
        order = ["sent", "opened", "answered", "completed"]
        target = {"opened": "opened", "answered_yes": "answered", "completed": "completed"}.get(etype)
        if target and order.index(target) > order.index(inv.get("status", "sent")):
            inv["status"] = target
        _save(db)
        return ev


def list_events(code):
    with _lock:
        return [e for e in _load()["events"] if e["code"] == code]


def find_by_owner_key(key):
    with _lock:
        for inv in _load()["invitations"].values():
            if inv["owner_key"] == key:
                return inv
    return None


def meta_get(k, default=None):
    with _lock:
        return _load()["meta"].get(k, default)


def meta_set(k, v):
    with _lock:
        db = _load()
        db["meta"][k] = v
        _save(db)
