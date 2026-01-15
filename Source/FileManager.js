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
      this.readButton = options.readButton;
      
      this.init();
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
      
      // Read button
      if (this.readButton) {
        this.readButton.addEventListener('click', () => {
          this.readWebpage();
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

    async handleFileUpload(file) {
      if (!this.fileUploadStatus) return;
      
      this.fileUploadStatus.style.display = 'inline-block';
      this.fileUploadStatus.textContent = `Uploading ${file.name}...`;
      this.fileUploadStatus.classList.remove('loaded');

      try {
        const result = await this.processUploadedFile(file);

        // Store in chrome.storage.local
        await chrome.storage.local.set({
          uploadedFileContext: {
            text: result.text || '',
            imageData: result.imageData || '',
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
