document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', links.classList.contains('open'));
    });
    links.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => links.classList.remove('open'));
    });
  }

  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    const revealAll = () => revealEls.forEach((el) => el.classList.add('in-view'));
    // Some mobile/in-app browsers (e.g. WebViews opened from social apps)
    // never fire an IntersectionObserver callback, which would otherwise
    // leave this content stuck at opacity:0 forever. Fall back to showing
    // everything after a short delay so a broken observer never hides content.
    const fallback = window.setTimeout(revealAll, 1500);
    if ('IntersectionObserver' in window) {
      try {
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                observer.unobserve(entry.target);
              }
            });
          },
          { threshold: 0.15 }
        );
        revealEls.forEach((el) => observer.observe(el));
      } catch (err) {
        window.clearTimeout(fallback);
        revealAll();
      }
    } else {
      window.clearTimeout(fallback);
      revealAll();
    }
  }

  const yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
