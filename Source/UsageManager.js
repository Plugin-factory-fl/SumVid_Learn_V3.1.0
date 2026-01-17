/**
 * Usage Manager Module
 * Handles usage tracking, status cards, and button state management
 */

(function() {
  'use strict';

  class UsageManager {
    constructor(options = {}) {
      this.getProButton = options.getProButton;
      this.getProTexts = ['Get Pro', 'Get unlimited usage'];
      this.getProTextIndex = 0;
      this.getProInterval = null;
      
      this.init();
    }

    init() {
      // Initialize Get Pro button text rotation
      if (this.getProButton) {
        this.getProButton.textContent = this.getProTexts[0];
        this.startGetProTextRotation();
      }
    }

    startGetProTextRotation() {
      if (this.getProInterval || !this.getProButton) return;
      this.getProInterval = setInterval(() => {
        if (this.getProButton) {
          this.getProTextIndex = (this.getProTextIndex + 1) % this.getProTexts.length;
          this.getProButton.textContent = this.getProTexts[this.getProTextIndex];
        }
      }, 3500);
    }

    updateUsesCounter(usage, subscriptionStatus) {
      try {
        const usesCounter = document.getElementById('uses-counter');
        const usesRemainingText = document.getElementById('uses-remaining-text');
        const proSection = document.querySelector('.pro-section');
        
        if (!usesCounter || !usesRemainingText) return;

        if (subscriptionStatus === 'premium') {
          usesCounter.style.display = 'none';
          // Hide entire pro-section footer for premium users - use !important to override CSS
          if (proSection) {
            proSection.style.setProperty('display', 'none', 'important');
          }
          return;
        }
        
        // Show pro-section for freemium users
        if (proSection) {
          proSection.style.removeProperty('display');
        }

        if (!usage) {
          usesCounter.style.display = 'none';
          return;
        }

        const remaining = Math.max(0, (usage.enhancementsLimit || 0) - (usage.enhancementsUsed || 0));
        usesRemainingText.textContent = `${remaining} uses remaining`;
        usesCounter.style.display = 'block';
      } catch (e) {
        console.warn('[Eureka AI] Failed to update uses counter:', e);
      }
    }

    async updateStatusCards() {
      const enhancementsCountEl = document.getElementById('account-enhancements-count');
      const enhancementsLimitEl = document.getElementById('account-enhancements-limit');
      const userStatusEl = document.getElementById('account-user-status');
      const userPlanEl = document.getElementById('account-user-plan');
      
      try {
        const BACKEND_URL = 'https://sumvid-learn-backend.onrender.com';
        let usage = null;
        
        try {
          const stored = await chrome.storage.local.get(['sumvid_auth_token']);
          const token = stored.sumvid_auth_token;
          
          if (token) {
            const response = await fetch(`${BACKEND_URL}/api/user/usage`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });
            
            if (response.ok) {
              const data = await response.json();
              usage = {
                enhancementsUsed: data.enhancementsUsed || 0,
                enhancementsLimit: data.enhancementsLimit || 10
              };
            }
          }
        } catch (error) {
          console.warn('[Eureka AI] Failed to get usage from backend:', error);
        }
        
        // Fallback to local storage
        if (!usage && window.UsageTracker) {
          await window.UsageTracker.resetDailyUsageIfNeeded();
          const localUsage = await window.UsageTracker.getUsage();
          usage = {
            enhancementsUsed: localUsage.enhancementsUsed,
            enhancementsLimit: localUsage.enhancementsLimit
          };
        }
        
        // Default values
        if (!usage) {
          usage = {
            enhancementsUsed: 0,
            enhancementsLimit: 10
          };
        }
        
        if (enhancementsCountEl) enhancementsCountEl.textContent = usage.enhancementsUsed;
        if (enhancementsLimitEl) enhancementsLimitEl.textContent = usage.enhancementsLimit;
        
        // Update user status and plan
        const storedToken = await chrome.storage.local.get(['sumvid_auth_token']);
        const authToken = storedToken.sumvid_auth_token;
        let subscriptionStatus = 'freemium';
        
        if (authToken) {
          try {
            const profileResponse = await fetch(`${BACKEND_URL}/api/user/profile`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json',
              },
            });
            
            if (profileResponse.ok) {
              const profileData = await profileResponse.json();
              const userProfile = profileData.user || profileData;
              const displayName = (userProfile.name && userProfile.name.trim()) 
                ? userProfile.name 
                : (userProfile.email || 'User');
              subscriptionStatus = userProfile.subscription_status || 'freemium';
              
              if (userStatusEl) {
                userStatusEl.textContent = displayName;
              }
              if (userPlanEl) {
                userPlanEl.textContent = subscriptionStatus === 'premium' ? 'PRO' : 'Freemium';
              }
            }
          } catch (error) {
            console.warn('[Eureka AI] Failed to get user profile:', error);
          }
        } else {
          if (userStatusEl) {
            userStatusEl.textContent = 'Not Logged In';
          }
          if (userPlanEl) {
            userPlanEl.textContent = 'Freemium';
          }
        }
        
        // Update uses counter
        this.updateUsesCounter(usage, subscriptionStatus);
        
        // Update UI for premium users
        if (window.premiumManager) {
          await window.premiumManager.updateUIForPremium();
        }
        
        // Update button states
        this.updateButtonStates(usage.enhancementsUsed >= usage.enhancementsLimit);
      } catch (error) {
        console.error('Error updating status cards:', error);
        const enhancementsCountEl = document.getElementById('account-enhancements-count');
        const enhancementsLimitEl = document.getElementById('account-enhancements-limit');
        if (enhancementsCountEl) enhancementsCountEl.textContent = '0';
        if (enhancementsLimitEl) enhancementsLimitEl.textContent = '10';
      }
    }

    updateButtonStates(limitReached) {
      const summarizeButton = document.getElementById('summarize-button');
      const makeTestButton = document.getElementById('make-test-button');
      
      if (summarizeButton) {
        summarizeButton.disabled = limitReached;
        if (limitReached) {
          summarizeButton.title = 'Daily limit reached. Reset tomorrow.';
        }
      }
      if (makeTestButton) {
        makeTestButton.disabled = limitReached;
        if (limitReached) {
          makeTestButton.title = 'Daily limit reached. Reset tomorrow.';
        }
      }
    }

    async checkUsageLimit() {
      try {
        const BACKEND_URL = 'https://sumvid-learn-backend.onrender.com';
        const stored = await chrome.storage.local.get(['sumvid_auth_token']);
        const token = stored.sumvid_auth_token;
        
        if (token) {
          const response = await fetch(`${BACKEND_URL}/api/user/usage`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (response.ok) {
            const usage = await response.json();
            return usage.enhancementsUsed >= usage.enhancementsLimit;
          }
        }
      } catch (error) {
        console.warn('[Eureka AI] Failed to check usage limit from backend:', error);
      }
      
      // Fallback to local storage
      if (window.UsageTracker) {
        return await window.UsageTracker.isLimitReached();
      }
      
      return false; // Allow usage on error
    }
  }

  // Export to global scope
  window.UsageManager = UsageManager;
})();
