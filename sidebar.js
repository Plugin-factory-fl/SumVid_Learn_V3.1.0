const DEFAULT_CONTEXT = {
  summary: '', // 5th grade, 200-400 words is default prompt
  quiz: ''    // 'easy' is default
};

document.addEventListener('DOMContentLoaded', async () => {
  // Check if chrome.runtime is available
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    console.error('Chrome runtime not available - extension may not be properly loaded');
    document.body.innerHTML = '<div style="padding: 20px; text-align: center; color: red;">Extension not properly loaded. Please refresh the page.</div>';
    return;
  }

  const loadingState = document.getElementById('loading');
  const noVideoState = document.getElementById('no-video');
  const videoInfoState = document.getElementById('video-info');
  const videoTitle = document.getElementById('video-title');
  const channelName = document.getElementById('channel-name');
  const summaryContainer = document.getElementById('summary-container');
  const summaryContent = document.getElementById('summary-content');
  const summaryHeader = document.getElementById('summary-header');
  const collapseButton = document.querySelector('.collapse-button');
  const themeToggle = document.getElementById('theme-toggle');
  const flashcardContainer = document.getElementById('flashcard-container');
  const flashcardContent = document.getElementById('flashcard-content');
  const flashcardHeader = document.getElementById('flashcard-header');
  const flashcardList = document.getElementById('flashcard-list');
  const flashcardEmpty = document.getElementById('flashcard-empty');

  const quizContainer = document.getElementById('quiz-container');
  const quizContent = document.getElementById('quiz-content');
  const quizHeader = document.getElementById('quiz-header');

  const chatSection = document.getElementById('chat-section');
  const questionInput = document.getElementById('question-input');
  const sendQuestionButton = document.getElementById('send-question');
  const chatMessages = document.getElementById('chat-messages');
  const chatSuggestions = document.getElementById('chat-suggestions');
  
  // Tab system
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  let activeTab = 'chat';
  
  const summaryContextBar = document.getElementById('summary-context-bar');
  const summaryContextInput = document.getElementById('summary-context-input');
  const summaryContextSubmit = document.getElementById('summary-context-submit');
  const quizContextBar = document.getElementById('quiz-context-bar');
  const quizContextInput = document.getElementById('quiz-context-input');
  const quizContextSubmit = document.getElementById('quiz-context-submit');
  
  let currentVideoInfo = null;
  let currentQuestionIndex = 0;
  let totalQuestions = 0;
  let userContext = { summary: '', quiz: '' };
  let currentFlashcardIndex = 0;
  let currentFlashcardSet = null;

  // Memory management constants
  const CACHE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  // Function to get video ID from URL
  function getVideoId(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.get('v');
    } catch (error) {
      console.error('Error parsing video URL:', error);
      return null;
    }
  }

  // Content caching functions (delegated to ContentGenerator)
  async function saveGeneratedContent(videoId, type, content) {
    if (contentGenerator) {
      await contentGenerator.saveGeneratedContent(videoId, type, content);
    }
  }

  async function loadGeneratedContent(videoId, type) {
    if (contentGenerator) {
      return await contentGenerator.loadGeneratedContent(videoId, type);
    }
    return null;
  }

  // Function to show tooltip on regenerate quiz button
  function showRegenerateTooltip() {
    const regenerateButton = document.getElementById('regenerate-quiz-button');
    if (!regenerateButton) return;

    // Remove any existing tooltip
    const existingTooltip = document.querySelector('.regenerate-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'regenerate-tooltip';
    tooltip.textContent = 'Generate a new quiz!';
    
    // Position tooltip relative to button
    document.body.appendChild(tooltip);
    
    const buttonRect = regenerateButton.getBoundingClientRect();
    tooltip.style.position = 'fixed';
    tooltip.style.top = (buttonRect.bottom + 8) + 'px';
    tooltip.style.left = (buttonRect.left - 60) + 'px'; // More centered positioning
    
    // Show tooltip with animation
    setTimeout(() => {
      tooltip.classList.add('show');
    }, 100);

    // Hide tooltip when user hovers over it (indicates they've seen it)
    const hideTooltip = () => {
      tooltip.classList.remove('show');
      setTimeout(() => {
        tooltip.remove();
      }, 300);
      tooltip.removeEventListener('mouseenter', hideTooltip);
      document.removeEventListener('click', hideTooltip);
    };

    // Hide on hover (user acknowledgment) or click anywhere
    tooltip.addEventListener('mouseenter', hideTooltip);
    setTimeout(() => {
      document.addEventListener('click', hideTooltip);
    }, 500);
  }

  // Function to send message with timeout and retries
  async function sendMessageWithTimeout(message, maxRetries = 3) {
    return new Promise((resolve) => {
      let retryCount = 0;

      function attemptSend() {
        try {
          // Check if chrome.runtime is available
          if (typeof chrome === 'undefined' || !chrome.runtime) {
            console.warn('Chrome runtime not available');
            resolve({ error: 'Chrome runtime not available' });
            return;
          }

          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
              console.warn('Chrome runtime error in tabs.query:', chrome.runtime.lastError);
              handleRetry();
              return;
            }

            if (!tabs?.[0]?.id) {
              console.warn('No active tab found');
              resolve({ error: 'No active tab found' });
              return;
            }
            
            chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
              if (chrome.runtime.lastError) {
                console.warn('Chrome runtime error in sendMessage:', chrome.runtime.lastError);
                handleRetry();
                return;
              }
              resolve(response || { success: true });
            });
          });
        } catch (error) {
          console.warn('Error sending message:', error);
          handleRetry();
        }
      }

      function handleRetry() {
        retryCount++;
        if (retryCount < maxRetries) {
          console.log(`Retrying message send (attempt ${retryCount + 1}/${maxRetries})...`);
          setTimeout(attemptSend, 1000 * retryCount); // Exponential backoff
        } else {
          resolve({ error: 'Failed to send message after multiple attempts' });
        }
      }

      attemptSend();
    });
  }

  // Utility functions - make globally accessible for modules
  function showLoadingIndicator(container) {
    const statusIndicator = container?.querySelector('.status-indicator');
    if (statusIndicator) {
      const spinner = statusIndicator.querySelector('.loading-spinner');
      const badge = statusIndicator.querySelector('.completion-badge');
      if (spinner && badge) {
        spinner.style.display = 'block';
        badge.style.display = 'none';
      }
    }
  }
  window.showLoadingIndicator = showLoadingIndicator;

  function showCompletionBadge(container) {
    const statusIndicator = container?.querySelector('.status-indicator');
    if (statusIndicator) {
      const spinner = statusIndicator.querySelector('.loading-spinner');
      const badge = statusIndicator.querySelector('.completion-badge');
      if (spinner && badge) {
        spinner.style.display = 'none';
        badge.style.display = 'block';
      }
    }
  }
  window.showCompletionBadge = showCompletionBadge;


  // Theme, collapse, and playful message handling (delegated to UIController)
  // UIController handles all UI state management

  function addChatMessage(message, isUser = false) {
    if (chatManager) {
      chatManager.addMessage(message, isUser);
    } else {
      // Fallback if ChatManager not initialized yet
      const messageElement = document.createElement('div');
      messageElement.className = `chat-message ${isUser ? 'user' : 'assistant'}`;
      messageElement.textContent = message;
      chatMessages?.appendChild(messageElement);
      if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }
  }
  
  // Chat suggestions functionality (delegated to ChatManager after initialization)
  async function generateChatSuggestions() {
    if (chatManager) {
      await chatManager.generateSuggestions();
    }
  }
  
  function hideChatSuggestions() {
    if (chatManager) {
      chatManager.hideSuggestions();
    }
  }
  
  // Generate suggestions on load and when content changes (after manager init)
  setTimeout(() => {
    if (chatManager) {
      chatManager.generateSuggestions();
    }
  }, 100);
  
  // Screenshot preview functions (delegated to ChatManager)
  // ChatManager handles all screenshot preview functionality
  

  // Function to save current chat to cache (delegated to ChatManager)
  async function saveChatToCache() {
    if (chatManager) {
      await chatManager.saveChatToCache();
    }
  }

  // Function to load cached chat (delegated to ChatManager)
  async function loadCachedChat(videoId) {
    if (chatManager) {
      await chatManager.loadCachedChat(videoId);
    }
  }

  // Function to load cached quiz (delegated to ContentGenerator)
  async function loadCachedQuiz(videoId, transcript, summary) {
    if (contentGenerator) {
      await contentGenerator.loadCachedQuiz(videoId, transcript, summary);
    }
  }

  // Generate quiz questions (delegated to ContentGenerator after initialization)
  async function generateQuiz(transcript, summary, context = '') {
    if (contentGenerator) {
      await contentGenerator.generateQuiz(transcript, summary, context, currentVideoInfo, userContext);
    }
  }

  // Handle question submission (delegated to ChatManager)
  async function handleQuestionSubmit() {
    if (chatManager) {
      await chatManager.handleSubmit();
    } else {
      console.warn('[Eureka AI] ChatManager not initialized yet');
    }
  }
  
  // Event listeners for question input (ChatManager handles these internally, but keep for fallback)
  // Note: ChatManager sets up its own event listeners in init()

  // Placeholder rotation (delegated to ChatManager after initialization)
  // ChatManager handles placeholder rotation internally

  // Get Pro button text alternation (delegated to UsageManager after initialization)

  // Info button handler
  const infoButton = document.getElementById('eureka-info-btn');
  const infoDialog = document.getElementById('eureka-info-dialog');
  const infoDialogGetProBtn = document.getElementById('info-dialog-get-pro-btn');
  
  if (infoButton && infoDialog) {
    infoButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      infoDialog.showModal();
    });
  }

  // Info dialog close handlers
  if (infoDialog) {
    const closeButtons = infoDialog.querySelectorAll('.modal__close, button[value="cancel"]');
    closeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        infoDialog.close();
      });
    });

    infoDialog.addEventListener('click', (e) => {
      if (e.target === infoDialog) {
        infoDialog.close();
      }
    });

    infoDialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        infoDialog.close();
      }
    });
  }

  // File Upload functionality (delegated to FileManager after initialization)
  // FileManager will handle all file upload, screenshot, and read button functionality
  
  // Tab switching functionality (delegated to TabManager)
  function switchTab(tabName) {
    if (tabManager) {
      tabManager.switchTab(tabName);
    }
  }
  
  // Function to get combined context (delegated to FileManager after initialization)
  async function getCombinedContext() {
    if (fileManager) {
      return await fileManager.getCombinedContext();
    }
    // Fallback
    return '';
  }

  // Info dialog GET PRO button handler
  if (infoDialogGetProBtn) {
    infoDialogGetProBtn.addEventListener('click', async () => {
      const BACKEND_URL = 'https://sumvid-learn-backend.onrender.com';
      const stored = await chrome.storage.local.get(['sumvid_auth_token']);
      const token = stored.sumvid_auth_token;
      
      if (!token) {
        alert('Please log in to upgrade to Pro');
        return;
      }

      // Disable button to prevent double-clicks
      infoDialogGetProBtn.disabled = true;
      const originalText = infoDialogGetProBtn.textContent;
      infoDialogGetProBtn.textContent = 'Loading...';

      try {
        console.log('[Info Dialog Get Pro] Creating checkout session...');
        const response = await fetch(`${BACKEND_URL}/api/checkout/create-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
        });

        console.log('[Info Dialog Get Pro] Response status:', response.status);
        
        if (!response.ok) {
          let errorMessage = `Server error: ${response.status}`;
          try {
            const errorData = await response.json();
            console.error('[Info Dialog Get Pro] Error response:', errorData);
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (parseError) {
            const text = await response.text().catch(() => '');
            console.error('[Info Dialog Get Pro] Non-JSON error response:', text);
            errorMessage = text || errorMessage;
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log('[Info Dialog Get Pro] Checkout session created:', data);
        
        if (data.url) {
          window.open(data.url, '_blank');
          // Reset button after successful checkout session creation
          infoDialogGetProBtn.disabled = false;
          infoDialogGetProBtn.textContent = originalText;
          infoDialog.close();
        } else {
          console.warn('[Info Dialog Get Pro] No checkout URL in response:', data);
          alert('Upgrade feature coming soon!');
          infoDialogGetProBtn.disabled = false;
          infoDialogGetProBtn.textContent = originalText;
        }
      } catch (error) {
        console.error('[Info Dialog Get Pro] Error details:', error);
        const errorMessage = error.message || 'Unknown error occurred';
        alert(`Failed to initiate upgrade: ${errorMessage}`);
        infoDialogGetProBtn.disabled = false;
        infoDialogGetProBtn.textContent = originalText;
      }
    });
  }

  // Helper functions for info center (delegated to ContentGenerator after initialization)
  function formatDuration(seconds) {
    if (contentGenerator) {
      return contentGenerator.formatDuration(seconds);
    }
    // Fallback
    if (!seconds) return '--:--';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  function calculateReadingTime(text, returnRawMinutes = false) {
    if (contentGenerator) {
      return contentGenerator.calculateReadingTime(text, returnRawMinutes);
    }
    // Fallback
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

  function updateInfoCenter(videoDuration, summaryText) {
    if (contentGenerator) {
      contentGenerator.updateInfoCenter(videoDuration, summaryText);
    }
  }

  // Summary generation (delegated to ContentGenerator)
  async function summarizeText(text, forceRegenerate = false, context = '') {
    if (!contentGenerator) {
      console.warn('[Eureka AI] ContentGenerator not initialized, cannot generate summary');
      return;
    }
    
    // Get current video info from contentDisplayManager if available
    let videoInfo = currentVideoInfo;
    let contextObj = userContext;
    
    if (contentDisplayManager) {
      const managerVideoInfo = contentDisplayManager.getCurrentVideoInfo();
      if (managerVideoInfo) {
        videoInfo = managerVideoInfo;
      }
      const managerContext = contentDisplayManager.getUserContext();
      if (managerContext) {
        contextObj = managerContext;
      }
    }
    
    await contentGenerator.generateSummary(text, forceRegenerate, context, videoInfo, contextObj);
  }
  
  // Export to window for ButtonHandlers and other modules
  window.summarizeText = summarizeText;

  // Quiz functions (delegated to ContentGenerator)
  function checkQuizAnswers() {
    if (contentGenerator) {
      contentGenerator.checkQuizAnswers();
    }
  }
  
  function showQuizResultsDialog(correctAnswers, totalQuestions) {
    if (contentGenerator) {
      contentGenerator.showQuizResultsDialog(correctAnswers, totalQuestions);
    }
  }

  function addSubmitButton() {
    if (contentGenerator) {
      contentGenerator.addSubmitButton();
    }
  }

  function initializeQuizNavigation() {
    if (contentGenerator) {
      contentGenerator.initializeQuizNavigation();
    }
  }

  function navigateQuestions(direction) {
    if (contentGenerator) {
      contentGenerator.navigateQuestions(direction);
    }
  }

  function updateQuestionCounter() {
    if (contentGenerator) {
      contentGenerator.updateQuestionCounter();
    }
  }

  function updateNavigationButtons() {
    if (contentGenerator) {
      contentGenerator.updateNavigationButtons();
    }
  }
  
  // Content display and initialization (delegated to ContentDisplayManager)
  // ContentDisplayManager handles all content info display and initialization
  
  // Info dialogs and auto-login (delegated to InfoDialogsManager)
  // InfoDialogsManager handles all info dialogs and auto-login functionality
  
  // Initialize managers
  let chatManager, contentGenerator, tabManager, usageManager, fileManager, flashcardUIController, notesUIController, contentDisplayManager;
  
  function initializeManagers() {
    // Initialize ChatManager
    if (window.ChatManager) {
      chatManager = new window.ChatManager(
        chatMessages,
        questionInput,
        sendQuestionButton,
        chatSuggestions,
        chatSection
      );
      window.chatManager = chatManager; // Make globally accessible
    }
    
    // Initialize ContentGenerator
    if (window.ContentGenerator) {
      contentGenerator = new window.ContentGenerator({
        summaryContainer: summaryContainer,
        summaryContent: summaryContent,
        summaryHeader: summaryHeader,
        quizContainer: quizContainer,
        quizContent: quizContent,
        quizHeader: quizHeader
      });
      window.contentGenerator = contentGenerator; // Make globally accessible
    }
    
    // Initialize TabManager
    if (window.TabManager) {
      tabManager = new window.TabManager(tabButtons, tabContents);
      window.tabManager = tabManager; // Make globally accessible
      
      // Listen for chat suggestion actions to trigger tab switches
      window.addEventListener('chat-suggestion-action', async (e) => {
        const { action } = e.detail;
        if (action === 'summarize') {
          tabManager.switchTab('summarize');
          // Wait a bit for tab switch to complete
          await new Promise(resolve => setTimeout(resolve, 100));
          const summarizeButton = document.getElementById('summarize-button');
          if (summarizeButton && !summarizeButton.disabled) {
            summarizeButton.click();
          } else if (!summarizeButton) {
            console.warn('[Eureka AI] Summarize button not found');
          } else if (summarizeButton.disabled) {
            console.warn('[Eureka AI] Summarize button is disabled');
          }
        } else if (action === 'flashcards') {
          tabManager.switchTab('flashcards');
          await new Promise(resolve => setTimeout(resolve, 100));
          const flashcardButton = document.getElementById('generate-flashcard-button');
          if (flashcardButton && !flashcardButton.disabled) {
            flashcardButton.click();
          }
        } else if (action === 'quiz') {
          tabManager.switchTab('quiz');
          await new Promise(resolve => setTimeout(resolve, 100));
          const quizButton = document.getElementById('make-test-button');
          if (quizButton && !quizButton.disabled) {
            quizButton.click();
          }
        }
      });
    }
    
    // Initialize UsageManager
    if (window.UsageManager) {
      usageManager = new window.UsageManager({
        getProButton: document.getElementById('get-pro-button')
      });
      window.usageManager = usageManager; // Make globally accessible
    }
    
    // Initialize FileManager
    if (window.FileManager) {
      fileManager = new window.FileManager({
        uploadButton: document.getElementById('upload-file-button'),
        fileInput: document.getElementById('file-upload-input'),
        fileUploadStatus: document.getElementById('file-upload-status'),
        screenshotButton: document.getElementById('screenshot-button'),
        readButton: document.getElementById('read-button')
      });
      window.fileManager = fileManager; // Make globally accessible
    }
    
    // Initialize ContentDisplayManager
    if (window.ContentDisplayManager) {
      contentDisplayManager = new window.ContentDisplayManager({
        loadingState: loadingState,
        noVideoState: noVideoState,
        videoInfoState: videoInfoState,
        videoTitle: videoTitle,
        channelName: channelName
      });
      window.contentDisplayManager = contentDisplayManager; // Make globally accessible
    }
    
    // Initialize ButtonHandlers (after ContentDisplayManager)
    if (window.ButtonHandlers && contentDisplayManager) {
      const buttonHandlers = new window.ButtonHandlers({
        contentDisplayManager: contentDisplayManager,
        summaryContainer: summaryContainer,
        summaryContent: summaryContent,
        quizContainer: quizContainer,
        quizContent: quizContent,
        chatMessages: chatMessages
      });
      window.buttonHandlers = buttonHandlers; // Make globally accessible
      console.log('[sidebar.js] ButtonHandlers initialized');
    } else {
      console.warn('[sidebar.js] ButtonHandlers or ContentDisplayManager not available', {
        hasButtonHandlers: !!window.ButtonHandlers,
        hasContentDisplayManager: !!contentDisplayManager
      });
    }
    
    // Initialize FlashcardUIController
    if (window.FlashcardUIController) {
      flashcardUIController = new window.FlashcardUIController({
        flashcardContainer: flashcardContainer,
        flashcardContent: flashcardContent,
        flashcardList: flashcardList,
        flashcardEmpty: flashcardEmpty
      });
      window.flashcardUIController = flashcardUIController; // Make globally accessible
      console.log('[sidebar.js] FlashcardUIController initialized:', {
        container: !!flashcardContainer,
        content: !!flashcardContent,
        list: !!flashcardList,
        empty: !!flashcardEmpty
      });
    }
    
    // Initialize NotesUIController
    if (window.NotesUIController) {
      const notesList = document.getElementById('notes-list');
      const noteEmpty = document.getElementById('note-empty');
      notesUIController = new window.NotesUIController({
        notesContainer: document.getElementById('notes-container'),
        notesContent: document.getElementById('notes-content'),
        notesList: notesList,
        noteEmpty: noteEmpty
      });
      window.notesUIController = notesUIController; // Make globally accessible
      console.log('[sidebar.js] NotesUIController initialized:', {
        container: !!notesUIController.notesContainer,
        content: !!notesUIController.notesContent,
        list: !!notesUIController.notesList,
        empty: !!notesUIController.noteEmpty
      });
    }
    
    // Initialize ClarifyHandler
    if (window.ClarifyHandler) {
      const clarifyHandler = new window.ClarifyHandler({
        chatMessages: chatMessages,
        questionInput: questionInput
      });
      window.clarifyHandler = clarifyHandler; // Make globally accessible
      console.log('[sidebar.js] ClarifyHandler initialized');
    } else {
      console.warn('[sidebar.js] ClarifyHandler module not loaded');
    }
  }
  
  // Initialize modules (wait a bit to ensure scripts are loaded)
  let moduleRetryCount = 0;
  const MAX_MODULE_RETRIES = 10;
  
  function initializeModules() {
    // Wait for DOM to be fully ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeModules);
      return;
    }
    
    if (window.SettingsPanel) {
      try {
        window.SettingsPanel.initializeSettings();
        window.SettingsPanel.registerSettingsHandlers();
      } catch (error) {
        console.error('[Eureka AI] Error initializing SettingsPanel:', error);
      }
    } else {
      console.warn('[Eureka AI] SettingsPanel module not loaded');
    }
    if (window.LoginMenu) {
      window.LoginMenu.initializeLoginMenu();
      window.LoginMenu.registerAccountHandlers();
    } else {
      moduleRetryCount++;
      if (moduleRetryCount < MAX_MODULE_RETRIES) {
        console.warn(`[Eureka AI] LoginMenu module not loaded, retrying... (${moduleRetryCount}/${MAX_MODULE_RETRIES})`);
        setTimeout(initializeModules, 200);
        return;
      } else {
        console.error('[Eureka AI] LoginMenu module failed to load after max retries');
      }
    }
    if (!window.UsageTracker) {
      console.warn('[Eureka AI] UsageTracker module not loaded');
    }
    if (window.SumVidNotesManager) {
      window.SumVidNotesManager.init();
      initializeNotesUI();
    } else {
      console.warn('[Eureka AI] SumVidNotesManager module not loaded');
    }
    if (window.SumVidFlashcardMaker) {
      window.SumVidFlashcardMaker.init();
      initializeFlashcardUI();
    } else {
      console.warn('[Eureka AI] SumVidFlashcardMaker module not loaded');
    }
    
    // Initialize managers after other modules are loaded
    initializeManagers();
    
    // Initialize extension after managers are initialized
    initializeExtension();
  }
  
  // Flashcard UI (delegated to FlashcardUIController)
  async function initializeFlashcardUI() {
    if (flashcardUIController) {
      await flashcardUIController.initializeFlashcardUI();
    }
  }
  
  // Notes UI initialization
  // Notes UI (delegated to NotesUIController)
  async function initializeNotesUI() {
    if (notesUIController) {
      await notesUIController.initializeNotesUI();
    }
  }
  
  // Try immediately, then retry if needed
  setTimeout(initializeModules, 100);

  // Freemium uses counter (top of sidebar)
  function updateUsesCounter(usage, subscriptionStatus) {
    if (usageManager) {
      usageManager.updateUsesCounter(usage, subscriptionStatus);
    }
  }

  // Usage tracking functions (delegated to UsageManager)
  async function updateStatusCards() {
    if (usageManager) {
      await usageManager.updateStatusCards();
    }
  }
  
  // Initialize status cards after managers are loaded
  setTimeout(() => {
    if (usageManager) {
      usageManager.updateStatusCards();
    }
  }, 500);

  async function checkUsageLimit() {
    if (usageManager) {
      return await usageManager.checkUsageLimit();
    }
    // Fallback
    if (window.UsageTracker) {
      return await window.UsageTracker.isLimitReached();
    }
    return false;
  }

  // Button handlers (delegated to ButtonHandlers)
  // ButtonHandlers handles all button click events
  
  // Content display functions (delegated to ContentDisplayManager)
  async function displayVideoInfo(contentInfo) {
    if (contentDisplayManager) {
      await contentDisplayManager.displayVideoInfo(contentInfo);
    }
  }

  async function displayVideoInfoFromCache(videoInfo, videoId, cachedSummary, cachedQuiz, cachedChat) {
    if (contentDisplayManager) {
      await contentDisplayManager.displayVideoInfoFromCache(videoInfo, videoId, cachedSummary, cachedQuiz, cachedChat);
    }
  }

  function showState(stateElement) {
    if (contentDisplayManager) {
      contentDisplayManager.showState(stateElement);
    }
  }

  async function initializeExtension() {
    if (contentDisplayManager) {
      await contentDisplayManager.initializeExtension();
    }
  }
  
  // Listen for content info updates
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    // Handle content info updates from content script
    if (changes.currentContentInfo?.newValue) {
      const newContentInfo = changes.currentContentInfo.newValue;
      displayVideoInfo(newContentInfo);
    } else if (changes.currentVideoInfo?.newValue) {
      // Legacy support for currentVideoInfo
      const newVideoInfo = changes.currentVideoInfo.newValue;
        displayVideoInfo(newVideoInfo);
      }

    // Note: clarify requests are now handled by the message listener
    // This storage listener is disabled to prevent duplicate messages
    // The background script sends a direct message instead
    // if (changes.clarifyRequest?.newValue) {
    //   // Disabled to prevent duplicate message handling
    // }
  });
  
  // Regenerate button handlers (delegated to ButtonHandlers)
  // ButtonHandlers handles all regenerate button functionality

  // Function to ensure event listeners are properly attached
  function ensureEventListeners() {
    // Event listeners are already attached above, this function is kept for compatibility
    // but no longer needs to re-attach since handlers are set up properly
    
    // Setup status upgrade button handler (upgrade-button in account dialog is handled by LoginMenu.js)
    const statusUpgradeBtn = document.getElementById('status-upgrade-btn');
    if (statusUpgradeBtn && !statusUpgradeBtn.dataset.listenerAttached) {
      statusUpgradeBtn.dataset.listenerAttached = 'true';
      statusUpgradeBtn.addEventListener('click', async () => {
        const BACKEND_URL = 'https://sumvid-learn-backend.onrender.com';
        try {
          const stored = await chrome.storage.local.get(['sumvid_auth_token']);
          const token = stored.sumvid_auth_token;
          
          if (!token) {
            alert('Please log in to upgrade to Pro');
            return;
          }

          const response = await fetch(`${BACKEND_URL}/api/checkout/create-session`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || errorData.message || `Server error: ${response.status}`);
          }

          const data = await response.json();
          if (data.url) {
            window.open(data.url, '_blank');
          } else {
            alert('Upgrade feature coming soon!');
          }
        } catch (error) {
          console.error('Upgrade error:', error);
          alert(`Failed to initiate upgrade: ${error.message}. Please try again later.`);
        }
      });
    }
  }

  // Clarify handler (delegated to ClarifyHandler)
  // ClarifyHandler handles all selection-clarify messages
});