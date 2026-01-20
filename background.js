// Backend API configuration
const BACKEND_URL = 'https://sumvid-learn-backend.onrender.com'; // Update with your backend URL

console.log('[Eureka AI] Background script loaded');

// Helper function to get JWT token from storage
async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['sumvid_auth_token'], (result) => {
      resolve(result.sumvid_auth_token || null);
    });
  });
}

// Helper function to save JWT token to storage
async function saveAuthToken(token) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ sumvid_auth_token: token }, () => {
      resolve();
    });
  });
}

// Helper function to remove auth token
async function clearAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['sumvid_auth_token'], () => {
      resolve();
    });
  });
}

// Helper function to make authenticated backend API calls
async function callBackendAPI(endpoint, method = 'POST', body = null) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Not authenticated. Please log in.');
  }

  const url = `${BACKEND_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  const options = {
    method,
    headers
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (response.status === 401) {
    // Token expired or invalid, clear it
    await clearAuthToken();
    throw new Error('Authentication expired. Please log in again.');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
}

let currentVideoInfo = null;
let transcriptCache = new Map();

// Helper to generate summary via backend API (supports video, webpage, PDF)
async function generateSummary(contentText, context, title, contentId, contentType = 'video') {
  const cleanContent = contentType === 'video' 
    ? contentText.replace(/\[\d+:\d+\]/g, '').replace(/\s+/g, ' ').trim()
    : contentText.replace(/\s+/g, ' ').trim();
    
  if (cleanContent.length < 10) {
    throw new Error(contentType === 'video' ? 'Transcript is too short or empty' : 'Content is too short or empty');
  }

  const requestBody = {
    contentType: contentType,
    context: context || '',
    title: title || (contentType === 'video' ? 'unknown video' : contentType === 'pdf' ? 'unknown document' : 'unknown page')
  };

  if (contentType === 'video') {
    requestBody.videoId = contentId || null;
    requestBody.transcript = cleanContent;
  } else {
    requestBody.text = cleanContent;
    if (contentType === 'pdf') {
      requestBody.contentUrl = contentId; // PDF URL
    }
  }

  const response = await callBackendAPI('/api/summarize', 'POST', requestBody);

  return response.summary;
}

// Helper to generate quiz via backend API
async function generateQuiz(transcript, summary, context, title, videoId) {
  const response = await callBackendAPI('/api/quiz', 'POST', {
    videoId: videoId || null,
    transcript: transcript || '',
    summary: summary || '',
    difficulty: context || '',
    title: title || 'unknown video'
  });

  const quiz = response.quiz;
  // Verify we got exactly 3 questions
  const questionCount = (quiz.match(/<div class="question">/g) || []).length;
  if (questionCount !== 3) {
    console.warn(`Generated ${questionCount} questions instead of 3`);
  }
  return quiz;
}

// Auto-generation removed - users must manually trigger generation via buttons

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle open side panel request
  // Note: sidePanel.open() must be called in response to a user gesture
  // This handler is kept for compatibility but may not work in all cases
  if (message.action === 'open-side-panel') {
    (async () => {
      try {
        // Try to open side panel, but this may fail if not in response to user gesture
        const tabId = sender.tab?.id;
        if (tabId) {
          try {
            await chrome.sidePanel.open({ tabId });
            sendResponse({ success: true });
          } catch (error) {
            // If opening fails, the side panel might already be open or user needs to click icon
            console.warn('[Eureka AI] Could not open side panel programmatically:', error.message);
            sendResponse({ success: false, error: 'Side panel must be opened via user gesture. Please click the extension icon.' });
          }
        } else {
          // If no tab ID, try to get current active tab
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]) {
            try {
              await chrome.sidePanel.open({ tabId: tabs[0].id });
              sendResponse({ success: true });
            } catch (error) {
              console.warn('[Eureka AI] Could not open side panel programmatically:', error.message);
              sendResponse({ success: false, error: 'Side panel must be opened via user gesture. Please click the extension icon.' });
            }
          } else {
            sendResponse({ success: false, error: 'No active tab found' });
          }
        }
      } catch (error) {
        console.error('[Eureka AI] Error opening side panel:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Handle open side panel and clarify in one action
  if (message.action === 'open-side-panel-and-clarify') {
    (async () => {
      try {
        const tabId = sender.tab?.id;
        
        // Try to open side panel (may fail if not in user gesture context, but we try anyway)
        if (tabId) {
          try {
            await chrome.sidePanel.open({ tabId });
          } catch (error) {
            console.warn('[Eureka AI] Could not open side panel programmatically:', error.message);
            // Continue anyway - sidebar might already be open
          }
        }
        
        // Store the clarify request in storage so sidebar can pick it up
        await chrome.storage.local.set({
          clarifyRequest: {
            text: message.text,
            timestamp: Date.now()
          }
        });
        
        // Also send message directly to sidebar if it's listening
        setTimeout(() => {
          chrome.runtime.sendMessage({
            action: 'selection-clarify',
            text: message.text
          }).catch(() => {
            // Sidebar might not be ready yet, that's okay - it will check storage
          });
        }, 300);
        
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Eureka AI] Error handling open-side-panel-and-clarify:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle clarify selected text - forward to sidebar
  if (message.action === 'clarify-selected-text') {
    (async () => {
      try {
        // Store the clarify request in storage so sidebar can pick it up
        await chrome.storage.local.set({
          clarifyRequest: {
            text: message.text,
            timestamp: Date.now()
          }
        });
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Eureka AI] Error storing clarify request:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === 'VIDEO_INFO' || message.type === 'CONTENT_INFO') {
    (async () => {
      try {
        const url = sanitizeInput(message.data?.url);
        if (!url) throw new Error('No URL provided');
        
        const contentType = message.data.type || 'video';
        
        // Store content info (handles video, webpage, PDF)
        const contentInfo = {
          ...message.data,
          type: contentType,
          title: sanitizeInput(message.data.title || 'Untitled'),
          timestamp: new Date().toISOString()
        };

        // Sanitize content text
        if (contentType === 'video' && message.data.transcript) {
          contentInfo.transcript = sanitizeInput(message.data.transcript);
        } else if ((contentType === 'webpage' || contentType === 'pdf') && message.data.text) {
          contentInfo.text = sanitizeInput(message.data.text);
        }

        // If PDF needs server-side extraction (Chrome PDF viewer), extract it now
        if (contentType === 'pdf' && message.data.needsServerExtraction && message.data.pdfUrl) {
          try {
            console.log('[Eureka AI] Extracting PDF text from URL:', message.data.pdfUrl);
            const extractResponse = await callBackendAPI('/api/extract-pdf-url', 'POST', {
              pdfUrl: message.data.pdfUrl
            });
            if (extractResponse.text) {
              contentInfo.text = sanitizeInput(extractResponse.text);
              contentInfo.needsServerExtraction = false; // Mark as extracted
              console.log('[Eureka AI] PDF text extracted successfully, length:', extractResponse.text.length);
            }
          } catch (error) {
            console.error('[Eureka AI] Failed to extract PDF text:', error);
            // Continue without text - user will see error when trying to use features
          }
        }

        // Store as currentContentInfo (replaces currentVideoInfo)
        await chrome.storage.local.set({ currentContentInfo: contentInfo });
        
        // Legacy support: also store as currentVideoInfo if it's a video
        if (contentType === 'video') {
          const videoId = new URL(url).searchParams.get('v');
          if (videoId) {
            currentVideoInfo = {
              ...contentInfo,
              channel: sanitizeInput(message.data.channel || 'Unknown Channel'),
              transcript: contentInfo.transcript || null
            };
            await chrome.storage.local.set({ currentVideoInfo });
            
            if (currentVideoInfo.transcript && !currentVideoInfo.error) {
              transcriptCache.set(videoId, currentVideoInfo.transcript);
            } else {
              chrome.action.setBadgeText({ text: 'X' });
              chrome.action.setBadgeBackgroundColor({ color: '#808080' });
            }
          }
        } else {
          // For webpages/PDFs, clear badge
          chrome.action.setBadgeText({ text: '' });
        }
        
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Eureka AI] Error processing content info:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.action === 'summarize') {
    (async () => {
      try {
        // Get current content info
        const stored = await chrome.storage.local.get(['currentContentInfo']);
        const contentInfo = stored.currentContentInfo || currentVideoInfo;
        
        if (!contentInfo) {
          throw new Error('No content available to summarize');
        }

        const contentType = contentInfo.type || 'video';
        const contentText = contentType === 'video' ? message.transcript || contentInfo.transcript : (message.text || contentInfo.text);
        
        if (!contentText) {
          throw new Error('No content text available');
        }

        const contentId = contentType === 'video' 
          ? (contentInfo.url ? new URL(contentInfo.url).searchParams.get('v') : null)
          : null;

        const summary = await generateSummary(contentText, message.context, contentInfo.title, contentId, contentType);
        sendResponse({ success: true, summary });
      } catch (error) {
        console.error('[Eureka AI] Summarization error:', error);
        sendResponse({ success: false, error: error.message || 'Failed to generate summary' });
      }
    })();
    return true;
  } else if (message.action === 'generate-quiz') {
    (async () => {
      try {
        // Get current content info (supports video, webpage, PDF)
        const stored = await chrome.storage.local.get(['currentContentInfo']);
        const contentInfo = stored.currentContentInfo || currentVideoInfo;
        
        if (!contentInfo) {
          throw new Error('No content available to generate quiz from');
        }

        const contentType = contentInfo.type || 'video';
        const videoId = contentType === 'video' && contentInfo.url 
          ? new URL(contentInfo.url).searchParams.get('v') 
          : null;
        
        // Get transcript or text based on content type
        const transcript = contentType === 'video' 
          ? (message.transcript || contentInfo.transcript || '')
          : null;
        const text = contentType !== 'video' 
          ? (message.text || contentInfo.text || '')
          : null;
        
        // Generate summary if not provided
        let summary = message.summary;
        if (!summary && (transcript || text)) {
          try {
            summary = await generateSummary(
              transcript || text || '',
              message.context || '',
              contentInfo.title || 'unknown',
              videoId,
              contentType
            );
          } catch (error) {
            console.warn('[Eureka AI] Could not generate summary for quiz:', error);
            // Continue without summary
          }
        }
        
        // Use transcript or text (whichever is available)
        const contentForQuiz = transcript || text || '';
        if (!contentForQuiz && !summary) {
          throw new Error('Transcript or summary is required');
        }
        
        const questions = await generateQuiz(contentForQuiz, summary, message.context, contentInfo.title || 'unknown', videoId);
        sendResponse({ success: true, questions });
      } catch (error) {
        console.error('Quiz generation error:', error);
        sendResponse({ success: false, error: error.message || 'Failed to generate quiz' });
      }
    })();
    return true;
  } else if (message.action === 'ask-question') {
    (async () => {
      try {
        // Get current content info
        const stored = await chrome.storage.local.get(['currentContentInfo']);
        const contentInfo = stored.currentContentInfo || currentVideoInfo;
        
        if (!contentInfo) {
          throw new Error('No content available for questions');
        }

        const contentType = contentInfo.type || 'video';
        const contentId = contentType === 'video' 
          ? (contentInfo.url ? new URL(contentInfo.url).searchParams.get('v') : null)
          : null;
        
        const contentText = contentType === 'video' 
          ? (message.transcript || contentInfo.transcript || '')
          : (message.text || contentInfo.text || '');

        const requestBody = {
          contentType: contentType,
          question: message.question,
          chatHistory: message.chatHistory || null,
          summary: message.summary || '',
          title: contentInfo.title || (contentType === 'video' ? 'unknown video' : contentType === 'pdf' ? 'unknown document' : 'unknown page')
        };

        if (contentType === 'video') {
          requestBody.videoId = contentId || null;
          requestBody.transcript = contentText;
        } else {
          requestBody.text = contentText;
          if (contentType === 'pdf') {
            requestBody.contentUrl = contentInfo.pdfUrl || contentInfo.url;
          }
        }

        const response = await callBackendAPI('/api/qa', 'POST', requestBody);
        sendResponse({ success: true, answer: response.answer });
      } catch (error) {
        console.error('[Eureka AI] Question answering error:', error);
        sendResponse({
          success: false,
          error: error.message || 'Failed to answer question'
        });
      }
    })();
    return true;
  } else if (message.action === 'generate-flashcards') {
    (async () => {
      try {
        // Get current content info
        const stored = await chrome.storage.local.get(['currentContentInfo']);
        const contentInfo = stored.currentContentInfo || currentVideoInfo;
        
        if (!contentInfo) {
          throw new Error('No content available to generate flashcards from');
        }

        const contentType = message.contentType || contentInfo.type || 'video';
        const contentText = contentType === 'video' 
          ? (message.transcript || contentInfo.transcript || '')
          : (message.text || contentInfo.text || '');

        if (!contentText) {
          throw new Error('No content text available');
        }

        const requestBody = {
          contentType: contentType,
          title: message.title || contentInfo.title || (contentType === 'video' ? 'unknown video' : contentType === 'pdf' ? 'unknown document' : 'unknown page')
        };

        if (contentType === 'video') {
          requestBody.transcript = contentText;
        } else {
          requestBody.text = contentText;
        }

        const response = await callBackendAPI('/api/flashcards', 'POST', requestBody);
        sendResponse({ success: true, flashcards: response.flashcards });
      } catch (error) {
        console.error('[Eureka AI] Flashcard generation error:', error);
        sendResponse({
          success: false,
          error: error.message || 'Failed to generate flashcards'
        });
      }
    })();
    return true;
  } else if (message.action === 'sidechat') {
    (async () => {
      try {
        // Get current content info for context if available
        const stored = await chrome.storage.local.get(['currentContentInfo']);
        const contentInfo = stored.currentContentInfo || currentVideoInfo;
        
        const requestBody = {
          message: message.message,
          chatHistory: message.chatHistory || []
        };

        // Add useVisionModel flag and image data if images/files are present
        if (message.useVisionModel) {
          requestBody.useVisionModel = true;
          if (message.imageData) {
            // Send image data as base64 data URL to backend
            requestBody.imageData = message.imageData;
            // Also try including it in multiple formats for backend compatibility
            requestBody.image = message.imageData; // Alternative field name
            requestBody.images = [message.imageData]; // Array format
            console.log('[Eureka AI] Including imageData in request, length:', message.imageData.length, 'bytes');
            console.log('[Eureka AI] imageData format:', message.imageData.substring(0, 50) + '...');
            console.log('[Eureka AI] Added imageData to requestBody.imageData, .image, and .images');
          } else {
            console.warn('[Eureka AI] useVisionModel is true but no imageData provided');
          }
        }
        
        console.log('[Eureka AI] Request body keys:', Object.keys(requestBody));
        console.log('[Eureka AI] Request body size:', JSON.stringify(requestBody).length, 'bytes');
        console.log('[Eureka AI] useVisionModel flag:', requestBody.useVisionModel);
        console.log('[Eureka AI] has imageData field:', !!requestBody.imageData);
        console.log('[Eureka AI] has image field:', !!requestBody.image);
        console.log('[Eureka AI] has images array:', Array.isArray(requestBody.images) && requestBody.images.length > 0);

        // Limit chat history size when images are present to prevent "request entity too large" errors
        // Images are large, so we need to be more aggressive with history truncation
        let chatHistoryToSend = message.chatHistory || [];
        if (message.useVisionModel && chatHistoryToSend.length > 0) {
          // Limit to last 5 messages when images are present to keep request size manageable
          const maxHistoryMessages = 5;
          if (chatHistoryToSend.length > maxHistoryMessages) {
            console.log(`[Eureka AI] Truncating chat history from ${chatHistoryToSend.length} to ${maxHistoryMessages} messages due to image presence`);
            chatHistoryToSend = chatHistoryToSend.slice(-maxHistoryMessages);
          }
          requestBody.chatHistory = chatHistoryToSend;
        }

        // Add context if provided (truncate to avoid token limits)
        // When images are present, reduce context even more to leave room for image data
        const maxContextLength = message.useVisionModel ? 1500 : 3000; // Less context when image is present
        if (message.context) {
          // Truncate context to leave room for chat history and image
          requestBody.context = message.context.length > maxContextLength
            ? message.context.substring(0, maxContextLength) + '\n[Note: Context truncated for length.]'
            : message.context;
        } else if (contentInfo) {
          // Auto-include content context for better responses (truncated)
          const contentType = contentInfo.type || 'webpage';
          const contentText = contentType === 'video'
            ? (contentInfo.transcript || '')
            : (contentInfo.text || '');

          if (contentText) {
            // Truncate to leave room for image data
            requestBody.context = contentText.substring(0, maxContextLength);
            if (contentText.length > maxContextLength) {
              requestBody.context += '\n[Note: Content truncated for length.]';
            }
          }
        }

        // Check request size before sending
        const requestSize = JSON.stringify(requestBody).length;
        console.log(`[Eureka AI] Final request size: ${requestSize} bytes (${Math.round(requestSize / 1024)} KB)`);
        
        // Warn if request is getting large (most servers have ~1MB limit)
        if (requestSize > 800 * 1024) { // 800KB
          console.warn(`[Eureka AI] Request size is large (${Math.round(requestSize / 1024)} KB), may cause "request entity too large" error`);
        }

        const response = await callBackendAPI('/api/chat', 'POST', requestBody);
        sendResponse({ success: true, reply: response.reply });
      } catch (error) {
        console.error('[Eureka AI] Sidechat error:', error);
        sendResponse({
          success: false,
          error: error.message || 'Failed to send message'
        });
      }
    })();
    return true;
  } else if (message.type === 'AUTH_TOKEN') {
    // Handle auth token updates from login menu
    (async () => {
      try {
        if (message.token) {
          await saveAuthToken(message.token);
          sendResponse({ success: true });
        } else if (message.action === 'clear') {
          await clearAuthToken();
          sendResponse({ success: true });
        } else {
          const token = await getAuthToken();
          sendResponse({ success: true, token });
        }
      } catch (error) {
        console.error('Auth token error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.action === 'selection-explain' || 
             message.action === 'selection-summarize' || 
             message.action === 'selection-flashcard' || 
             message.action === 'selection-notes') {
    // Handle selection toolbar actions
    // These actions will route to sidebar functionality
    // For now, just send message to sidebar (will be handled when sidebar is open)
    chrome.storage.local.set({ 
      pendingSelectionAction: {
        action: message.action,
        text: message.text,
        timestamp: Date.now()
      }
    });
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'capture-screenshot') {
    // Handle screenshot capture - forward to content script for cropping
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) {
          sendResponse({ success: false, error: 'No active tab found' });
          return;
        }
        
        // Capture visible tab
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
          format: 'png',
          quality: 100
        });
        
        // Send to content script to crop
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'crop-screenshot',
          imageData: dataUrl,
          bounds: message.bounds
        }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(response || { success: false, error: 'No response from content script' });
          }
        });
      } catch (error) {
        console.error('[Eureka AI] Screenshot capture error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.action === 'screenshot-captured') {
    // Store screenshot in storage for sidebar to pick up
    (async () => {
      await chrome.storage.local.set({
        capturedScreenshot: {
          imageData: message.imageData,
          timestamp: Date.now()
        }
      });
      sendResponse({ success: true });
    })();
    return true;
  }
  return true;
});

// Use setPanelBehavior to automatically open side panel when icon is clicked
// This is the recommended approach for Manifest V3 side panels

// Enable side panel globally (without tabId) - must be done first
chrome.sidePanel.setOptions({ enabled: true }).then(() => {
  console.log('[Eureka AI] Side panel enabled globally');
  
  // Set panel behavior to automatically open when action icon is clicked
  // This must be called AFTER enabling globally
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).then(() => {
    console.log('[Eureka AI] Side panel behavior set');
  }).catch(error => {
    console.warn('[Eureka AI] Could not set side panel behavior:', error);
  });
}).catch(err => {
  console.warn('[Eureka AI] Could not enable side panel globally:', err);
});

// Track tabs - don't clear content info, extension works on all pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Content info will be updated by content script when page changes
  }
});

// Enable side panel globally when extension starts
chrome.runtime.onStartup.addListener(async () => {
  try {
    // Enable globally first, then set behavior
    await chrome.sidePanel.setOptions({ enabled: true });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    console.log('[Eureka AI] Side panel enabled and behavior set on startup');
  } catch (error) {
    console.warn('[Eureka AI] Could not set side panel on startup:', error);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  transcriptCache.clear();
  chrome.storage.local.remove('currentVideoInfo');
  chrome.action.setBadgeText({ text: '' });
  
  // Enable globally first, then set behavior
  try {
    await chrome.sidePanel.setOptions({ enabled: true });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    console.log('[Eureka AI] Side panel enabled and behavior set on install');
  } catch (error) {
    console.warn('[Eureka AI] Could not set side panel on install:', error);
  }
  
  chrome.storage.local.get(['darkMode'], (result) => {
    if (result.darkMode === undefined) {
      chrome.storage.local.set({ darkMode: false });
    }
  });
});