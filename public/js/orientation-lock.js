/**
 * Diner's Cafe - Role-Based Screen Orientation Lock & Rotation Hint System
 * 
 * Target Policies:
 * - Admin / Staff Dashboard: Forces & recommends LANDSCAPE mode for multi-column operations.
 * - Rider Portal: Forces & recommends PORTRAIT mode for mobile delivery navigation.
 */

(function () {
  'use strict';

  // 1. Determine Target Orientation based on Page or User Role
  function getRequiredOrientation() {
    const path = (window.location.pathname || '').toLowerCase();
    const explicitMeta = document.querySelector('meta[name="required-orientation"]');
    if (explicitMeta && explicitMeta.content) {
      return explicitMeta.content.toLowerCase();
    }

    if (path.includes('rider') || path.includes('rider-portal')) {
      return 'portrait';
    }

    try {
      const user = JSON.parse(localStorage.getItem('diners_user') || sessionStorage.getItem('diners_user') || '{}');
      const role = (user.role || '').toLowerCase();
      if (role === 'rider' || role === 'delivery_rider') {
        return 'portrait';
      }
    } catch (e) {}

    return 'landscape'; // Default for Admin / Staff Dashboard
  }

  const targetOrientation = getRequiredOrientation();
  let hintDismissed = false;

  // 2. Screen Orientation API Lock Attempt
  function tryLockOrientation(target) {
    if (window.screen && window.screen.orientation && typeof window.screen.orientation.lock === 'function') {
      window.screen.orientation.lock(target).then(() => {
        console.log(`[Orientation] Screen locked to ${target} mode.`);
      }).catch((err) => {
        // Expected when document is not in fullscreen on standard browsers
        console.log(`[Orientation] Native lock to ${target} deferred:`, err.message);
      });
    }
  }

  // 3. Evaluate whether device is currently in the mismatch orientation
  function isOrientationMismatched() {
    if (hintDismissed) return false;

    const isPortrait = window.matchMedia('(orientation: portrait)').matches || (window.innerHeight > window.innerWidth);
    const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) <= 1024; // Phones, tablets, iPads

    if (!isSmallScreen) return false;

    if (targetOrientation === 'landscape' && isPortrait) {
      return true;
    }

    if (targetOrientation === 'portrait' && !isPortrait) {
      return true;
    }

    return false;
  }

  // 4. Inject or Update the Rotation Hint Overlay
  function updateOrientationOverlay() {
    let overlay = document.getElementById('orientation-hint-overlay');

    if (!isOrientationMismatched()) {
      if (overlay) overlay.style.display = 'none';
      return;
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'orientation-hint-overlay';
      overlay.className = 'orientation-hint-overlay';
      document.body.appendChild(overlay);
    }

    const isLandscapeTarget = targetOrientation === 'landscape';

    overlay.innerHTML = `
      <div class="orientation-hint-backdrop"></div>
      <div class="orientation-hint-card">
        <div class="orientation-hint-icon ${isLandscapeTarget ? 'rotate-to-landscape' : 'rotate-to-portrait'}">
          ${isLandscapeTarget ? '🔄' : '📱'}
        </div>
        <div class="orientation-hint-badge">
          ${isLandscapeTarget ? 'LANDSCAPE MODE REQUIRED' : 'PORTRAIT MODE REQUIRED'}
        </div>
        <h3 class="orientation-hint-title">
          ${isLandscapeTarget ? 'Please Rotate Your Device' : 'Hold Device Upright'}
        </h3>
        <p class="orientation-hint-desc">
          ${isLandscapeTarget
            ? 'The Diner\'s Cafe Operations Dashboard is optimized for multi-column horizontal kanban and wide table management. Rotate your phone or tablet sideways for the optimal operational experience.'
            : 'The Rider Delivery Portal is built for one-handed vertical navigation and map dispatching. Please hold your phone in portrait mode.'}
        </p>
        <div class="orientation-hint-actions">
          <button type="button" class="btn btn-primary orientation-btn-lock" id="btn-orientation-lock-action">
            ${isLandscapeTarget ? '🔄 Rotate Screen & Fullscreen' : '📱 Lock Portrait'}
          </button>
          <button type="button" class="btn btn-secondary orientation-btn-dismiss" id="btn-orientation-dismiss">
            Continue Anyway
          </button>
        </div>
      </div>
    `;

    overlay.style.display = 'flex';

    const lockBtn = document.getElementById('btn-orientation-lock-action');
    if (lockBtn) {
      lockBtn.onclick = function () {
        // Trigger fullscreen if supported then lock
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          docEl.requestFullscreen().then(() => tryLockOrientation(targetOrientation)).catch(() => tryLockOrientation(targetOrientation));
        } else if (docEl.webkitRequestFullscreen) {
          docEl.webkitRequestFullscreen();
          tryLockOrientation(targetOrientation);
        } else {
          tryLockOrientation(targetOrientation);
        }
      };
    }

    const dismissBtn = document.getElementById('btn-orientation-dismiss');
    if (dismissBtn) {
      dismissBtn.onclick = function () {
        hintDismissed = true;
        overlay.style.display = 'none';
      };
    }
  }

  // 5. Inject Overlay Styles
  function injectStyles() {
    if (document.getElementById('orientation-lock-styles')) return;
    const style = document.createElement('style');
    style.id = 'orientation-lock-styles';
    style.textContent = `
      .orientation-hint-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 999999;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
      }
      .orientation-hint-backdrop {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 11, 8, 0.92);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .orientation-hint-card {
        position: relative;
        z-index: 1;
        background: #1f1813;
        border: 1px solid rgba(212, 163, 115, 0.35);
        border-radius: 16px;
        padding: 28px 24px;
        max-width: 420px;
        width: 100%;
        text-align: center;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
        animation: hintPopIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        color: #f7ede2;
      }
      @keyframes hintPopIn {
        from { opacity: 0; transform: scale(0.92); }
        to { opacity: 1; transform: scale(1); }
      }
      .orientation-hint-icon {
        font-size: 3rem;
        margin-bottom: 12px;
        display: inline-block;
      }
      .rotate-to-landscape {
        animation: spinLandscape 2s ease-in-out infinite;
      }
      .rotate-to-portrait {
        animation: spinPortrait 2s ease-in-out infinite;
      }
      @keyframes spinLandscape {
        0% { transform: rotate(0deg); }
        50% { transform: rotate(-90deg); }
        100% { transform: rotate(-90deg); }
      }
      @keyframes spinPortrait {
        0% { transform: rotate(-90deg); }
        50% { transform: rotate(0deg); }
        100% { transform: rotate(0deg); }
      }
      .orientation-hint-badge {
        display: inline-block;
        padding: 4px 10px;
        background: rgba(212, 163, 115, 0.15);
        border: 1px solid #d4a373;
        color: #d4a373;
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.8px;
        border-radius: 999px;
        margin-bottom: 10px;
      }
      .orientation-hint-title {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 10px 0;
        color: #f7ede2;
        font-family: inherit;
      }
      .orientation-hint-desc {
        font-size: 0.88rem;
        line-height: 1.5;
        color: #a89f91;
        margin: 0 0 20px 0;
      }
      .orientation-hint-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .orientation-hint-actions .btn {
        width: 100%;
        padding: 10px 16px;
        font-size: 0.9rem;
        font-weight: 700;
        border-radius: 8px;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  }

  // 6. Setup Listeners
  function init() {
    injectStyles();
    tryLockOrientation(targetOrientation);
    updateOrientationOverlay();

    // Listen to device orientation changes
    window.addEventListener('resize', updateOrientationOverlay);
    window.addEventListener('orientationchange', updateOrientationOverlay);

    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener('change', () => {
        updateOrientationOverlay();
      });
    }

    const portraitQuery = window.matchMedia('(orientation: portrait)');
    if (portraitQuery.addEventListener) {
      portraitQuery.addEventListener('change', updateOrientationOverlay);
    } else if (portraitQuery.addListener) {
      portraitQuery.addListener(updateOrientationOverlay);
    }

    // Try locking on first user tap (browsers allow lock after user gesture)
    const onFirstGesture = () => {
      tryLockOrientation(targetOrientation);
      window.removeEventListener('click', onFirstGesture);
      window.removeEventListener('touchstart', onFirstGesture);
    };
    window.addEventListener('click', onFirstGesture, { once: true });
    window.addEventListener('touchstart', onFirstGesture, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.DinersOrientation = {
    getTarget: () => targetOrientation,
    lock: tryLockOrientation,
    updateOverlay: updateOrientationOverlay
  };
})();
