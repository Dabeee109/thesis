/**
 * Diner's Cafe Smart App Installation Banner
 * Cross-platform PWA auto-installer with device detection for Android, iOS, & Tablets.
 */

(function () {
  // 1. Check if already running in standalone PWA / Native App mode
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true ||
                       document.referrer.includes('android-app://');

  if (isStandalone) {
    return; // Already running as installed app, no banner needed
  }

  // 2. Check dismissal cooldown (dismissed in the past 24 hours)
  const DISMISS_KEY = 'diners_app_banner_dismissed_until';
  const dismissedUntil = localStorage.getItem(DISMISS_KEY);
  if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
    return;
  }

  // 3. Keep reference to deferred install prompt
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // 4. Inject styles for the floating banner
  const style = document.createElement('style');
  style.id = 'diners-app-banner-styles';
  style.textContent = `
    .diners-floating-banner {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: calc(100% - 32px);
      max-width: 520px;
      background: rgba(24, 18, 13, 0.94);
      border: 1px solid rgba(212, 163, 115, 0.4);
      border-radius: 16px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      z-index: 99999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: bannerSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes bannerSlideUp {
      from { transform: translate(-50%, 60px); opacity: 0; }
      to { transform: translate(-50%, 0); opacity: 1; }
    }

    .diners-banner-info {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .diners-banner-logo {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: #241a13;
      border: 1px solid rgba(212, 163, 115, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
      flex-shrink: 0;
    }

    .diners-banner-text {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .diners-banner-text strong {
      font-size: 0.92rem;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .diners-banner-text span {
      font-size: 0.76rem;
      color: #bdae9f;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .diners-banner-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .diners-btn-install {
      background: linear-gradient(135deg, #d4a373 0%, #b07d4f 100%);
      color: #140b07;
      border: none;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 0.84rem;
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
      transition: transform 0.15s ease;
    }

    .diners-btn-install:hover {
      transform: scale(1.03);
    }

    .diners-btn-dismiss {
      background: transparent;
      border: none;
      color: #8c7e72;
      font-size: 1.25rem;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s ease;
    }

    .diners-btn-dismiss:hover {
      color: #fff;
    }

    @media (max-width: 420px) {
      .diners-banner-text span {
        display: none;
      }
    }
  `;
  document.head.appendChild(style);

  // 5. Build and inject the DOM element
  function createBanner() {
    const banner = document.createElement('div');
    banner.id = 'diners-floating-app-banner';
    banner.className = 'diners-floating-banner';
    banner.innerHTML = `
      <div class="diners-banner-info">
        <div class="diners-banner-logo">☕</div>
        <div class="diners-banner-text">
          <strong>Diner's Cafe Mobile App</strong>
          <span>Magaan (~2.8 MB) • Auto-Sync &amp; Real-Time</span>
        </div>
      </div>
      <div class="diners-banner-actions">
        <button id="diners-trigger-install" class="diners-btn-install">Install App</button>
        <button id="diners-dismiss-banner" class="diners-btn-dismiss" title="Dismiss">&times;</button>
      </div>
    `;

    document.body.appendChild(banner);

    // Click handler for Install button
    document.getElementById('diners-trigger-install').addEventListener('click', () => {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choice) => {
          if (choice.outcome === 'accepted') {
            banner.remove();
          }
          deferredPrompt = null;
        });
      } else if (isIOS) {
        window.location.href = '/download.html';
      } else {
        window.location.href = '/download.html';
      }
    });

    // Click handler for Dismiss button (24-hour cooldown)
    document.getElementById('diners-dismiss-banner').addEventListener('click', () => {
      banner.remove();
      const in24Hours = Date.now() + (24 * 60 * 60 * 1000);
      localStorage.setItem(DISMISS_KEY, in24Hours.toString());
    });
  }

  // Inject when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createBanner);
  } else {
    createBanner();
  }
})();
