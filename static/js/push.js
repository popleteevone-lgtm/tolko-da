/* Web Push: регистрация service worker и подписка. Возвращает объект подписки или бросает понятную ошибку. */
window.TolkoPush = {
  supported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; },
  isIOSNotInstalled() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    return ios && !standalone;
  },
  async subscribe(vapidPublic) {
    if (!this.supported()) throw new Error("Этот браузер не умеет пуши");
    if (this.isIOSNotInstalled()) throw new Error("На iPhone сначала добавь сайт на экран «Домой»: Поделиться → На экран «Домой», потом открой оттуда");
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Уведомления запрещены в настройках браузера");
    const key = Uint8Array.from(atob(vapidPublic.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(vapidPublic.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return sub.toJSON();
  },
};
