/**
 * Main site interactions
 */

// Theme management
function getTheme() {
  return localStorage.getItem('theme') || 'dark';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  // Dispatch event for fluid simulation to listen to
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

// Initialize theme
setTheme(getTheme());

document.addEventListener('DOMContentLoaded', () => {
  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = getTheme();
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  // Smooth scroll for navigation links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // Navbar background on scroll
  const nav = document.querySelector('.nav-glass');

  function updateNavBackground() {
    const currentScroll = window.pageYOffset;
    const theme = getTheme();

    if (theme === 'light') {
      nav.style.background = currentScroll > 50
        ? 'rgba(255, 255, 255, 0.8)'
        : 'rgba(255, 255, 255, 0.6)';
    } else {
      nav.style.background = currentScroll > 50
        ? 'rgba(255, 255, 255, 0.1)'
        : 'rgba(255, 255, 255, 0.06)';
    }
  }

  window.addEventListener('scroll', updateNavBackground);
  window.addEventListener('themechange', updateNavBackground);

  // Intersection Observer for fade-in animations
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // Observe timeline items and stack tiles
  document.querySelectorAll('.timeline-item, .stack-tile').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });

  // Stagger animation delays for stack tiles
  document.querySelectorAll('.stack-category').forEach(category => {
    const tiles = category.querySelectorAll('.stack-tile');
    tiles.forEach((tile, index) => {
      tile.style.transitionDelay = `${index * 0.05}s`;
    });
  });

  // Stagger animation delays for timeline items
  document.querySelectorAll('.timeline-item').forEach((item, index) => {
    item.style.transitionDelay = `${index * 0.1}s`;
  });
});
