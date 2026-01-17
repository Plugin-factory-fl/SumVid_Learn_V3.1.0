/**
 * Flashcard UI Controller Module
 * Handles flashcard UI initialization and rendering
 */

(function() {
  'use strict';

  class FlashcardUIController {
    constructor(options = {}) {
      this.flashcardContainer = options.flashcardContainer;
      this.flashcardContent = options.flashcardContent;
      this.flashcardList = options.flashcardList;
      this.flashcardEmpty = options.flashcardEmpty;
      this.currentFlashcardSet = null;
      this.currentFlashcardIndex = 0;
    }

    async initializeFlashcardUI() {
      const generateFlashcardButton = document.getElementById('generate-flashcard-button');
      
      if (!this.flashcardContainer || !generateFlashcardButton) {
        console.warn('[Eureka AI] Flashcard UI elements not found');
        return;
      }
      
      generateFlashcardButton.addEventListener('click', async () => {
        await this.handleGenerateFlashcards();
      });
      
      await this.renderFlashcards();
    }

    async handleGenerateFlashcards() {
      const generateButton = document.getElementById('generate-flashcard-button');
      if (!generateButton || !window.SumVidFlashcardMaker) return;
      
      const stored = await chrome.storage.local.get(['currentContentInfo', 'currentVideoInfo']);
      const contentInfo = stored.currentContentInfo || stored.currentVideoInfo;
      
      if (!contentInfo) {
        alert('No content available to generate flashcards from.');
        return;
      }
      
      const contentType = contentInfo.type || 'video';
      const contentText = contentType === 'video' 
        ? (contentInfo.transcript || '')
        : (contentInfo.text || '');
      
      if (!contentText || contentText.length < 50) {
        alert('Content is too short to generate flashcards. Please ensure you have a summary or transcript available.');
        return;
      }
      
      if (window.usageManager) {
        const limitReached = await window.usageManager.checkUsageLimit();
        if (limitReached) {
          alert('Daily enhancement limit reached. Your limit will reset tomorrow.');
          return;
        }
      }
      
      generateButton.disabled = true;
      generateButton.textContent = 'Generating...';
      
      if (this.flashcardContent) {
        this.flashcardContent.classList.remove('collapsed', 'hidden');
        // Don't set inline display - let CSS and TabManager handle visibility
        if (this.flashcardList) {
          this.flashcardList.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-secondary);">Generating flashcards...</p>';
        }
      }
      if (this.flashcardContainer) {
        this.flashcardContainer.classList.remove('hidden');
      }
      
      try {
        const message = {
          action: 'generate-flashcards',
          contentType: contentType,
          title: contentInfo.title || (contentType === 'video' ? 'unknown video' : contentType === 'pdf' ? 'unknown document' : 'unknown page')
        };
        
        if (contentType === 'video') {
          message.transcript = contentText;
        } else {
          message.text = contentText;
        }
        
        const response = await chrome.runtime.sendMessage(message);
        
        if (response?.error) {
          alert(response.error);
          if (this.flashcardList) {
            this.flashcardList.innerHTML = `<p style="text-align: center; padding: 20px; color: #e74c3c;">Failed to generate flashcards: ${response.error}</p>`;
          }
        } else if (response?.success && response?.flashcards) {
          const setTitle = `${contentInfo.title || 'Untitled'} - Flashcards`;
          await window.SumVidFlashcardMaker.createFlashcardSet(setTitle, response.flashcards);
          await this.renderFlashcards();
          if (this.flashcardContent) {
            this.flashcardContent.classList.remove('collapsed', 'hidden');
            // Don't set inline display - let CSS and TabManager handle visibility
          }
        }
        
        if (window.usageManager) {
          await window.usageManager.updateStatusCards();
        }
      } catch (error) {
        console.error('[Eureka AI] Flashcard generation error:', error);
        alert('Failed to generate flashcards. Please try again.');
        if (this.flashcardList) {
          this.flashcardList.innerHTML = '<p style="text-align: center; padding: 20px; color: #e74c3c;">Failed to generate flashcards.</p>';
        }
      } finally {
        generateButton.disabled = false;
        generateButton.textContent = 'Generate Flashcards';
      }
    }
  
    async renderFlashcards() {
      console.log('[FlashcardUIController] renderFlashcards called');
      
      // CRITICAL: Ensure parent #video-info is visible before rendering
      const videoInfo = document.getElementById('video-info');
      if (videoInfo && videoInfo.classList.contains('hidden')) {
        console.warn('[FlashcardUIController] video-info has hidden class, removing it');
        videoInfo.classList.remove('hidden');
        videoInfo.style.setProperty('display', 'flex', 'important');
        videoInfo.style.setProperty('visibility', 'visible', 'important');
        videoInfo.style.setProperty('opacity', '1', 'important');
      }
      
      // ALWAYS re-find elements to ensure they exist
      this.flashcardList = document.getElementById('flashcard-list');
      this.flashcardEmpty = document.getElementById('flashcard-empty');
      this.flashcardContent = document.getElementById('flashcard-content');
      this.flashcardContainer = document.getElementById('flashcard-container');
      
      console.log('[FlashcardUIController] Elements found:', {
        list: !!this.flashcardList,
        empty: !!this.flashcardEmpty,
        content: !!this.flashcardContent,
        container: !!this.flashcardContainer
      });
      
      if (!window.SumVidFlashcardMaker) {
        console.error('[FlashcardUIController] SumVidFlashcardMaker not available');
        if (this.flashcardEmpty) {
          this.flashcardEmpty.classList.remove('hidden');
        }
        if (this.flashcardList) {
          this.flashcardList.classList.add('hidden');
        }
        return;
      }
      
      if (!this.flashcardList || !this.flashcardEmpty) {
        console.error('[FlashcardUIController] Missing required elements');
        return;
      }
      
      // Load flashcards
      await window.SumVidFlashcardMaker.loadFlashcards();
      const sets = window.SumVidFlashcardMaker.getAllFlashcards();
      console.log('[FlashcardUIController] Loaded flashcard sets:', sets.length);
      
      // Get current content title
      const stored = await chrome.storage.local.get(['currentContentInfo', 'currentVideoInfo']);
      const contentInfo = stored.currentContentInfo || stored.currentVideoInfo;
      const currentTitle = contentInfo?.title || '';
      console.log('[FlashcardUIController] Current content title:', currentTitle);
      
      // ALWAYS show the most recent set if sets exist
      let relevantSets = [];
      if (sets.length > 0) {
        // Try to find matching sets first if we have a title
        if (currentTitle) {
          relevantSets = sets.filter(set => {
            const setTitleLower = (set.title || '').toLowerCase();
            const currentTitleLower = currentTitle.toLowerCase();
            return setTitleLower.includes(currentTitleLower) || currentTitleLower.includes(setTitleLower);
          });
        }
        // ALWAYS show most recent set if no matches
        if (relevantSets.length === 0) {
          console.log('[FlashcardUIController] No matching sets, using most recent set');
          relevantSets = [sets[sets.length - 1]];
        }
      }
      
      console.log('[FlashcardUIController] Relevant sets:', relevantSets.length, 'Total sets:', sets.length);
      
      // Force content visibility - remove inline styles and classes
      if (this.flashcardContent) {
        this.flashcardContent.style.removeProperty('display');
        this.flashcardContent.style.removeProperty('visibility');
        this.flashcardContent.classList.remove('collapsed', 'hidden');
      }
      if (this.flashcardContainer) {
        this.flashcardContainer.style.removeProperty('display');
        this.flashcardContainer.classList.remove('collapsed', 'hidden');
      }
      
      if (relevantSets.length === 0) {
        console.log('[FlashcardUIController] No sets available, showing empty state');
        
        // Remove conflicting inline styles - CSS will handle visibility when tab is active
        if (this.flashcardContent) {
          this.flashcardContent.style.removeProperty('display');
          this.flashcardContent.style.removeProperty('visibility');
          this.flashcardContent.style.removeProperty('opacity');
          this.flashcardContent.classList.remove('collapsed', 'hidden');
        }
        
        if (this.flashcardList) {
          this.flashcardList.innerHTML = '';
          this.flashcardList.classList.add('hidden');
        }
        if (this.flashcardEmpty) {
          this.flashcardEmpty.classList.remove('hidden');
        }
        this.currentFlashcardSet = null;
        this.currentFlashcardIndex = 0;
      } else {
        console.log('[FlashcardUIController] Rendering set:', relevantSets[0].title);
        if (this.flashcardEmpty) {
          this.flashcardEmpty.classList.add('hidden');
          this.flashcardEmpty.style.display = 'none'; // Force hide with inline style
          this.flashcardEmpty.style.visibility = 'hidden';
          this.flashcardEmpty.style.opacity = '0';
        }
        if (this.flashcardList) {
          this.flashcardList.classList.remove('hidden');
        }
        
        this.currentFlashcardSet = relevantSets[0];
        this.currentFlashcardIndex = 0;
        
        console.log('[FlashcardUIController] About to render slideshow, set has', this.currentFlashcardSet.cards?.length || 0, 'cards');
        
        // Force render immediately
        setTimeout(() => {
          this.renderFlashcardSlideshow();
        }, 0);
      }
    }
  
    renderFlashcardSlideshow() {
      console.log('[FlashcardUIController] renderFlashcardSlideshow called');
      console.log('[FlashcardUIController] currentFlashcardSet:', this.currentFlashcardSet);
      console.log('[FlashcardUIController] flashcardList:', this.flashcardList);
      
      if (!this.currentFlashcardSet || !this.flashcardList) {
        console.warn('[FlashcardUIController] Missing currentFlashcardSet or flashcardList');
        return;
      }
      
      // Force visibility - remove inline styles
      this.flashcardList.classList.remove('hidden');
      this.flashcardList.style.removeProperty('display');
      this.flashcardList.style.removeProperty('visibility');
      
      const cards = this.currentFlashcardSet.cards || [];
      const cardsToShow = cards.slice(0, 10);
      console.log('[FlashcardUIController] Cards to display:', cardsToShow.length, 'out of', cards.length);
      
      if (cardsToShow.length === 0) {
        console.log('[FlashcardUIController] No cards, showing empty message');
        this.flashcardList.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-secondary);">No flashcards available in this set.</p>';
        return;
      }
      
      const currentCard = cardsToShow[this.currentFlashcardIndex];
      if (!currentCard) {
        console.warn('[FlashcardUIController] No current card at index:', this.currentFlashcardIndex, 'resetting to 0');
        this.currentFlashcardIndex = 0;
        if (cardsToShow.length > 0) {
          return this.renderFlashcardSlideshow(); // Retry with index 0
        }
        return;
      }
      
      console.log('[FlashcardUIController] Rendering card:', currentCard);
      
      // Ensure empty state is hidden when cards are shown
      if (this.flashcardEmpty) {
        this.flashcardEmpty.classList.add('hidden');
        this.flashcardEmpty.style.display = 'none'; // Force hide with inline style
        this.flashcardEmpty.style.visibility = 'hidden';
        this.flashcardEmpty.style.opacity = '0';
      }
      
      // Clear list first and force visibility - remove inline styles
      this.flashcardList.innerHTML = '';
      this.flashcardList.style.removeProperty('display');
      this.flashcardList.style.removeProperty('visibility');
      this.flashcardList.style.removeProperty('opacity');
      this.flashcardList.classList.remove('hidden');
      
      const cardElement = document.createElement('div');
      cardElement.className = 'flashcard-item';
      const frontText = currentCard.front || currentCard.question || 'Front';
      const backText = currentCard.back || currentCard.answer || 'Back';
      cardElement.innerHTML = `
        <div class="flashcard-item__inner">
          <div class="flashcard-item__front">
            <div class="flashcard-item__text">${frontText}</div>
          </div>
          <div class="flashcard-item__back">
            <div class="flashcard-item__text">${backText}</div>
          </div>
        </div>
      `;
      
      // Track if card is flipped
      let isFlipped = false;
      
      cardElement.addEventListener('click', () => {
        if (!isFlipped) {
          // First click: Flip the card
          cardElement.classList.add('flipped');
          isFlipped = true;
        } else {
          // Second click: Advance to next card, looping infinitely
          this.currentFlashcardIndex++;
          // Loop back to start when reaching the end
          if (this.currentFlashcardIndex >= cardsToShow.length) {
            this.currentFlashcardIndex = 0;
          }
          this.renderFlashcardSlideshow();
        }
      });
      
      this.flashcardList.appendChild(cardElement);
      console.log('[FlashcardUIController] Card element added to list, list children:', this.flashcardList.children.length);
      
      // Navigation buttons
      const navContainer = document.createElement('div');
      navContainer.className = 'flashcard-nav';
      navContainer.innerHTML = `
        <button class="flashcard-nav-btn" id="flashcard-prev" ${this.currentFlashcardIndex === 0 ? 'disabled' : ''}>←</button>
        <span class="flashcard-counter">${this.currentFlashcardIndex + 1}/${cardsToShow.length}</span>
        <button class="flashcard-nav-btn" id="flashcard-next" ${this.currentFlashcardIndex === cardsToShow.length - 1 ? 'disabled' : ''}>→</button>
      `;
      
      const prevBtn = navContainer.querySelector('#flashcard-prev');
      const nextBtn = navContainer.querySelector('#flashcard-next');
      
      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          if (this.currentFlashcardIndex > 0) {
            this.currentFlashcardIndex--;
            this.renderFlashcardSlideshow();
          }
        });
      }
      
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (this.currentFlashcardIndex < cardsToShow.length - 1) {
            this.currentFlashcardIndex++;
            this.renderFlashcardSlideshow();
          }
        });
      }
      
      this.flashcardList.appendChild(navContainer);
    }
  }

  // Export to global scope
  window.FlashcardUIController = FlashcardUIController;
})();
