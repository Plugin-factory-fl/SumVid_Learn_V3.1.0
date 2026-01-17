/**
 * Premium Manager Module
 * Handles premium user status checking and UI element visibility
 */

(function() {
  'use strict';

  class PremiumManager {
    constructor() {
      this.isPremium = false;
      this.checked = false;
    }

    async checkPremiumStatus() {
      try {
        const BACKEND_URL = 'https://sumvid-learn-backend.onrender.com';
        const stored = await chrome.storage.local.get(['sumvid_auth_token']);
        const token = stored.sumvid_auth_token;
        
        if (!token) {
          this.isPremium = false;
          this.checked = true;
          return false;
        }
        
        const response = await fetch(`${BACKEND_URL}/api/user/profile`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const profileData = await response.json();
          const userProfile = profileData.user || profileData;
          const subscriptionStatus = userProfile.subscription_status || 'freemium';
          this.isPremium = subscriptionStatus === 'premium';
        } else {
          this.isPremium = false;
        }
        
        this.checked = true;
        return this.isPremium;
      } catch (error) {
        console.warn('[PremiumManager] Failed to check premium status:', error);
        this.isPremium = false;
        this.checked = true;
        return false;
      }
    }

    async updateUIForPremium() {
      const isPremium = await this.checkPremiumStatus();
      
      // Hide usage badges
      const usageBadges = document.querySelectorAll('.usage-badge');
      usageBadges.forEach(badge => {
        if (isPremium) {
          badge.style.display = 'none';
        } else {
          badge.style.display = '';
        }
      });
      
      // Hide pro-section footer (uses counter and Get Pro button)
      const proSection = document.querySelector('.pro-section');
      if (proSection) {
        if (isPremium) {
          proSection.style.setProperty('display', 'none', 'important');
        } else {
          proSection.style.removeProperty('display');
        }
      }
      
      // Hide "Enhancements used" card in account dialog
      const enhancementsCard = document.getElementById('account-enhancements-used-card');
      if (enhancementsCard) {
        if (isPremium) {
          enhancementsCard.style.display = 'none';
        } else {
          enhancementsCard.style.display = '';
        }
      }
      
      // Hide "UPGRADE TO PRO" button in account dialog
      const upgradeButton = document.getElementById('upgrade-button');
      if (upgradeButton) {
        if (isPremium) {
          upgradeButton.style.display = 'none';
        } else {
          upgradeButton.style.display = '';
        }
      }
      
      // Hide "Upgrade to Pro" description text in account dialog
      const planDescription = document.querySelector('.account__plan-description');
      if (planDescription) {
        if (isPremium) {
          planDescription.style.display = 'none';
        } else {
          planDescription.style.display = '';
        }
      }
      
      // Remove usage cost text from section info dialogs for premium
      if (isPremium) {
        // Summary info dialog
        const summaryInfoText = document.querySelector('#summary-info-dialog .section-info-text');
        if (summaryInfoText) {
          summaryInfoText.textContent = summaryInfoText.textContent.replace(/ This feature costs \d+ use per [^.]+\./g, '');
        }
        
        // Flashcard info dialog
        const flashcardInfoText = document.querySelector('#flashcard-info-dialog .section-info-text');
        if (flashcardInfoText) {
          flashcardInfoText.textContent = flashcardInfoText.textContent.replace(/ This feature costs \d+ use per [^.]+\./g, '');
        }
        
        // Quiz info dialog
        const quizInfoText = document.querySelector('#quiz-info-dialog .section-info-text');
        if (quizInfoText) {
          quizInfoText.textContent = quizInfoText.textContent.replace(/ This feature costs \d+ use per [^.]+\./g, '');
        }
      }
      
      return isPremium;
    }

    getIsPremium() {
      return this.isPremium;
    }

    hasChecked() {
      return this.checked;
    }
  }

  // Export to global scope
  window.PremiumManager = PremiumManager;
  
  // Create singleton instance
  window.premiumManager = new PremiumManager();
})();
