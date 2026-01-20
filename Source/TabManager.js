/**
 * Tab Manager Module
 * Handles tab switching and content visibility management
 */

(function() {
  'use strict';

  class TabManager {
    constructor(tabButtons, tabContents) {
      this.tabButtons = Array.isArray(tabButtons) ? tabButtons : Array.from(tabButtons || []);
      this.tabContents = Array.isArray(tabContents) ? tabContents : Array.from(tabContents || []);
      this.activeTab = 'chat';
      this.onTabChangeCallbacks = [];
      
      this.init();
    }

    init() {
      // Add event listeners to tab buttons
      this.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.switchTab(btn.dataset.tab);
        });
      });
      
      // Ensure Chat tab is active by default
      this.switchTab('chat');
    }

    async switchTab(tabName) {
      console.log('[TabManager] Switching to tab:', tabName);
      this.activeTab = tabName;
      
      // Update tab buttons
      this.tabButtons.forEach(btn => {
        if (btn.dataset.tab === tabName) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      
      // CRITICAL: Hide ALL tab-content elements first by removing active class
      // CSS .tab-content { display: none !important; } will handle hiding
      this.tabContents.forEach(content => {
        content.classList.remove('active');
        // Remove any inline display styles - let CSS handle it
        content.style.removeProperty('display');
      });
      
      // CRITICAL: Also explicitly hide the summary-container when switching away from summarize tab
      if (tabName !== 'summarize') {
        const summaryContainer = document.getElementById('summary-container');
        if (summaryContainer) {
          summaryContainer.style.setProperty('display', 'none', 'important');
        }
      }
      
      // CRITICAL: Ensure #video-info parent is visible (it might have .hidden class)
      const videoInfo = document.getElementById('video-info');
      if (videoInfo) {
        // Remove hidden class with verification
        videoInfo.classList.remove('hidden');
        
        // Verify it was removed
        if (videoInfo.classList.contains('hidden')) {
          console.error('[TabManager] WARNING: hidden class still present after removal attempt');
          // Force removal via className manipulation as fallback
          videoInfo.className = videoInfo.className.replace(/\bhidden\b/g, '').trim();
        }
        
        // Force visibility with inline style (highest priority)
        videoInfo.style.setProperty('display', 'flex', 'important');
        videoInfo.style.setProperty('visibility', 'visible', 'important');
        videoInfo.style.setProperty('opacity', '1', 'important');
        
        // Verify dimensions after forced visibility
        const videoInfoRect = videoInfo.getBoundingClientRect();
        console.log('[TabManager] video-info rect:', videoInfoRect.width, 'x', videoInfoRect.height);
        if (videoInfoRect.width === 0 || videoInfoRect.height === 0) {
          console.error('[TabManager] ERROR: video-info parent has zero dimensions!');
          // Last resort: force explicit dimensions
          const parentRect = videoInfo.parentElement?.getBoundingClientRect();
          if (parentRect && parentRect.height > 0) {
            videoInfo.style.setProperty('height', parentRect.height + 'px', 'important');
          }
        }
      }
      
      // CRITICAL: Hide all tabs FIRST to prevent flash, then show only active one
      this.tabContents.forEach(tab => {
        if (tab.id !== `tab-${tabName}`) {
          tab.classList.remove('active');
          tab.style.setProperty('display', 'none', 'important');
        }
      });
      
      // Show only the active tab
      const activeTabContent = document.getElementById(`tab-${tabName}`);
      console.log('[TabManager] Active tab content element:', activeTabContent);
      if (activeTabContent) {
        // Add active class FIRST - CSS .tab-content.active { display: flex !important; } will handle showing
        activeTabContent.classList.add('active');
        activeTabContent.style.removeProperty('display'); // Remove the forced hide from above
        // Then remove any conflicting inline display styles AFTER class is added
        // Don't remove display entirely - let CSS handle it via .active class
        
        // CRITICAL: Show summary-container only if summarize tab is active
        // Hide it explicitly when other tabs are active
        const summaryContainer = document.getElementById('summary-container');
        const summarizeTab = document.getElementById('tab-summarize');
        if (tabName === 'summarize' && summaryContainer) {
          // Show summary-container when summarize tab is active
          summaryContainer.style.removeProperty('display');
          summaryContainer.style.removeProperty('visibility');
          summaryContainer.style.removeProperty('opacity');
          summaryContainer.style.removeProperty('height');
        } else if (summaryContainer) {
          // Hide summary-container when any other tab is active
          summaryContainer.style.setProperty('display', 'none', 'important');
          summaryContainer.style.setProperty('visibility', 'hidden', 'important');
          summaryContainer.style.setProperty('opacity', '0', 'important');
        }
        
        // Also ensure summarize tab itself is hidden when not active
        if (summarizeTab && !summarizeTab.classList.contains('active')) {
          summarizeTab.style.setProperty('display', 'none', 'important');
        }
        
        // Verify only one tab is active
        const activeTabs = this.tabContents.filter(tab => tab.classList.contains('active'));
        console.log('[TabManager] Active tabs count:', activeTabs.length, activeTabs.map(t => t.id));
        if (activeTabs.length > 1) {
          console.error('[TabManager] ERROR: Multiple tabs have active class!', activeTabs.map(t => t.id));
        }
        
        console.log('[TabManager] Active class added, CSS .tab-content.active should handle display');
        
        // DEBUG: Check computed styles of tab-content itself
        const computedTabContent = window.getComputedStyle(activeTabContent);
        console.log('[TabManager] DEBUG - Tab content: display=' + computedTabContent.display + 
          ', visibility=' + computedTabContent.visibility + 
          ', opacity=' + computedTabContent.opacity + 
          ', height=' + computedTabContent.height + 
          ', width=' + computedTabContent.width);
        
        // CRITICAL: Force explicit dimensions on tab-content to prevent collapsing
        // For flashcards/quiz/notes, ensure tab-content has proper height AND width
        if (tabName === 'flashcards' || tabName === 'quiz' || tabName === 'notes') {
          // Get parent container dimensions
          const videoInfoRect = videoInfo?.getBoundingClientRect();
          const targetHeight = videoInfoRect && videoInfoRect.height > 0 
            ? Math.max(400, videoInfoRect.height - 100) 
            : 500;
          const targetWidth = videoInfoRect && videoInfoRect.width > 0
            ? videoInfoRect.width
            : 721; // Fallback width
          
          // Remove any existing dimension rules first, then set explicit dimensions
          activeTabContent.style.removeProperty('height');
          activeTabContent.style.removeProperty('min-height');
          activeTabContent.style.removeProperty('width');
          
          // Set explicit dimensions with !important to override CSS
          activeTabContent.style.setProperty('height', targetHeight + 'px', 'important');
          activeTabContent.style.setProperty('min-height', targetHeight + 'px', 'important');
          activeTabContent.style.setProperty('width', targetWidth + 'px', 'important');
          activeTabContent.style.setProperty('min-width', '100%', 'important');
          activeTabContent.style.setProperty('flex', '1 1 auto', 'important');
          activeTabContent.style.setProperty('display', 'flex', 'important');
          activeTabContent.style.setProperty('flex-direction', 'column', 'important');
          activeTabContent.style.setProperty('overflow', 'auto', 'important');
          activeTabContent.style.setProperty('visibility', 'visible', 'important');
          activeTabContent.style.setProperty('opacity', '1', 'important');
          
          console.log('[TabManager] Set tab-content dimensions to:', targetWidth + 'x' + targetHeight, 'px');
          
          // Use double requestAnimationFrame to ensure layout recalculation
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                // Force a reflow and verify
                void activeTabContent.offsetHeight;
                const computedStyle = window.getComputedStyle(activeTabContent);
                const tabRect = activeTabContent.getBoundingClientRect();
                const parentRect = activeTabContent.parentElement?.getBoundingClientRect();
                const videoInfoRect = videoInfo?.getBoundingClientRect();
                
                console.log('[TabManager] Tab content computed height:', computedStyle.height);
                console.log('[TabManager] Tab content computed width:', computedStyle.width);
                console.log('[TabManager] Tab content rect after height fix:', tabRect.width, 'x', tabRect.height);
                console.log('[TabManager] Parent rect:', parentRect?.width, 'x', parentRect?.height);
                console.log('[TabManager] video-info rect:', videoInfoRect?.width, 'x', videoInfoRect?.height);
                
                if (tabRect.height < 100 || tabRect.width === 0) {
                  console.error('[TabManager] ERROR: Tab content still collapsed after height fix!');
                  
                  // Parent is collapsed - force it to have dimensions
                  if (parentRect && (parentRect.width === 0 || parentRect.height === 0)) {
                    console.log('[TabManager] Parent is collapsed, forcing dimensions from video-info');
                    const parentEl = activeTabContent.parentElement;
                    if (parentEl && parentEl !== videoInfo) {
                      const videoInfoRect = videoInfo?.getBoundingClientRect();
                      if (videoInfoRect && videoInfoRect.width > 0) {
                        parentEl.style.setProperty('width', videoInfoRect.width + 'px', 'important');
                        parentEl.style.setProperty('min-width', '100%', 'important');
                        parentEl.style.setProperty('display', 'flex', 'important');
                        parentEl.style.setProperty('flex-direction', 'column', 'important');
                      }
                    }
                  }
                  
                  // Force width on tab-content itself from video-info
                  if (tabRect.width === 0 && videoInfoRect && videoInfoRect.width > 0) {
                    console.log('[TabManager] Forcing width from video-info:', videoInfoRect.width);
                    activeTabContent.style.setProperty('width', videoInfoRect.width + 'px', 'important');
                    activeTabContent.style.setProperty('min-width', '100%', 'important');
                  }
                }
              });
            });
          });
        }
        
        // Force a reflow to ensure CSS applies
        void activeTabContent.offsetHeight;
        
        // Ensure containers and content are visible for flashcards/quiz/notes tabs
        if (tabName === 'flashcards' || tabName === 'quiz' || tabName === 'notes') {
          // Don't remove height/min-height - let CSS flexbox work like summarize tab
          // The tab-content should get its height from flex: 1 and the parent container
          // Containers will push the tab-content to have proper height
          
          // Handle different naming conventions for notes (note-empty vs notes-empty)
          const container = activeTabContent.querySelector(`#${tabName === 'flashcards' ? 'flashcard' : tabName === 'quiz' ? 'quiz' : 'notes'}-container`);
          const content = activeTabContent.querySelector(`#${tabName === 'flashcards' ? 'flashcard' : tabName === 'quiz' ? 'quiz' : 'notes'}-content`);
          // Notes uses 'note-empty' not 'notes-empty'
          const emptyId = tabName === 'notes' ? 'note-empty' : `${tabName === 'flashcards' ? 'flashcard' : 'quiz'}-empty`;
          const empty = activeTabContent.querySelector(`#${emptyId}`);
          
          console.log('[TabManager] Elements found:', { container: !!container, content: !!content, empty: !!empty });
          
          // Set up containers - remove conflicting inline styles, let CSS handle display/flex
          if (container) {
            container.style.removeProperty('display');
            container.style.removeProperty('visibility');
            container.style.removeProperty('opacity');
            container.style.removeProperty('height');
            container.classList.remove('collapsed', 'hidden');
            // CSS already has min-height: 200px, let it work
            console.log('[TabManager] Container cleaned up');
          }
          if (content) {
            content.style.removeProperty('display');
            content.style.removeProperty('visibility');
            content.style.removeProperty('opacity');
            content.style.removeProperty('max-height');
            content.style.removeProperty('height');
            content.classList.remove('collapsed', 'hidden');
            console.log('[TabManager] Content cleaned up');
          }
          if (empty) {
            empty.style.removeProperty('display');
            empty.style.removeProperty('visibility');
            empty.style.removeProperty('opacity');
            empty.style.removeProperty('height');
            empty.classList.remove('hidden');
            // CSS should handle padding and dimensions
            console.log('[TabManager] Empty state cleaned up');
          }
          
          // Force a reflow so containers are laid out
          void activeTabContent.offsetHeight;
        }
      } else {
        console.error('[TabManager] Active tab content not found for:', tabName);
      }
      
      // Call registered callbacks
      this.onTabChangeCallbacks.forEach(callback => {
        try {
          callback(tabName);
        } catch (error) {
          console.error('[TabManager] Error in tab change callback:', error);
        }
      });
      
      // Regenerate suggestions when switching to chat tab
      if (tabName === 'chat' && window.chatManager) {
        console.log('[TabManager] Regenerating chat suggestions');
        window.chatManager.generateSuggestions();
      }
      
      // Render content BEFORE showing tab to prevent flash
      // For flashcards, quiz, and notes tabs, render immediately before showing
      if (tabName === 'flashcards') {
        console.log('[TabManager] Rendering flashcards, controller exists:', !!window.flashcardUIController);
        
        // Ensure button handlers are set up
        const generateButton = document.getElementById('generate-flashcard-button');
        if (generateButton && window.flashcardUIController && !generateButton.hasAttribute('data-handler-attached')) {
          console.log('[TabManager] Setting up flashcard button handler');
          generateButton.setAttribute('data-handler-attached', 'true');
          generateButton.addEventListener('click', async () => {
            if (window.flashcardUIController) {
              await window.flashcardUIController.handleGenerateFlashcards();
            }
          });
        }

        // Render content BEFORE showing tab - this prevents flash
        if (window.flashcardUIController) {
          // Create overlay for elegant fade-in (matches theme)
          const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
          const overlayBg = isDarkMode ? '#1a1a1a' : '#ffffff';
          const overlay = document.createElement('div');
          overlay.className = 'tab-content-overlay';
          overlay.style.cssText = `position: absolute; inset: 0; background: ${overlayBg}; opacity: 1; z-index: 9999; pointer-events: none; transition: opacity 1s ease-out;`;
          activeTabContent.style.position = 'relative';
          activeTabContent.appendChild(overlay);
          
          // Set tab to opacity 0 temporarily while rendering
          activeTabContent.style.setProperty('opacity', '0', 'important');
          await window.flashcardUIController.renderFlashcards().catch(err => {
            console.error('[TabManager] Error rendering flashcards:', err);
          });
          
          // Remove opacity after render completes
          activeTabContent.style.removeProperty('opacity');
          
          // Trigger fade-out animation
          requestAnimationFrame(() => {
            overlay.style.opacity = '0';
            // Remove overlay after animation completes
            setTimeout(() => {
              if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
              }
            }, 1000);
          });
        } else {
          console.warn('[TabManager] FlashcardUIController not available');
        }
      }
      
      if (tabName === 'quiz') {
        console.log('[TabManager] Rendering quiz, controller exists:', !!window.quizUIController);
        
        // Ensure button handlers are set up
        const makeTestButton = document.getElementById('make-test-button');
        const regenerateQuizButton = document.getElementById('regenerate-quiz-button');
        if (makeTestButton && window.quizUIController && !makeTestButton.hasAttribute('data-handler-attached')) {
          console.log('[TabManager] Setting up quiz button handler');
          makeTestButton.setAttribute('data-handler-attached', 'true');
          makeTestButton.addEventListener('click', async () => {
            if (window.quizUIController) {
              await window.quizUIController.handleGenerateQuiz();
            }
          });
        }
        if (regenerateQuizButton && window.quizUIController && !regenerateQuizButton.hasAttribute('data-handler-attached')) {
          regenerateQuizButton.setAttribute('data-handler-attached', 'true');
          regenerateQuizButton.addEventListener('click', async () => {
            if (window.quizUIController) {
              await window.quizUIController.handleGenerateQuiz(true);
            }
          });
        }
        
        // Render content BEFORE showing tab - this prevents flash
        if (window.quizUIController) {
          // Create overlay for elegant fade-in (matches theme)
          const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
          const overlayBg = isDarkMode ? '#1a1a1a' : '#ffffff';
          const overlay = document.createElement('div');
          overlay.className = 'tab-content-overlay';
          overlay.style.cssText = `position: absolute; inset: 0; background: ${overlayBg}; opacity: 1; z-index: 9999; pointer-events: none; transition: opacity 1s ease-out;`;
          activeTabContent.style.position = 'relative';
          activeTabContent.appendChild(overlay);
          
          // Set tab to opacity 0 temporarily while rendering
          activeTabContent.style.setProperty('opacity', '0', 'important');
          await window.quizUIController.renderQuiz().catch(err => {
            console.error('[TabManager] Error rendering quiz:', err);
          });
          
          // Remove opacity after render completes
          activeTabContent.style.removeProperty('opacity');
          
          // Trigger fade-out animation
          requestAnimationFrame(() => {
            overlay.style.opacity = '0';
            // Remove overlay after animation completes
            setTimeout(() => {
              if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
              }
            }, 1000);
          });
        } else {
          console.warn('[TabManager] QuizUIController not available');
        }
      }
      
      if (tabName === 'notes') {
        console.log('[TabManager] Rendering notes, controller exists:', !!window.notesUIController);
        
        // Ensure button handlers are set up
        const createNoteButton = document.getElementById('create-note-button');
        if (createNoteButton && window.notesUIController && !createNoteButton.hasAttribute('data-handler-attached')) {
          console.log('[TabManager] Setting up notes button handler');
          createNoteButton.setAttribute('data-handler-attached', 'true');
          createNoteButton.addEventListener('click', () => {
            const noteEditorDialog = document.getElementById('note-editor-dialog');
            const noteTitleInput = document.getElementById('note-title');
            const noteFolderInput = document.getElementById('note-folder');
            const noteContentInput = document.getElementById('note-content');
            const noteEditorForm = document.getElementById('note-editor-form');
            
            if (noteEditorDialog) {
              document.getElementById('note-editor-title').textContent = 'New Note';
              if (noteTitleInput) noteTitleInput.value = '';
              if (noteFolderInput) noteFolderInput.value = 'Uncategorized';
              if (noteContentInput) noteContentInput.value = '';
              if (noteEditorForm) {
                delete noteEditorForm.dataset.noteId;
              }
              noteEditorDialog.showModal();
            }
          });
        }
        
        // CRITICAL: Set up note editor form and close handlers directly here
        const noteEditorDialog = document.getElementById('note-editor-dialog');
        const noteEditorForm = document.getElementById('note-editor-form');
        
        if (noteEditorDialog && !noteEditorDialog.hasAttribute('data-handlers-attached')) {
          console.log('[TabManager] Setting up note editor dialog handlers');
          noteEditorDialog.setAttribute('data-handlers-attached', 'true');
          
          // Function to close dialog - removes required attributes temporarily
          const closeDialog = () => {
            const noteTitleInput = document.getElementById('note-title');
            const noteContentInput = document.getElementById('note-content');
            
            // Temporarily remove required attributes to allow closing
            if (noteTitleInput) {
              noteTitleInput.removeAttribute('required');
              noteTitleInput.removeAttribute('aria-required');
            }
            if (noteContentInput) {
              noteContentInput.removeAttribute('required');
              noteContentInput.removeAttribute('aria-required');
            }
            
            // Force close the dialog
            noteEditorDialog.close();
            
            // Restore required attributes after a brief delay
            setTimeout(() => {
              if (noteTitleInput) {
                noteTitleInput.setAttribute('required', '');
              }
              if (noteContentInput) {
                noteContentInput.setAttribute('required', '');
              }
            }, 100);
          };
          
          // Set up form submission handler for notes
          if (noteEditorForm && !noteEditorForm.hasAttribute('data-submit-handler-attached')) {
            noteEditorForm.setAttribute('data-submit-handler-attached', 'true');
            noteEditorForm.addEventListener('submit', async (e) => {
              e.preventDefault();
              if (!window.SumVidNotesManager || !window.notesUIController) return;
              
              const noteTitleInput = document.getElementById('note-title');
              const noteFolderInput = document.getElementById('note-folder');
              const noteContentInput = document.getElementById('note-content');
              const notesFilter = document.getElementById('notes-filter');
              
              const title = noteTitleInput?.value.trim();
              const folder = noteFolderInput?.value.trim() || 'Uncategorized';
              const content = noteContentInput?.value.trim();
              
              if (!title || !content) {
                alert('Title and content are required');
                return;
              }
              
              const noteId = noteEditorForm.dataset.noteId;
              if (noteId) {
                await window.SumVidNotesManager.updateNote(noteId, { title, folder, content });
              } else {
                await window.SumVidNotesManager.createNote(title, content, folder);
              }
              
              closeDialog();
              
              // Refresh notes list
              const folderFilter = notesFilter ? notesFilter.value : 'all';
              await window.notesUIController.renderNotes(folderFilter);
            });
          }
          
          // Handle cancel buttons using event delegation
          noteEditorDialog.addEventListener('click', (e) => {
            // Check if clicked element or its parent is a cancel button
            const cancelButton = e.target.closest('.note-editor__cancel');
            if (cancelButton) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              closeDialog();
              return false;
            }
            
            // Close if clicking on the dialog backdrop (not the form content)
            if (e.target === noteEditorDialog) {
              closeDialog();
            }
          }, true); // Use capture phase to ensure we catch it first
          
          // Handle ESC key
          noteEditorDialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeDialog();
          });
          
          noteEditorDialog.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.keyCode === 27) {
              e.preventDefault();
              e.stopPropagation();
              closeDialog();
            }
          });
        }
        
        const notesFilter = document.getElementById('notes-filter');
        if (notesFilter && window.notesUIController && !notesFilter.hasAttribute('data-handler-attached')) {
          notesFilter.setAttribute('data-handler-attached', 'true');
          notesFilter.addEventListener('change', () => {
            if (window.notesUIController) {
              window.notesUIController.renderNotes(notesFilter.value);
            }
          });
        }
        
        // Render content BEFORE showing tab - this prevents flash
        if (window.notesUIController) {
          // Create overlay for elegant fade-in (matches theme)
          const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
          const overlayBg = isDarkMode ? '#1a1a1a' : '#ffffff';
          const overlay = document.createElement('div');
          overlay.className = 'tab-content-overlay';
          overlay.style.cssText = `position: absolute; inset: 0; background: ${overlayBg}; opacity: 1; z-index: 9999; pointer-events: none; transition: opacity 1s ease-out;`;
          activeTabContent.style.position = 'relative';
          activeTabContent.appendChild(overlay);
          
          const folder = notesFilter ? notesFilter.value : 'all';
          console.log('[TabManager] Rendering notes for folder:', folder);
          // Set tab to opacity 0 temporarily while rendering
          activeTabContent.style.setProperty('opacity', '0', 'important');
          await window.notesUIController.renderNotes(folder).catch(err => {
            console.error('[TabManager] Error rendering notes:', err);
          });
          
          // Remove opacity after render completes
          activeTabContent.style.removeProperty('opacity');
          
          // Trigger fade-out animation
          requestAnimationFrame(() => {
            overlay.style.opacity = '0';
            // Remove overlay after animation completes
            setTimeout(() => {
              if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
              }
            }, 1000);
          });
        } else {
          console.warn('[TabManager] NotesUIController not available');
        }
      }
    }

    getActiveTab() {
      return this.activeTab;
    }

    onTabChange(callback) {
      if (typeof callback === 'function') {
        this.onTabChangeCallbacks.push(callback);
      }
    }
  }

  // Export to global scope
  window.TabManager = TabManager;
})();
