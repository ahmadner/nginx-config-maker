// Applies the saved light/dark choice before the page draws, so it does not flash.
(function () {
  try {
    var prefs = JSON.parse(localStorage.getItem('nginx-config-generator.prefs.v1') || '{}');
    if (prefs && (prefs.theme === 'light' || prefs.theme === 'dark')) document.documentElement.dataset.theme = prefs.theme;
  } catch (e) {
    // Storage unavailable: follow the system setting.
  }
}());
