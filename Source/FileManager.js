/**
 * File Manager Module
 * Handles file upload, screenshot capture, and read button functionality
 */

(function() {
  'use strict';

  const BACKEND_URL = 'https://sumvid-learn-backend.onrender.com';

  class FileManager {
    constructor(options = {}) {
      this.uploadButton = options.uploadButton;
      this.fileInput = options.fileInput;
      this.fileUploadStatus = options.fileUploadStatus;
      this.screenshotButton = options.screenshotButton;
      
      this.init();
    }

    /**
     * Compress image to reduce file size before sending to backend
     * @param {string} imageData - Base64 data URL
     * @param {number} maxWidth - Maximum width in pixels (default: 1024)
     * @param {number} maxHeight - Maximum height in pixels (default: 1024)
     * @param {number} quality - JPEG quality 0-1 (default: 0.8)
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
      // File upload button
      if (this.uploadButton && this.fileInput) {
        this.uploadButton.addEventListener('click', () => {
          this.fileInput.click();
        });
        
        this.fileInput.addEventListener('change', (e) => {
          const file = e.target.files?.[0];
          if (file) {
            this.handleFileUpload(file);
          }
        });
      }
      
      // Screenshot button
      if (this.screenshotButton) {
        this.screenshotButton.addEventListener('click', () => {
          this.captureScreenshot();
        });
      }
    }

    async processUploadedFile(file) {
      const formData = new FormData();
      formData.append('file', file);
      
      try {
        const stored = await chrome.storage.local.get(['sumvid_auth_token']);
        const token = stored.sumvid_auth_token;
        
        const headers = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(`${BACKEND_URL}/api/process-file`, {
          method: 'POST',
          headers: headers,
          body: formData
        });
        
        if (!response.ok) {
          throw new Error(`Failed to process file: ${response.statusText}`);
        }
        
        const result = await response.json();
        return result;
      } catch (error) {
        console.error('[Eureka AI] Error processing file:', error);
        throw error;
      }
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
      const dialog = document.createElement('dialog');
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
      
      // Add to body if not already there
      if (!document.getElementById('upload-limit-dialog')) {
        document.body.appendChild(dialog);
      }
      
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
      
      dialog.showModal();
    }

    async handleFileUpload(file) {
      if (!this.fileUploadStatus) return;
      
      // Check upload limit for free users
      const limitCheck = await this.checkUploadLimit();
      if (!limitCheck.allowed) {
        await this.showUpgradeDialog(limitCheck.message);
        return;
      }
      
      this.fileUploadStatus.style.display = 'inline-block';
      this.fileUploadStatus.textContent = `Uploading ${file.name}...`;
      this.fileUploadStatus.classList.remove('loaded');

      try {
        const result = await this.processUploadedFile(file);
        
        // Compress image data if present before storing
        let compressedImageData = result.imageData || '';
        if (compressedImageData && file.type?.startsWith('image/')) {
          compressedImageData = await this.compressImage(compressedImageData);
        }
        
        // Update last upload timestamp after successful upload
        await chrome.storage.local.set({
          lastFileUploadTimestamp: Date.now()
        });

        // Store in chrome.storage.local
        await chrome.storage.local.set({
          uploadedFileContext: {
            text: result.text || '',
            imageData: compressedImageData,
            filename: file.name,
            fileType: file.type,
            timestamp: Date.now()
          }
        });

        // Update status
        if (this.fileUploadStatus) {
          this.fileUploadStatus.textContent = `File loaded: ${file.name}`;
          this.fileUploadStatus.classList.add('loaded');
        }

        console.log('[Eureka AI] File uploaded and processed successfully');
      } catch (error) {
        console.error('[Eureka AI] Error uploading file:', error);
        alert(`Failed to upload file: ${error.message}`);
        if (this.fileUploadStatus) {
          this.fileUploadStatus.style.display = 'none';
        }
      }
    }

    captureScreenshot() {
      // Send message to content script to start screenshot mode
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'start-screenshot' });
        }
      });
    }

    async readWebpage() {
      try {
        // Send message to content script to extract full webpage content
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'extract-full-content' });
          }
        });
        
        // Add a message to chat indicating the page is being read
        if (window.chatManager) {
          window.chatManager.addMessage('Reading entire webpage for context...', true);
        }
      } catch (error) {
        console.error('[Eureka AI] Error reading webpage:', error);
      }
    }

    async getCombinedContext() {
      try {
        // Get current content info
        const [contentInfo, fileContext, fullPageContext] = await Promise.all([
          chrome.storage.local.get(['currentContentInfo', 'currentVideoInfo']),
          chrome.storage.local.get(['uploadedFileContext']),
          chrome.storage.local.get(['fullPageContext'])
        ]);
        
        const currentContent = contentInfo.currentContentInfo || contentInfo.currentVideoInfo;
        const uploadedFile = fileContext.uploadedFileContext;
        const fullPage = fullPageContext.fullPageContext;
        
        let contextParts = [];
        
        // Add current content (transcript, text, etc.)
        if (currentContent) {
          if (currentContent.transcript) {
            // Truncate transcript to avoid token limits
            const truncated = currentContent.transcript.substring(0, 8000);
            contextParts.push(`Video/Content Transcript: ${truncated}`);
          } else if (currentContent.text) {
            const truncated = currentContent.text.substring(0, 8000);
            contextParts.push(`Webpage/PDF Content: ${truncated}`);
          }
        }
        
        // Add uploaded file context
        if (uploadedFile) {
          if (uploadedFile.text) {
            const truncated = uploadedFile.text.substring(0, 8000);
            contextParts.push(`Uploaded File (${uploadedFile.filename}): ${truncated}`);
          } else if (uploadedFile.imageData) {
            contextParts.push(`Uploaded Image: ${uploadedFile.filename} (image data available)`);
          }
        }
        
        // Add full page context from Read button
        if (fullPage) {
          const fullPageText = typeof fullPage === 'string' ? fullPage : (fullPage.text || '');
          if (fullPageText) {
            const truncated = fullPageText.substring(0, 8000);
            contextParts.push(`Full Webpage Content: ${truncated}`);
          }
        }
        
        return contextParts.join('\n\n');
      } catch (error) {
        console.error('[Eureka AI] Error getting combined context:', error);
        return '';
      }
    }
  }

  // Export to global scope
  window.FileManager = FileManager;
})();
