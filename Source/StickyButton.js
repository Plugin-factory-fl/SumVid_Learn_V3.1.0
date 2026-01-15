/**
 * Sticky Button System for SumVid Learn
 * Creates a draggable sticky button on YouTube pages with auto-toast notification
 */

(function() {
  'use strict';

  const BUTTON_ID = 'eureka-ai-sticky-button';
  const TOAST_ID = 'eureka-ai-sticky-toast';
  const STORAGE_KEY = 'eureka-ai-sticky-button-position';
  const TOAST_STORAGE_KEY = 'eureka-ai-toast-shown';

  let stickyButton = null;
  let toastElement = null;
  let isDragging = false;
  let dragStartTime = 0;
  let dragStartPos = { x: 0, y: 0 };
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let onDragBound = null;
  let onDragEndBound = null;

  /**
   * Creates and initializes the sticky button
   * @param {Object} options - Configuration options
   * @param {string} options.position - Position: 'bottom-right' (default), 'bottom-left', 'top-right', 'top-left'
   * @param {number} options.offsetX - Horizontal offset in pixels (default: 250)
   * @param {number} options.offsetY - Vertical offset in pixels (default: 250)
   */
  async function initStickyButton(options = {}) {
    // Check if feature is enabled in settings
    const result = await chrome.storage.local.get(['stickyButtonEnabled']);
    const stickyButtonEnabled = result.stickyButtonEnabled !== undefined ? result.stickyButtonEnabled : true; // Default ON
    
    if (!stickyButtonEnabled) {
      console.log('[Eureka AI] Sticky button is disabled in settings');
      return null;
    }
    
    if (stickyButton && document.getElementById(BUTTON_ID)) {
      console.log('[SumVid] Sticky button already initialized');
      return stickyButton;
    }

    const position = options.position || 'bottom-right';
    const offsetX = options.offsetX || 250;
    const offsetY = options.offsetY || 250;

    // Ensure styles are loaded
    ensureStyles();

    // Create button element
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'eureka-ai-sticky-button';
    button.setAttribute('aria-label', 'Open Eureka AI side panel');

    // Create icon
    const icon = createButtonIcon();
    button.appendChild(icon);

    // Apply positioning styles
    applyButtonStyles(button, position, offsetX, offsetY);

    // Append to body
    const appendButton = () => {
      document.body.appendChild(button);
      stickyButton = button;

      // Load saved position if available
      loadSavedPosition(button, position, offsetX, offsetY).then(() => {
        // Make button draggable after position is set
        makeButtonDraggable(button);
        // Start periodic toast notifications
        startPeriodicToasts(button);
      });

      console.log('[SumVid] Sticky button initialized and added to page');
    };

    if (!document.body) {
      // Wait for body to be available
      const observer = new MutationObserver((mutations, obs) => {
        if (document.body) {
          appendButton();
          obs.disconnect();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      appendButton();
    }

    return button;
  }

  /**
   * Creates the icon element for the sticky button
   */
  function createButtonIcon() {
    const icon = document.createElement('span');
    icon.className = 'eureka-ai-sticky-button__icon';
    icon.setAttribute('aria-hidden', 'true');

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      const assetUrl = chrome.runtime.getURL('/icons/icon48.png');
      icon.style.backgroundImage = `url('${assetUrl}')`;
      icon.style.backgroundSize = 'contain';
      icon.style.backgroundRepeat = 'no-repeat';
      icon.style.backgroundPosition = 'center';
    }

    return icon;
  }

  /**
   * Applies positioning styles to the button
   */
  function applyButtonStyles(button, position, offsetX, offsetY) {
    const wrapperSize = 55; // 25% larger than base 44px
    const iconSize = 43; // 25% larger than base 34px

    button.style.position = 'fixed';
    button.style.zIndex = '2147483000';
    button.style.width = `${wrapperSize}px`;
    button.style.height = `${wrapperSize}px`;
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.pointerEvents = 'auto';
    button.style.transition = 'transform 120ms ease, box-shadow 120ms ease';

    // Update icon size
    const icon = button.querySelector('.eureka-ai-sticky-button__icon');
    if (icon) {
      icon.style.width = `${iconSize}px`;
      icon.style.height = `${iconSize}px`;
    }

    // Position-specific styles
    switch (position) {
      case 'bottom-right':
        button.style.bottom = `${offsetY}px`;
        button.style.right = `${offsetX}px`;
        button.style.top = 'auto';
        button.style.left = 'auto';
        break;
      case 'bottom-left':
        button.style.bottom = `${offsetY}px`;
        button.style.left = `${offsetX}px`;
        button.style.top = 'auto';
        button.style.right = 'auto';
        break;
      case 'top-right':
        button.style.top = `${offsetY}px`;
        button.style.right = `${offsetX}px`;
        button.style.bottom = 'auto';
        button.style.left = 'auto';
        break;
      case 'top-left':
        button.style.top = `${offsetY}px`;
        button.style.left = `${offsetX}px`;
        button.style.bottom = 'auto';
        button.style.right = 'auto';
        break;
      default:
        button.style.bottom = `${offsetY}px`;
        button.style.right = `${offsetX}px`;
        button.style.top = 'auto';
        button.style.left = 'auto';
    }
  }

  /**
   * Makes the sticky button draggable
   */
  function makeButtonDraggable(button) {
    if (!button) return;

    button.style.cursor = 'grab';

    button.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      dragStartTime = Date.now();
      dragStartPos = { x: e.clientX, y: e.clientY };

      e.preventDefault();
      e.stopPropagation();

      onDragStart(e, button);
    });

    // Add click handler that only fires if it wasn't a drag
    button.addEventListener('click', (e) => {
      if (isDragging) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const dragDistance = Math.sqrt(
        Math.pow(e.clientX - dragStartPos.x, 2) +
        Math.pow(e.clientY - dragStartPos.y, 2)
      );
      const dragDuration = Date.now() - dragStartTime;

      // If mouse moved more than 5px or drag took more than 200ms, it was a drag, not a click
      if (dragDistance > 5 || dragDuration > 200) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // It was a click, not a drag - open sidebar
      toggleSidebar();
    }, true);
  }

  /**
   * Handles drag start
   */
  function onDragStart(e, button) {
    isDragging = true;

    const rect = button.getBoundingClientRect();
    // Convert any right/bottom anchoring into left/top so dragging does not "jump"
    button.style.left = `${Math.round(rect.left)}px`;
    button.style.top = `${Math.round(rect.top)}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';

    // Keep the cursor "grip point" consistent by storing offset within the element
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;

      button.classList.add('eureka-ai-sticky-button--dragging');
    button.style.cursor = 'grabbing';
    button.style.opacity = '0.8';

    onDragBound = onDrag.bind(null, button);
    onDragEndBound = onDragEnd.bind(null, button);

    document.addEventListener('mousemove', onDragBound);
    document.addEventListener('mouseup', onDragEndBound);
  }

  /**
   * Handles drag movement
   */
  function onDrag(button, e) {
    if (!isDragging) return;

    let newX = e.clientX - dragOffsetX;
    let newY = e.clientY - dragOffsetY;

    const buttonRect = button.getBoundingClientRect();
    const buttonWidth = buttonRect.width;
    const buttonHeight = buttonRect.height;

    const minX = 0;
    const minY = 0;
    const maxX = window.innerWidth - buttonWidth;
    const maxY = window.innerHeight - buttonHeight;

    newX = Math.max(minX, Math.min(maxX, newX));
    newY = Math.max(minY, Math.min(maxY, newY));

    button.style.left = `${Math.round(newX)}px`;
    button.style.top = `${Math.round(newY)}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  }

  /**
   * Handles drag end
   */
  function onDragEnd(button, e) {
    if (!isDragging) return;

    isDragging = false;

    button.classList.remove('eureka-ai-sticky-button--dragging');
    button.style.cursor = 'grab';
    button.style.opacity = '1';

    if (onDragBound) {
      document.removeEventListener('mousemove', onDragBound);
      onDragBound = null;
    }
    if (onDragEndBound) {
      document.removeEventListener('mouseup', onDragEndBound);
      onDragEndBound = null;
    }

    // Get final position and save
    const rect = button.getBoundingClientRect();
    const finalX = window.innerWidth - rect.right;
    const finalY = window.innerHeight - rect.bottom;

    saveButtonPosition(finalX, finalY);
  }

  /**
   * Saves sticky button position to Chrome storage
   */
  function saveButtonPosition(x, y) {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      console.warn('[SumVid] Chrome storage not available, cannot save button position');
      return;
    }

    chrome.storage.local.set({
      [STORAGE_KEY]: { x, y }
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[SumVid] Failed to save button position:', chrome.runtime.lastError);
      } else {
        console.log('[SumVid] Button position saved:', { x, y });
      }
    });
  }

  /**
   * Loads sticky button position from Chrome storage
   */
  function loadSavedPosition(button, defaultPosition, defaultOffsetX, defaultOffsetY) {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          console.error('[SumVid] Failed to load button position:', chrome.runtime.lastError);
          resolve();
          return;
        }

        const savedPosition = result[STORAGE_KEY];
        if (savedPosition && typeof savedPosition.x === 'number' && typeof savedPosition.y === 'number') {
          button.style.left = 'auto';
          button.style.top = 'auto';
          button.style.right = `${savedPosition.x}px`;
          button.style.bottom = `${savedPosition.y}px`;
          console.log('[SumVid] Loaded saved button position:', savedPosition);
        }
        resolve();
      });
    });
  }

  let toastInterval = null;
  let currentToastMessageIndex = 0;
  const toastMessages = ['Eureka!', 'Click to open sidebar', 'Click and drag me to move me anywhere!'];

  /**
   * Starts periodic toast notifications
   */
  function startPeriodicToasts(button) {
    // Clear any existing interval
    if (toastInterval) {
      clearInterval(toastInterval);
    }

    // Show first toast after 2 seconds
    setTimeout(() => {
      showToast(button);
    }, 2000);

    // Then show every 30 seconds
    toastInterval = setInterval(() => {
      if (button && document.body.contains(button)) {
        showToast(button);
      } else {
        // Button removed, stop interval
        clearInterval(toastInterval);
        toastInterval = null;
      }
    }, 30000); // 30 seconds
  }

  /**
   * Stops periodic toast notifications
   */
  function stopPeriodicToasts() {
    if (toastInterval) {
      clearInterval(toastInterval);
      toastInterval = null;
    }
  }

  /**
   * Shows the toast notification above the button
   */
  function showToast(button) {
    // Remove existing toast if any
    const existingToast = document.getElementById(TOAST_ID);
    if (existingToast) {
      existingToast.remove();
    }

    if (!button) return;

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.className = 'eureka-ai-sticky-toast';
    
    // Alternate between messages
    toast.textContent = toastMessages[currentToastMessageIndex];
    currentToastMessageIndex = (currentToastMessageIndex + 1) % toastMessages.length;

    document.body.appendChild(toast);

    // Position toast above button
    const buttonRect = button.getBoundingClientRect();
    toast.style.left = `${buttonRect.left + (buttonRect.width / 2)}px`;
    toast.style.top = `${buttonRect.top - 50}px`;
    toast.style.transform = 'translateX(-50%) translateY(-4px)';

    // Force reflow and show with animation
    void toast.offsetHeight;
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      dismissToast(toast);
    }, 3000);

    // Dismiss on hover
    toast.addEventListener('mouseenter', () => {
      dismissToast(toast);
    });

    toastElement = toast;
  }

  /**
   * Dismisses the toast notification
   */
  function dismissToast(toast) {
    if (!toast) return;

    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-4px)';
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
      toastElement = null;
    }, 200);
  }

  /**
   * Opens the side panel (called when button is clicked)
   */
  async function toggleSidebar() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        // Send message to open side panel
        await chrome.runtime.sendMessage({ action: 'open-side-panel' });
      } catch (error) {
        console.error('[Eureka AI] Failed to open side panel:', error);
      }
    }
  }

  /**
   * Ensures CSS styles are loaded
   */
  function ensureStyles() {
    if (document.getElementById('sumvid-sticky-button-style')) {
      return;
    }

    if (typeof chrome === 'undefined' || !chrome.runtime) {
      console.error('[SumVid] Chrome runtime not available for StickyButton styles');
      return;
    }

    const link = document.createElement('link');
    link.id = 'eureka-ai-sticky-button-style';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/StickyButton.css');
    document.head.appendChild(link);
  }

  /**
   * Removes the sticky button from the page
   */
  function removeStickyButton() {
    if (stickyButton && stickyButton.parentElement) {
      stickyButton.remove();
    }
    if (toastElement && toastElement.parentElement) {
      toastElement.remove();
    }

    if (onDragBound) {
      document.removeEventListener('mousemove', onDragBound);
      onDragBound = null;
    }
    if (onDragEndBound) {
      document.removeEventListener('mouseup', onDragEndBound);
      onDragEndBound = null;
    }

    stickyButton = null;
    toastElement = null;
    isDragging = false;
  }

  // Export to global scope (do this immediately to avoid timing issues)
  try {
    window.EurekaAIStickyButton = {
      init: initStickyButton,
      remove: removeStickyButton
    };
    console.log('[Eureka AI] StickyButton module exported to window');
  } catch (error) {
    console.error('[Eureka AI] Failed to export StickyButton module:', error);
  }
})();
