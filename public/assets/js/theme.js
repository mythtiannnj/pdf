(function () {
  const KEY = 'pdfconverter-theme';
  const DEFAULT = 'dark';
  function getTheme() { return localStorage.getItem(KEY) || DEFAULT; }
  function applyTheme(name) {
    document.body.setAttribute('data-theme', name);
    localStorage.setItem(KEY, name);
    document.querySelectorAll('.theme-toggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === name);
    });
  }
  applyTheme(getTheme());
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.theme-toggle button').forEach(btn => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });
  });
})();