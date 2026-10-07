// Darstellung (Dunkel/Hell/wie Gerät) vor dem ersten Zeichnen setzen, damit nichts aufblitzt.
(function () {
  var KEY = "tr-theme", mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  function read() { try { return localStorage.getItem(KEY) || "dark"; } catch (e) { return "dark"; } }
  function apply(t) { var light = t === "light" || (t === "system" && mq && mq.matches); document.documentElement.setAttribute("data-theme", light ? "light" : "dark"); }
  window.trTheme = {
    get: read,
    set: function (t) { try { localStorage.setItem(KEY, t); } catch (e) {} apply(t); },
  };
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { apply(read()); });
  apply(read());
})();
