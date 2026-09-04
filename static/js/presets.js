/* Поводы, темы, стикеры и тексты по умолчанию */
(function () {
  const themes = [
    { id: "rose", label: "Розовая нежность", sw: "linear-gradient(135deg,#FFDCE7,#E0326E)" },
    { id: "lavender", label: "Лавандовый вечер", sw: "linear-gradient(135deg,#E6DBFF,#7B5BD6)" },
    { id: "peach", label: "Персиковый закат", sw: "linear-gradient(135deg,#FFD9C2,#F0653A)" },
    { id: "night", label: "Ночное свидание", sw: "linear-gradient(135deg,#2A1E4A,#FF5C8A)" },
  ];
  const S = (n) => `/static/stickers/${n}.svg`;
  const stickers = {
    yesno: [S("bear"), S("hearts"), S("rose"), S("puppy"), S("envelope")],
    message: [S("pup-hearts"), S("blush"), S("party"), S("heart-eyes")],
    datetime: [S("ufo"), S("calendar"), S("clock"), S("moon")],
    choice: [S("hearts"), S("popcorn"), S("compass"), S("party")],
    final: [S("ufo-hearts"), S("ring"), S("champagne"), S("confetti")],
  };
  const options = [
    { emoji: "🍕", label: "Пицца" }, { emoji: "🍣", label: "Суши" }, { emoji: "🍔", label: "Бургеры" },
    { emoji: "🎬", label: "Кино" }, { emoji: "🌃", label: "Прогулка" }, { emoji: "🎳", label: "Боулинг" },
  ];
  const occasions = [
    { id: "first", emoji: "💌", label: "Первое свидание", t: { title: "Пойдёшь со мной на свидание?", yes: "Да, конечно", no: "Нет", m: "Так и знал 😌", ms: "Осталось выбрать, когда и куда", mb: "Выбираем" } },
    { id: "anniv", emoji: "❤️", label: "Годовщина", t: { title: "Отметим нашу дату вдвоём?", yes: "Конечно, да", no: "Нет", m: "Ни секунды не сомневался ❤️", ms: "Теперь самое приятное: планы", mb: "К планам" } },
    { id: "sorry", emoji: "🕊", label: "Прости меня", t: { title: "Прости меня. Дашь шанс всё исправить?", yes: "Дам", no: "Нет", m: "Спасибо. Я не подведу", ms: "Давай встретимся и поговорим", mb: "Давай" } },
    { id: "miss", emoji: "✨", label: "Соскучился", t: { title: "Я соскучился. Увидимся?", yes: "Увидимся", no: "Нет", m: "Ура! Уже считаю часы", ms: "Скажи, когда тебе удобно", mb: "Выбрать" } },
    { id: "special", emoji: "🎂", label: "Особенный повод", t: { title: "У меня для тебя сюрприз. Пойдёшь?", yes: "Пойду", no: "Нет", m: "Отлично! Будет здорово", ms: "Выберем время и место", mb: "Дальше" } },
  ];
  function build(occ, theme) {
    const o = occasions.find((x) => x.id === occ) || occasions[0];
    return {
      scenario: "date", occasion: o.id, theme: theme || "rose",
      blocks: [
        { type: "yesno", sticker: stickers.yesno[0], title: o.t.title, yes: o.t.yes, no: o.t.no },
        { type: "message", sticker: stickers.message[0], title: o.t.m, subtitle: o.t.ms, button: o.t.mb },
        { type: "datetime", sticker: stickers.datetime[0], title: "Когда тебе удобно?", button: "Выбрать 💗" },
        { type: "choice", sticker: stickers.choice[0], title: "Чем займёмся?", subtitle: "Выбери, чего хочется больше всего", options: options.map((x) => ({ ...x })) },
        { type: "final", sticker: stickers.final[0], title: "Договорились!", description: "{date} в {time}. В планах: {choice}. Уже жду." },
      ],
    };
  }
  window.TolkoPresets = { themes, stickers, occasions, build };
})();
