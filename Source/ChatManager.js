/**
 * Chat Manager Module
 * Handles chat functionality, suggestions, and message management
 */

(function() {
  'use strict';

  class ChatManager {
    constructor(container, input, sendButton, suggestionsContainer, chatSection) {
      this.container = container;
      this.input = input;
      this.sendButton = sendButton;
      this.suggestionsContainer = suggestionsContainer;
      this.chatSection = chatSection;
      this.playfulMessageShown = false;
      this.pendingScreenshot = null;
      this.placeholderIndex = 0;
      this.placeholderInterval = null;
      this.placeholders = [
        "Ask me to summarize chapters 1-5 in the PDF",
        "Ask me a unique question",
        "Ask me to clarify something"
      ];
      
      // Get screenshot preview elements
      this.screenshotPreview = document.getElementById('screenshot-preview');
      this.screenshotPreviewImg = document.getElementById('screenshot-preview-img');
      this.screenshotPreviewRemove = document.getElementById('screenshot-preview-remove');
      
      this.init();
    }

    /**
     * Compress image to reduce file size before sending to backend
     * @param {string} imageData - Base64 data URL
     * @param {number} maxWidth - Maximum width in pixels (default: 800)
     * @param {number} maxHeight - Maximum height in pixels (default: 800)
     * @param {number} quality - JPEG quality 0-1 (default: 0.7)
     * @returns {Promise<string>} Compressed base64 data URL
     */
    async compressImage(imageData, maxWidth = 800, maxHeight = 800, quality = 0.7) {
      return new Promise((resolve, reject) => {
        if (!imageData || typeof imageData !== 'string') {
          resolve(imageData);
          return;
        }

        const img = new Image();
        img.onload = () => {
          try {
            // Calculate new dimensions maintaining aspect ratio
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
              const ratio = Math.min(maxWidth / width, maxHeight / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }

            // Create canvas and draw resized image
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to base64 with compression
            const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve(compressedDataUrl);
          } catch (error) {
            console.error('[Eureka AI] Error compressing image:', error);
            // Return original if compression fails
            resolve(imageData);
          }
        };

        img.onerror = () => {
          console.error('[Eureka AI] Error loading image for compression');
          // Return original if loading fails
          resolve(imageData);
        };

        img.src = imageData;
      });
    }

    init() {
      // Event listeners
      if (this.sendButton) {
        this.sendButton.addEventListener('click', () => this.handleSubmit());
      }
      
      if (this.input) {
        this.input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            this.handleSubmit();
          }
        });
        
        // Initialize placeholder rotation
        this.input.placeholder = this.placeholders[0];
        this.startPlaceholderRotation();
        
        this.input.addEventListener('focus', () => this.stopPlaceholderRotation());
        this.input.addEventListener('blur', () => {
          if (!this.input.value) {
            this.startPlaceholderRotation();
          }
        });
        this.input.addEventListener('input', () => {
          if (this.input.value) {
            this.stopPlaceholderRotation();
          } else if (document.activeElement !== this.input) {
            this.startPlaceholderRotation();
          }
        });
      }
      
      // Screenshot preview remove button
      if (this.screenshotPreviewRemove) {
        this.screenshotPreviewRemove.addEventListener('click', () => {
          this.hideScreenshotPreview();
        });
      }
      
      // Clear chat button
      const clearChatButton = document.getElementById('clear-chat-button');
      if (clearChatButton) {
        clearChatButton.addEventListener('click', () => {
          this.clearChat();
        });
      }
      
      // Listen for captured screenshots
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.capturedScreenshot) {
          const screenshot = changes.capturedScreenshot.newValue;
          if (screenshot && screenshot.imageData) {
            this.showScreenshotPreview(screenshot.imageData);
            chrome.storage.local.remove('capturedScreenshot');
          }
        }
      });
      
      // Runtime message listener for screenshots
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'screenshot-captured' && message.imageData) {
          this.showScreenshotPreview(message.imageData);
          sendResponse({ success: true });
        }
        return false;
      });
      
      // Generate suggestions on load
      setTimeout(() => this.generateSuggestions(), 100);
    }

    addMessage(message, isUser = false) {
      if (!this.container) return;
      
      const messageElement = document.createElement('div');
      messageElement.className = `chat-message ${isUser ? 'user' : 'assistant'}`;
      
      // Format message content for assistant messages (left-align, parse lists, etc.)
      if (!isUser && message) {
        let formattedMessage = message;
        
        // Parse numbered lists: Convert "1. text 2. text" to proper list format
        // Match patterns like "1. ", "2. ", etc. at start of lines
        formattedMessage = formattedMessage.replace(/(\d+\.\s+[^\n]+(?:\n(?!(?:\d+\.|\*\*|$))[^\n]+)*)/g, (match) => {
          // Split by line breaks and number patterns
          const lines = match.split(/(?=\d+\.\s+)/);
          return lines.map(line => {
            const trimmed = line.trim();
            if (trimmed && /^\d+\.\s+/.test(trimmed)) {
              return `<p style="margin: 8px 0;">${trimmed}</p>`;
            }
            return trimmed ? `<p style="margin: 8px 0;">${trimmed}</p>` : '';
          }).join('');
        });
        
        // Convert markdown-style bold (**text**) to <strong>
        formattedMessage = formattedMessage.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        
        // Detect section headers (lines ending with ":" followed by content)
        formattedMessage = formattedMessage.replace(/^([^:\n]+:)(?=\s*\n)/gm, '<strong>$1</strong>');
        
        // Wrap in div with left alignment
        messageElement.innerHTML = `<div style="text-align: left; width: 100%;">${formattedMessage}</div>`;
      } else {
        // User messages stay as plain text
        messageElement.textContent = message;
      }
      
      this.container.appendChild(messageElement);
      
      if (this.container) {
        this.container.scrollTop = this.container.scrollHeight;
      }
      
      // Hide suggestions when message is added
      this.hideSuggestions();
    }

    async generateSuggestions() {
      if (!this.suggestionsContainer) return;
      
      // Get current content info and uploaded file context
      const [contentInfo, fileContext] = await Promise.all([
        chrome.storage.local.get(['currentContentInfo']),
        chrome.storage.local.get(['uploadedFileContext'])
      ]);
      
      const contentInfoData = contentInfo.currentContentInfo;
      const uploadedFileContext = fileContext.uploadedFileContext;
      
      const suggestions = [];
      
      if (contentInfoData) {
        const contentType = contentInfoData.type || 'webpage';
        if (contentType === 'video') {
          suggestions.push(
            'Summarize this video',
            'What are the main points?',
            'Explain the key concepts',
            'Generate flashcards from this video'
          );
        } else if (contentType === 'pdf') {
          suggestions.push(
            'Summarize this PDF',
            'What are the main ideas?',
            'Explain the key points',
            'Generate flashcards from this document'
          );
        } else {
          suggestions.push(
            'Summarize this content',
            'What are the main ideas?',
            'Explain the key points',
            'Generate flashcards from this page'
          );
        }
      } else {
        suggestions.push(
          'Ask a question',
          'Get help',
          'Explain something',
          'Summarize content'
        );
      }
      
      // Display suggestions with "Eureka AI for Chrome" header
      this.suggestionsContainer.innerHTML = '';
      
      // Add wave-animated header
      const header = document.createElement('div');
      header.className = 'playful-message';
      const waveText = document.createElement('span');
      waveText.className = 'wave-text';
      const text = 'Eureka AI for Chrome';
      text.split('').forEach((char, index) => {
        const charSpan = document.createElement('span');
        charSpan.className = 'wave-char';
        charSpan.textContent = char === ' ' ? '\u00A0' : char;
        charSpan.style.animationDelay = `${index * 0.1}s`;
        waveText.appendChild(charSpan);
      });
      header.appendChild(waveText);
      this.suggestionsContainer.appendChild(header);
      
      suggestions.forEach(suggestion => {
        const card = document.createElement('div');
        card.className = 'suggestion-card';
        card.textContent = suggestion;
        card.addEventListener('click', async () => {
          // Check if suggestion should trigger tab switch and auto-generate
          const lowerSuggestion = suggestion.toLowerCase();
          
          if (lowerSuggestion.includes('summarize')) {
            // Trigger tab switch and summary generation via custom event
            window.dispatchEvent(new CustomEvent('chat-suggestion-action', {
              detail: { action: 'summarize', text: suggestion }
            }));
          } else if (lowerSuggestion.includes('flashcard')) {
            // Trigger tab switch and flashcard generation
            window.dispatchEvent(new CustomEvent('chat-suggestion-action', {
              detail: { action: 'flashcards', text: suggestion }
            }));
          } else if (lowerSuggestion.includes('test') || lowerSuggestion.includes('quiz')) {
            // Trigger tab switch and quiz generation
            window.dispatchEvent(new CustomEvent('chat-suggestion-action', {
              detail: { action: 'quiz', text: suggestion }
            }));
          } else {
            // Regular suggestion - fill input and auto-submit for "main points" and "key concepts"
            const lowerSuggestion = suggestion.toLowerCase();
            const shouldAutoSubmit = lowerSuggestion.includes('main points') || 
                                   lowerSuggestion.includes('main ideas') ||
                                   lowerSuggestion.includes('key concepts') ||
                                   lowerSuggestion.includes('key points');
            
            if (this.input) {
              this.input.value = suggestion;
              this.input.focus();
              
              // Auto-submit if it's "main points" or "key concepts"
              if (shouldAutoSubmit) {
                // Small delay to ensure input is set, then submit
                setTimeout(() => {
                  this.handleSubmit();
                }, 100);
              }
            }
          }
        });
        this.suggestionsContainer.appendChild(card);
      });
      
      this.suggestionsContainer.classList.remove('hidden');
    }

    hideSuggestions() {
      if (this.suggestionsContainer) {
        this.suggestionsContainer.classList.add('hidden');
      }
    }

    async showScreenshotPreview(imageData) {
      if (!this.screenshotPreview || !this.screenshotPreviewImg) return;
      
      // Check upload limit for free users
      const limitCheck = await this.checkUploadLimit();
      if (!limitCheck.allowed) {
        await this.showUpgradeDialog(limitCheck.message);
        return;
      }
      
      this.pendingScreenshot = imageData;
      this.screenshotPreviewImg.src = imageData;
      this.screenshotPreview.style.display = 'block';
      
      // Store screenshot for context
      await chrome.storage.local.set({
        pendingScreenshotContext: {
          imageData: imageData,
          filename: 'screenshot.png',
          fileType: 'image/png',
          timestamp: Date.now()
        },
        lastFileUploadTimestamp: Date.now() // Update upload timestamp
      });
    }
    
    async checkUploadLimit() {
      // Check if user is premium
      if (window.premiumManager) {
        const isPremium = await window.premiumManager.checkPremiumStatus();
        if (isPremium) {
          return { allowed: true }; // Premium users have unlimited uploads
        }
      }
      
      // Check last upload timestamp for freemium users
      const stored = await chrome.storage.local.get(['lastFileUploadTimestamp']);
      const lastUpload = stored.lastFileUploadTimestamp;
      
      if (lastUpload) {
        const hoursSinceLastUpload = (Date.now() - lastUpload) / (1000 * 60 * 60);
        if (hoursSinceLastUpload < 24) {
          const hoursRemaining = Math.ceil(24 - hoursSinceLastUpload);
          return { 
            allowed: false, 
            message: `Free users can upload 1 file or screenshot per 24 hours. Please wait ${hoursRemaining} hour${hoursRemaining !== 1 ? 's' : ''} or upgrade to Pro for unlimited uploads.` 
          };
        }
      }
      
      return { allowed: true };
    }

    async showUpgradeDialog(message) {
      // Create or show upgrade dialog
      let dialog = document.getElementById('upload-limit-dialog');
      if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'upload-limit-dialog';
        dialog.className = 'modal';
        dialog.innerHTML = `
          <form method="dialog" class="modal__content">
            <header class="modal__header">
              <h2>Upload Limit Reached</h2>
              <button class="btn btn--ghost modal__close" type="button" aria-label="Close">×</button>
            </header>
            <div class="modal__body">
              <p>${message}</p>
            </div>
            <footer class="modal__footer">
              <button type="button" class="btn btn--ghost" onclick="this.closest('dialog').close()">Cancel</button>
              <button type="button" class="btn btn--primary" id="upload-limit-upgrade-btn">Upgrade to Pro</button>
            </footer>
          </form>
        `;
        document.body.appendChild(dialog);
        
        // Handle upgrade button
        const upgradeBtn = dialog.querySelector('#upload-limit-upgrade-btn');
        if (upgradeBtn) {
          upgradeBtn.addEventListener('click', async () => {
            dialog.close();
            // Use existing upgrade flow
            if (window.infoDialogsManager && window.infoDialogsManager.handleUpgrade) {
              await window.infoDialogsManager.handleUpgrade();
            }
          });
        }
        
        // Close on backdrop click
        dialog.addEventListener('click', (e) => {
          if (e.target === dialog) {
            dialog.close();
          }
        });
      } else {
        // Update message if dialog exists
        const messageEl = dialog.querySelector('.modal__body p');
        if (messageEl) {
          messageEl.textContent = message;
        }
      }
      
      dialog.showModal();
    }

    hideScreenshotPreview() {
      if (!this.screenshotPreview) return;
      
      this.pendingScreenshot = null;
      this.screenshotPreview.style.display = 'none';
      chrome.storage.local.remove('pendingScreenshotContext');
    }

    startPlaceholderRotation() {
      if (this.placeholderInterval || !this.input) return;
      this.placeholderInterval = setInterval(() => {
        if (this.input && !this.input.value && document.activeElement !== this.input) {
          this.placeholderIndex = (this.placeholderIndex + 1) % this.placeholders.length;
          this.input.placeholder = this.placeholders[this.placeholderIndex];
        }
      }, 2000);
    }

    stopPlaceholderRotation() {
      if (this.placeholderInterval) {
        clearInterval(this.placeholderInterval);
        this.placeholderInterval = null;
      }
    }

    async handleSubmit() {
      const question = this.input?.value.trim();
      
      // If there's a pending screenshot, include it even if question is empty
      if (!question && !this.pendingScreenshot) return;

      // Check usage limit
      const BACKEND_URL = 'https://sumvid-learn-backend.onrender.com';
      const stored = await chrome.storage.local.get(['sumvid_auth_token']);
      const token = stored.sumvid_auth_token;
      
      let limitReached = false;
      let isPremium = false;
      
      if (token) {
        try {
          const usageResponse = await fetch(`${BACKEND_URL}/api/user/usage`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (usageResponse.ok) {
            const usage = await usageResponse.json();
            limitReached = usage.enhancementsUsed >= usage.enhancementsLimit;
            isPremium = usage.subscriptionStatus === 'premium';
          }
        } catch (error) {
          console.warn('[Eureka AI] Failed to check usage from backend:', error);
          // Fallback to local check
          if (window.UsageTracker) {
            limitReached = await window.UsageTracker.isLimitReached();
          }
        }
      } else {
        // Not logged in, check local storage
        if (window.UsageTracker) {
          limitReached = await window.UsageTracker.isLimitReached();
        }
      }
      
      if (limitReached && !isPremium) {
        // Show usage limit message
        const messageText = "You're out of uses for Eureka AI! Wait 24 hours for 10 more uses or ";
        const upgradeLinkText = "UPGRADE TO PRO";
        const messageAfterLink = " for unlimited access.";
        
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message assistant usage-limit-message';
        messageElement.innerHTML = `${messageText}<a href="#" class="upgrade-link" id="chat-upgrade-link">${upgradeLinkText}</a>${messageAfterLink}`;
        this.container?.appendChild(messageElement);
        if (this.container) {
          this.container.scrollTop = this.container.scrollHeight;
        }
        
        // Add click handler for upgrade link
        const upgradeLink = document.getElementById('chat-upgrade-link');
        if (upgradeLink) {
          upgradeLink.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!token) {
              alert('Please log in to upgrade to Pro');
              return;
            }
            
            try {
              const response = await fetch(`${BACKEND_URL}/api/checkout/create-session`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
              });
              
              if (!response.ok) {
                throw new Error('Failed to create checkout session');
              }
              
              const data = await response.json();
              if (data.url) {
                window.open(data.url, '_blank');
              } else {
                alert('Upgrade feature coming soon!');
              }
            } catch (error) {
              console.error('[Eureka AI] Upgrade error:', error);
              alert(`Failed to initiate upgrade: ${error.message || 'Unknown error'}`);
            }
          });
        }
        
        return;
      }

      // Handle pending screenshot
      let screenshotToSend = null;
      if (this.pendingScreenshot) {
        screenshotToSend = this.pendingScreenshot;
        await chrome.storage.local.set({
          uploadedFileContext: {
            imageData: this.pendingScreenshot,
            filename: 'screenshot.png',
            fileType: 'image/png',
            timestamp: Date.now()
          }
        });
        this.hideScreenshotPreview();
      }

      // Add user's question to chat
      if (question) {
        this.addMessage(question, true);
      } else if (screenshotToSend) {
        this.addMessage('Screenshot:', true);
      }
      
      // Add screenshot image to the last user message if present
      if (screenshotToSend && this.container) {
        const lastMessage = this.container.querySelector('.chat-message.user:last-child');
        if (lastMessage) {
          const img = document.createElement('img');
          img.src = screenshotToSend;
          img.style.cssText = 'max-width: 100% !important; max-height: 250px !important; width: auto !important; height: auto !important; object-fit: contain !important; border-radius: 8px; margin-top: 8px; display: block;';
          img.className = 'chat-message-image';
          lastMessage.appendChild(img);
        }
      }
      
      if (this.input) {
        this.input.value = '';
      }

      // Show loading state
      if (this.chatSection && window.showLoadingIndicator) {
        window.showLoadingIndicator(this.chatSection);
      }

      try {
        if (typeof chrome === 'undefined' || !chrome.runtime) {
          throw new Error('Chrome runtime not available');
        }
        
        // Get combined context via FileManager if available
        let combinedContext = '';
        if (window.fileManager) {
          combinedContext = await window.fileManager.getCombinedContext();
        }
        
        // Get chat history
        const chatHistoryElements = this.container?.querySelectorAll('.chat-message.user, .chat-message.assistant');
        const chatHistory = [];
        if (chatHistoryElements) {
          chatHistoryElements.forEach((el, index) => {
            if (index < chatHistoryElements.length - 1) {
              const isUser = el.classList.contains('user');
              const text = el.textContent.trim();
              if (text && !el.classList.contains('playful-message') && !el.classList.contains('usage-limit-message')) {
                chatHistory.push({
                  role: isUser ? 'user' : 'assistant',
                  content: text
                });
              }
            }
          });
        }
        
        // Include screenshot in message if present
        let messageToSend = question || '';
        if (screenshotToSend) {
          messageToSend = question || 'Please analyze this screenshot.';
        }
        
        // Check if we need vision model (screenshot or uploaded file context)
        const uploadedFileContext = await chrome.storage.local.get(['uploadedFileContext']);
        const fileContext = uploadedFileContext.uploadedFileContext;
        const hasImageOrFile = screenshotToSend || 
                              (fileContext && 
                               (fileContext.imageData || 
                                fileContext.fileType?.startsWith('image/')));
        
        // Extract image data for vision model and compress before sending
        let imageDataToSend = null;
        if (screenshotToSend) {
          // Screenshot is already a base64 data URL - compress it
          imageDataToSend = await this.compressImage(screenshotToSend);
          console.log('[Eureka AI] Compressed screenshot, data URL size:', imageDataToSend?.length || 0, 'bytes');
          console.log('[Eureka AI] Screenshot data URL prefix:', imageDataToSend?.substring(0, 50) || 'none');
        } else if (fileContext && fileContext.imageData) {
          // Uploaded file image data - compress it
          imageDataToSend = await this.compressImage(fileContext.imageData);
          console.log('[Eureka AI] Compressed file image, data URL size:', imageDataToSend?.length || 0, 'bytes');
          console.log('[Eureka AI] File image data URL prefix:', imageDataToSend?.substring(0, 50) || 'none');
        }
        
        console.log('[Eureka AI] Sending sidechat message with useVisionModel:', !!hasImageOrFile, 'hasImageData:', !!imageDataToSend, 'imageDataLength:', imageDataToSend?.length || 0);
        
        const response = await chrome.runtime.sendMessage({
          action: 'sidechat',
          message: messageToSend,
          chatHistory: chatHistory,
          context: combinedContext,
          useVisionModel: !!hasImageOrFile, // Request vision model if image/file is present
          imageData: imageDataToSend // Send compressed image data (full data URL format)
        });

        if (response?.error) {
          this.addMessage(`Error: ${response.error}`, false);
        } else if (response?.reply) {
          this.addMessage(response.reply, false);
        } else {
          this.addMessage('Sorry, I encountered an error while processing your question.', false);
        }

        // Update status cards
        if (window.usageManager) {
          await window.usageManager.updateStatusCards();
        }
      } catch (error) {
        console.error('Error submitting question:', error);
        this.addMessage('Sorry, I encountered an error while processing your question.', false);
      }

      // Show completion state
      if (this.chatSection && window.showCompletionBadge) {
        window.showCompletionBadge(this.chatSection);
      }
    }

    async clearChat() {
      if (!this.container) return;
      
      // Clear all messages from container
      this.container.innerHTML = '';
      
      // Re-add suggestions container
      if (this.suggestionsContainer) {
        this.container.appendChild(this.suggestionsContainer);
      }
      
      // Clear cached chat
      try {
        const stored = await chrome.storage.local.get(['currentContentInfo', 'currentVideoInfo']);
        const contentInfo = stored.currentContentInfo || stored.currentVideoInfo;
        if (contentInfo?.url) {
          try {
            const urlObj = new URL(contentInfo.url);
            const videoId = urlObj.searchParams.get('v');
            if (videoId) {
              await chrome.storage.local.remove(`chat_${videoId}`);
            }
          } catch (e) {
            // Not a valid URL, skip
          }
        }
      } catch (error) {
        console.error('[Eureka AI] Error clearing cached chat:', error);
      }
      
      // Reset playful message flag
      this.playfulMessageShown = false;
      
      // Regenerate suggestions
      this.generateSuggestions();
    }

    async saveChatToCache(videoId) {
      if (!videoId || !this.container) return;
      
      const chatHistoryElements = this.container.querySelectorAll('.chat-message.user, .chat-message.assistant');
      const chatHistory = [];
      chatHistoryElements.forEach(el => {
        const isUser = el.classList.contains('user');
        const text = el.textContent.trim();
        if (text && !el.classList.contains('playful-message') && !el.classList.contains('usage-limit-message')) {
          chatHistory.push({
            role: isUser ? 'user' : 'assistant',
            content: text
          });
        }
      });
      
      if (chatHistory.length > 0) {
        const key = `chat_${videoId}`;
        const data = {
          content: chatHistory,
          timestamp: Date.now(),
          videoId: videoId
        };
        
        try {
          await chrome.storage.local.set({ [key]: data });
          console.log(`Saved chat for video ${videoId}`);
        } catch (error) {
          console.error('Error saving chat:', error);
        }
      }
    }

    async loadCachedChat(videoId) {
      if (!videoId || !this.container) return;
      
      const key = `chat_${videoId}`;
      try {
        const result = await chrome.storage.local.get([key]);
        const data = result[key];
        
        if (data && data.content && Array.isArray(data.content)) {
          // Clear existing messages (except playful message)
          const existingMessages = this.container.querySelectorAll('.chat-message:not(.playful-message)');
          existingMessages.forEach(msg => msg.remove());
          
          // Load cached messages
          data.content.forEach(msg => {
            this.addMessage(msg.content, msg.role === 'user');
          });
        }
      } catch (error) {
        console.error('Error loading cached chat:', error);
      }
    }
  }

  // Export to global scope
  window.ChatManager = ChatManager;
})();
