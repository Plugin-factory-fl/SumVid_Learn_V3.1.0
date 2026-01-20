/**
 * Content Generator Module
 * Handles summary generation, content caching, and info center updates
 * Note: Quiz generation has been moved to QuizUIController
 */

(function() {
  'use strict';

  const CACHE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours

  class ContentGenerator {
    constructor(options = {}) {
      this.summaryContainer = options.summaryContainer;
      this.summaryContent = options.summaryContent;
      this.summaryHeader = options.summaryHeader;
      
      // Clear expired content on initialization
      this.clearExpiredContent();
    }

    // Cache management
    async saveGeneratedContent(videoId, type, content) {
      if (!videoId) return;
      
      const key = `${type}_${videoId}`;
      const data = {
        content: content,
        timestamp: Date.now(),
        videoId: videoId
      };
      
      try {
        await chrome.storage.local.set({ [key]: data });
        console.log(`Saved ${type} for video ${videoId}`);
      } catch (error) {
        console.error(`Error saving ${type}:`, error);
      }
    }

    async loadGeneratedContent(videoId, type) {
      if (!videoId) return null;
      
      const key = `${type}_${videoId}`;
      
      try {
        const result = await chrome.storage.local.get([key]);
        const data = result[key];
        
        if (!data) return null;
        
        // Check if content has expired
        if (Date.now() - data.timestamp > CACHE_EXPIRY_TIME) {
          await chrome.storage.local.remove([key]);
          return null;
        }
        
        return data.content;
      } catch (error) {
        console.error(`Error loading ${type}:`, error);
        return null;
      }
    }

    async clearExpiredContent() {
      try {
        const allData = await chrome.storage.local.get(null);
        const keysToRemove = [];
        
        for (const [key, value] of Object.entries(allData)) {
          if (key.startsWith('summary_') || key.startsWith('quiz_') || key.startsWith('chat_')) {
            if (value.timestamp && Date.now() - value.timestamp > CACHE_EXPIRY_TIME) {
              keysToRemove.push(key);
            }
          }
        }
        
        if (keysToRemove.length > 0) {
          await chrome.storage.local.remove(keysToRemove);
          console.log(`Cleared ${keysToRemove.length} expired cache entries`);
        }
      } catch (error) {
        console.error('Error clearing expired content:', error);
      }
    }

    // Helper functions
    getVideoId(url) {
      try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('v');
      } catch (error) {
        console.error('Error parsing video URL:', error);
        return null;
      }
    }

    formatDuration(seconds) {
      if (!seconds) return '--:--';
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainingSeconds = Math.floor(seconds % 60);
      if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
      }
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    calculateReadingTime(text, returnRawMinutes = false) {
      if (!text) return returnRawMinutes ? 0 : '-- min';
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = text;
      const cleanText = tempDiv.textContent || tempDiv.innerText || "";
      const wordsPerMinute = 200;
      const wordCount = cleanText.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount === 0) return returnRawMinutes ? 0 : '-- min';
      const minutes = Math.ceil(wordCount / wordsPerMinute);
      return returnRawMinutes ? minutes : `${minutes} min`;
    }

    updateInfoCenter(videoDuration, summaryText) {
      const videoDurationElement = document.getElementById('video-duration');
      const readingTimeElement = document.getElementById('estimated-reading-time');
      const learningMultiplierElement = document.getElementById('learning-multiplier');
      const multiplierMainText = document.getElementById('multiplier-main-text');
      const multiplierSubtitle = document.getElementById('multiplier-subtitle');

      if (videoDurationElement) {
        videoDurationElement.textContent = this.formatDuration(videoDuration);
      }
      
      const readingMinutes = this.calculateReadingTime(summaryText, true);

      if (readingTimeElement) {
        readingTimeElement.textContent = readingMinutes > 0 ? `${readingMinutes} min` : '-- min';
      }

      if (learningMultiplierElement && videoDuration > 0 && readingMinutes > 0) {
        const videoMinutes = videoDuration / 60;
        const multiplier = Math.round(videoMinutes / readingMinutes);

        if (multiplier > 1) {
          if (multiplierMainText && multiplierSubtitle) {
            multiplierMainText.innerHTML = `You are a <strong>${multiplier}X</strong> learner!`;
            multiplierSubtitle.textContent = "Visit the Test Your Knowledge section to truly retain this knowledge!";
          }
          learningMultiplierElement.classList.remove('hidden');
        } else {
          learningMultiplierElement.classList.add('hidden');
        }
      } else if (learningMultiplierElement) {
        learningMultiplierElement.classList.add('hidden');
      }
    }

    async generateSummary(text, forceRegenerate = false, context = '', currentVideoInfo, userContext) {
      if (!this.summaryContainer) return;

      this.summaryContainer.classList.remove('hidden');
      if (this.quizContainer) this.quizContainer.classList.remove('hidden');

      // Premium feature check for long videos
      if (currentVideoInfo?.duration > 3600) {
        console.log('Video is longer than 1 hour. Showing premium message.');
        const summaryTextElement = document.querySelector('#summary-content .summary-text');
        
        if (summaryTextElement) {
          summaryTextElement.innerHTML = `
            <div class="premium-popup">
              <h4>Premium Feature</h4>
              <p>Summarizing videos 1 hour or longer is a premium feature.</p>
              <button class="upgrade-button">Upgrade to the PROfessor Plan for $5.99 to access!</button>
            </div>
          `;
          document.querySelector('.summary-info-center')?.classList.add('hidden');
          if (window.showCompletionBadge) {
            window.showCompletionBadge(this.summaryContainer);
          }
        }
        return;
      }

      try {
        const videoId = currentVideoInfo ? this.getVideoId(currentVideoInfo.url) : null;
        const summaryTextElement = document.querySelector('#summary-content .summary-text');
        const summaryInfoCenter = document.querySelector('.summary-info-center');
        
        // Check for cached summary
        if (!forceRegenerate && videoId) {
          const cachedSummary = await this.loadGeneratedContent(videoId, 'summary');
          if (cachedSummary) {
            console.log('Loading cached summary');
            if (summaryTextElement) {
              summaryTextElement.innerHTML = cachedSummary;
              summaryInfoCenter?.classList.remove('hidden');
              this.updateInfoCenter(currentVideoInfo?.duration, cachedSummary);
            }
            if (window.showCompletionBadge) {
              window.showCompletionBadge(this.summaryContainer);
            }
            
            // Add "Save to notes" and "Copy" buttons for cached summary
            if (summaryTextElement && window.SumVidNotesManager) {
              // Remove existing buttons if present
              const existingSaveButton = document.getElementById('save-summary-to-notes-button');
              const existingCopyButton = document.getElementById('copy-summary-button');
              const existingButtonContainer = document.getElementById('summary-buttons-container');
              if (existingSaveButton) existingSaveButton.remove();
              if (existingCopyButton) existingCopyButton.remove();
              if (existingButtonContainer) existingButtonContainer.remove();
              
              // Create button container
              const buttonContainer = document.createElement('div');
              buttonContainer.id = 'summary-buttons-container';
              buttonContainer.style.cssText = 'margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap;';
              
              // Create "Save to notes" button
              const saveToNotesButton = document.createElement('button');
              saveToNotesButton.id = 'save-summary-to-notes-button';
              saveToNotesButton.className = 'btn btn--primary';
              saveToNotesButton.textContent = 'Save to notes';
              saveToNotesButton.style.cssText = 'display: inline-block;';
              
              saveToNotesButton.addEventListener('click', async () => {
                try {
                  const summaryText = summaryTextElement.textContent || summaryTextElement.innerText;
                  const contentTitle = currentVideoInfo?.title || 'Summary';
                  
                  if (!summaryText || summaryText === 'Generating summary...') {
                    alert('No summary available to save.');
                    return;
                  }
                  
                  await window.SumVidNotesManager.createNote(
                    contentTitle,
                    summaryText,
                    'Summaries'
                  );
                  
                  // Show brief confirmation
                  const originalText = saveToNotesButton.textContent;
                  saveToNotesButton.textContent = 'Saved!';
                  saveToNotesButton.disabled = true;
                  
                  setTimeout(() => {
                    saveToNotesButton.textContent = originalText;
                    saveToNotesButton.disabled = false;
                  }, 2000);
                  
                  // Refresh notes list if notes tab is active
                  if (window.tabManager && window.tabManager.getActiveTab() === 'notes' && window.notesUIController) {
                    const notesFilter = document.getElementById('notes-filter');
                    const folder = notesFilter ? notesFilter.value : 'all';
                    await window.notesUIController.renderNotes(folder);
                  }
                } catch (error) {
                  console.error('[Eureka AI] Error saving summary to notes:', error);
                  alert('Failed to save summary to notes. Please try again.');
                }
              });
              
              // Create "Copy" button
              const copyButton = document.createElement('button');
              copyButton.id = 'copy-summary-button';
              copyButton.className = 'btn btn--primary';
              copyButton.textContent = 'Copy';
              copyButton.style.cssText = 'display: inline-block;';
              
              copyButton.addEventListener('click', async () => {
                try {
                  const summaryText = summaryTextElement.textContent || summaryTextElement.innerText;
                  
                  if (!summaryText || summaryText === 'Generating summary...') {
                    alert('No summary available to copy.');
                    return;
                  }
                  
                  await navigator.clipboard.writeText(summaryText);
                  
                  // Show brief confirmation
                  const originalText = copyButton.textContent;
                  copyButton.textContent = 'Copied!';
                  copyButton.disabled = true;
                  
                  setTimeout(() => {
                    copyButton.textContent = originalText;
                    copyButton.disabled = false;
                  }, 2000);
                } catch (error) {
                  console.error('[Eureka AI] Error copying summary:', error);
                  alert('Failed to copy summary. Please try again.');
                }
              });
              
              buttonContainer.appendChild(saveToNotesButton);
              buttonContainer.appendChild(copyButton);
              
              // Insert button container after summary text element
              summaryTextElement.parentNode.insertBefore(buttonContainer, summaryTextElement.nextSibling);
            }
            
            // Ensure cached summary is visible and expanded
            if (this.summaryContent) {
              this.summaryContent.style.display = 'block';
              this.summaryContent.classList.remove('collapsed');
              this.summaryContent.style.visibility = 'visible';
              this.summaryContent.style.opacity = '1';
              // Don't set maxHeight - let CSS flex layout handle it for scrolling
            }
            if (this.summaryHeader) {
              this.summaryHeader.querySelector('.collapse-button')?.classList.remove('collapsed');
            }

            // Load cached chat
            if (window.chatManager && typeof window.chatManager.loadCachedChat === 'function') {
              await window.chatManager.loadCachedChat(videoId);
            }
            // Quiz loading is now handled by QuizUIController
            return;
          }
        }
        
        // Generate new summary
        if (this.summaryContainer) {
          this.summaryContainer.classList.remove('hidden');
        }
        if (this.summaryContent) {
          this.summaryContent.style.display = 'block';
        }
        
        if (summaryTextElement) {
          summaryTextElement.textContent = 'Generating summary...';
          summaryInfoCenter?.classList.add('hidden');
        }
        
        if (window.showLoadingIndicator) {
          window.showLoadingIndicator(this.summaryContainer);
        }
        
        const effectiveContext = context || (userContext?.summary || '');
        
        let response;
        try {
          if (typeof chrome === 'undefined' || !chrome.runtime) {
            throw new Error('Chrome runtime not available');
          }
          
          response = await chrome.runtime.sendMessage({ 
            action: 'summarize', 
            transcript: text,
            context: effectiveContext
          });

          if (currentVideoInfo && !currentVideoInfo.transcript) {
            currentVideoInfo.transcript = text;
          }

        } catch (error) {
          console.error('Error sending message to background:', error);
          if (summaryTextElement) {
            summaryTextElement.textContent = `Failed to generate summary: ${error.message}`;
            summaryInfoCenter?.classList.add('hidden');
          }
          return;
        }

        if (response?.error) {
          console.error('Summary error:', response.error);
          if (summaryTextElement) {
            summaryTextElement.textContent = `Failed to generate summary: ${response.error}`;
            summaryInfoCenter?.classList.add('hidden');
          }
        } else {
          if (summaryTextElement) {
            summaryTextElement.innerHTML = response.summary;
            summaryInfoCenter?.classList.remove('hidden');
            this.updateInfoCenter(currentVideoInfo?.duration, response.summary);
          }
          
          if (videoId) {
            await this.saveGeneratedContent(videoId, 'summary', response.summary);
          }
          
          if (window.showCompletionBadge) {
            window.showCompletionBadge(this.summaryContainer);
          }
          
          const summarizeButton = document.getElementById('summarize-button');
          const regenerateSummaryButton = document.getElementById('regenerate-summary-button');
          if (summarizeButton) summarizeButton.style.display = 'none';
          if (regenerateSummaryButton) regenerateSummaryButton.style.display = 'block';
          
          // Add "Save to notes" and "Copy" buttons after summary generation
          if (summaryTextElement && window.SumVidNotesManager) {
            // Remove existing buttons if present
            const existingSaveButton = document.getElementById('save-summary-to-notes-button');
            const existingCopyButton = document.getElementById('copy-summary-button');
            const existingButtonContainer = document.getElementById('summary-buttons-container');
            if (existingSaveButton) existingSaveButton.remove();
            if (existingCopyButton) existingCopyButton.remove();
            if (existingButtonContainer) existingButtonContainer.remove();
            
            // Create button container
            const buttonContainer = document.createElement('div');
            buttonContainer.id = 'summary-buttons-container';
            buttonContainer.style.cssText = 'margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap;';
            
            // Create "Save to notes" button
            const saveToNotesButton = document.createElement('button');
            saveToNotesButton.id = 'save-summary-to-notes-button';
            saveToNotesButton.className = 'btn btn--primary';
            saveToNotesButton.textContent = 'Save to notes';
            saveToNotesButton.style.cssText = 'display: inline-block;';
            
            saveToNotesButton.addEventListener('click', async () => {
              try {
                const summaryText = summaryTextElement.textContent || summaryTextElement.innerText;
                const contentTitle = currentVideoInfo?.title || 'Summary';
                
                if (!summaryText || summaryText === 'Generating summary...') {
                  alert('No summary available to save.');
                  return;
                }
                
                await window.SumVidNotesManager.createNote(
                  contentTitle,
                  summaryText,
                  'Summaries'
                );
                
                // Show brief confirmation
                const originalText = saveToNotesButton.textContent;
                saveToNotesButton.textContent = 'Saved!';
                saveToNotesButton.disabled = true;
                
                setTimeout(() => {
                  saveToNotesButton.textContent = originalText;
                  saveToNotesButton.disabled = false;
                }, 2000);
                
                // Refresh notes list if notes tab is active
                if (window.tabManager && window.tabManager.getActiveTab() === 'notes' && window.notesUIController) {
                  const notesFilter = document.getElementById('notes-filter');
                  const folder = notesFilter ? notesFilter.value : 'all';
                  await window.notesUIController.renderNotes(folder);
                }
              } catch (error) {
                console.error('[Eureka AI] Error saving summary to notes:', error);
                alert('Failed to save summary to notes. Please try again.');
              }
            });
            
            // Create "Copy" button
            const copyButton = document.createElement('button');
            copyButton.id = 'copy-summary-button';
            copyButton.className = 'btn btn--primary';
            copyButton.textContent = 'Copy';
            copyButton.style.cssText = 'display: inline-block;';
            
            copyButton.addEventListener('click', async () => {
              try {
                const summaryText = summaryTextElement.textContent || summaryTextElement.innerText;
                
                if (!summaryText || summaryText === 'Generating summary...') {
                  alert('No summary available to copy.');
                  return;
                }
                
                await navigator.clipboard.writeText(summaryText);
                
                // Show brief confirmation
                const originalText = copyButton.textContent;
                copyButton.textContent = 'Copied!';
                copyButton.disabled = true;
                
                setTimeout(() => {
                  copyButton.textContent = originalText;
                  copyButton.disabled = false;
                }, 2000);
              } catch (error) {
                console.error('[Eureka AI] Error copying summary:', error);
                alert('Failed to copy summary. Please try again.');
              }
            });
            
            buttonContainer.appendChild(saveToNotesButton);
            buttonContainer.appendChild(copyButton);
            
            // Insert button container after summary text element
            summaryTextElement.parentNode.insertBefore(buttonContainer, summaryTextElement.nextSibling);
          }
          
          // Ensure summary content is visible and expanded after generation
          if (this.summaryContent) {
            this.summaryContent.style.display = 'block';
            this.summaryContent.classList.remove('collapsed');
            this.summaryContent.style.visibility = 'visible';
            this.summaryContent.style.opacity = '1';
            // Don't set maxHeight - let CSS flex layout handle it for scrolling
          }
          if (this.summaryHeader) {
            this.summaryHeader.querySelector('.collapse-button')?.classList.remove('collapsed');
          }
        }
      } catch (error) {
        console.error('Summary error:', error);
        const summaryTextElement = document.querySelector('#summary-content .summary-text');
        if (summaryTextElement) {
          summaryTextElement.textContent = `Failed to generate summary: ${error.message}`;
        }
      }
    }

    // Quiz methods moved to QuizUIController
  }

  // Export to global scope
  window.ContentGenerator = ContentGenerator;
})();
