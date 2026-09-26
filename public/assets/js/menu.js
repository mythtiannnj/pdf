(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const hamburger = document.getElementById('hamburger-btn');
    const drawer = document.getElementById('drawer');
    const overlay = document.getElementById('drawer-overlay');
    const closeBtn = document.getElementById('drawer-close');
    if (!hamburger || !drawer) return;

    function open() {
      drawer.classList.add('open');
      overlay.classList.add('open');
      hamburger.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
      hamburger.classList.remove('active');
      document.body.style.overflow = '';
    }
    hamburger.addEventListener('click', () => {
      drawer.classList.contains('open') ? close() : open();
    });
    overlay.addEventListener('click', close);
    if (closeBtn) closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  });
})();