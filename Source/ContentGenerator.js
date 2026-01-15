/**
 * Content Generator Module
 * Handles summary and quiz generation, content caching, and info center updates
 */

(function() {
  'use strict';

  const CACHE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours

  class ContentGenerator {
    constructor(options = {}) {
      this.summaryContainer = options.summaryContainer;
      this.summaryContent = options.summaryContent;
      this.summaryHeader = options.summaryHeader;
      this.quizContainer = options.quizContainer;
      this.quizContent = options.quizContent;
      this.quizHeader = options.quizHeader;
      this.currentQuestionIndex = 0;
      this.totalQuestions = 0;
      
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
            
            // Load cached chat and quiz
            if (window.chatManager && typeof window.chatManager.loadCachedChat === 'function') {
              await window.chatManager.loadCachedChat(videoId);
            }
            await this.loadCachedQuiz(videoId, text, cachedSummary);
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

    async generateQuiz(transcript, summary, context = '', currentVideoInfo, userContext) {
      if (!this.quizContainer || !this.quizContent) return;

      try {
        const videoId = currentVideoInfo ? this.getVideoId(currentVideoInfo.url) : null;
        
        // Check for cached quiz
        if (videoId) {
          const cachedQuiz = await this.loadGeneratedContent(videoId, 'quiz');
          if (cachedQuiz) {
            this.quizContent.style.display = 'block';
            this.quizContent.innerHTML = cachedQuiz;
            this.initializeQuizNavigation();
            this.addSubmitButton();
            if (window.showCompletionBadge) {
              window.showCompletionBadge(this.quizContainer);
            }
            return;
          }
        }

        // Generate new quiz
        this.quizContainer.classList.remove('hidden');
        this.quizContent.style.display = 'block';
        this.quizContent.innerHTML = 'Generating questions...';
        
        if (window.showLoadingIndicator) {
          window.showLoadingIndicator(this.quizContainer);
        }

        const effectiveContext = context || (userContext?.quiz || '');
        
        // Use transcript or summary, whichever is available
        const contentToUse = transcript || summary || '';
        if (!contentToUse) {
          throw new Error('Transcript or summary is required');
        }

        const response = await chrome.runtime.sendMessage({
          action: 'generate-quiz',
          transcript: transcript || '',
          summary: summary || '',
          context: effectiveContext
        });

        if (response?.error) {
          throw new Error(response.error);
        }

        if (response?.quiz) {
          this.quizContent.innerHTML = response.quiz;
          
          if (videoId) {
            await this.saveGeneratedContent(videoId, 'quiz', response.quiz);
          }
          
          this.initializeQuizNavigation();
          this.addSubmitButton();
          
          if (window.showCompletionBadge) {
            window.showCompletionBadge(this.quizContainer);
          }
        } else {
          throw new Error('Invalid quiz response format');
        }
      } catch (error) {
        console.error('Quiz generation error:', error);
        if (this.quizContent) {
          this.quizContent.innerHTML = `Failed to generate quiz: ${error.message}`;
        }
      }
    }

    async loadCachedQuiz(videoId, transcript, summary) {
      if (!videoId || !this.quizContent) return;
      
      const cachedQuiz = await this.loadGeneratedContent(videoId, 'quiz');
      if (cachedQuiz) {
        this.quizContent.style.display = 'block';
        this.quizContent.innerHTML = cachedQuiz;
        this.quizContent.classList.add('collapsed');
        if (this.quizHeader) {
          this.quizHeader.querySelector('.collapse-button')?.classList.add('collapsed');
        }
        this.initializeQuizNavigation();
        this.addSubmitButton();
        if (window.showCompletionBadge) {
          window.showCompletionBadge(this.quizContainer);
        }
      }
    }

    initializeQuizNavigation() {
      this.currentQuestionIndex = 0;
      const questions = this.quizContent?.querySelectorAll('.question');
      if (questions) {
        this.totalQuestions = questions.length;
        questions[0]?.classList.add('active');
      }
      
      // Add navigation buttons if they don't exist
      let navWrapper = this.quizContent?.querySelector('.quiz-navigation-wrapper');
      if (!navWrapper && this.quizContent) {
        const originalHTML = this.quizContent.innerHTML;
        navWrapper = document.createElement('div');
        navWrapper.className = 'quiz-navigation-wrapper';
        
        const prevButton = document.createElement('button');
        prevButton.id = 'quiz-prev-button';
        prevButton.className = 'quiz-nav-button quiz-nav-button--prev';
        prevButton.innerHTML = '←';
        prevButton.setAttribute('aria-label', 'Previous question');
        
        const nextButton = document.createElement('button');
        nextButton.id = 'quiz-next-button';
        nextButton.className = 'quiz-nav-button quiz-nav-button--next';
        nextButton.innerHTML = '→';
        nextButton.setAttribute('aria-label', 'Next question');
        
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'quiz-content-wrapper';
        contentWrapper.innerHTML = originalHTML;
        
        navWrapper.appendChild(prevButton);
        navWrapper.appendChild(contentWrapper);
        navWrapper.appendChild(nextButton);
        
        this.quizContent.innerHTML = '';
        this.quizContent.appendChild(navWrapper);
        
        const newQuestions = contentWrapper.querySelectorAll('.question');
        if (newQuestions.length > 0) {
          newQuestions[0].classList.add('active');
        }
      }
      
      this.updateQuestionCounter();
      
      const prevButton = this.quizContent?.querySelector('#quiz-prev-button');
      const nextButton = this.quizContent?.querySelector('#quiz-next-button');
      
      if (prevButton) {
        prevButton.addEventListener('click', () => this.navigateQuestions(-1));
      }
      if (nextButton) {
        nextButton.addEventListener('click', () => this.navigateQuestions(1));
      }
      
      this.updateNavigationButtons();
    }

    navigateQuestions(direction) {
      const contentWrapper = this.quizContent?.querySelector('.quiz-content-wrapper');
      const questions = contentWrapper?.querySelectorAll('.question') || this.quizContent?.querySelectorAll('.question');
      if (!questions) return;

      questions[this.currentQuestionIndex]?.classList.remove('active');
      
      this.currentQuestionIndex = Math.max(0, Math.min(this.totalQuestions - 1, this.currentQuestionIndex + direction));
      
      questions[this.currentQuestionIndex]?.classList.add('active');
      this.updateQuestionCounter();
      this.updateNavigationButtons();
    }

    updateQuestionCounter() {
      const counter = this.quizContent?.querySelector('#questionCounter');
      if (counter) {
        counter.textContent = `Question ${this.currentQuestionIndex + 1}/${this.totalQuestions}`;
      }
    }

    updateNavigationButtons() {
      const prevButton = this.quizContent?.querySelector('#quiz-prev-button');
      const nextButton = this.quizContent?.querySelector('#quiz-next-button');
      
      if (prevButton) {
        prevButton.disabled = this.currentQuestionIndex === 0;
        prevButton.style.opacity = this.currentQuestionIndex === 0 ? '0.5' : '1';
      }
      if (nextButton) {
        nextButton.disabled = this.currentQuestionIndex === this.totalQuestions - 1;
        nextButton.style.opacity = this.currentQuestionIndex === this.totalQuestions - 1 ? '0.5' : '1';
      }
    }

    checkQuizAnswers() {
      const contentWrapper = this.quizContent?.querySelector('.quiz-content-wrapper');
      const questions = contentWrapper?.querySelectorAll('.question') || this.quizContent?.querySelectorAll('.question');
      if (!questions) return;

      let correctAnswers = 0;
      const totalQuestions = questions.length;

      questions.forEach((question) => {
        const selectedAnswer = question.querySelector('input[type="radio"]:checked');
        const correctAnswer = question.querySelector('.correct-answer')?.textContent;
        const allOptions = question.querySelectorAll('.quiz-option-button, label[for*="option"]');
        
        allOptions.forEach(option => {
          option.classList.remove('quiz-answer-correct', 'quiz-answer-incorrect');
          option.style.border = '';
        });
        
        if (correctAnswer) {
          allOptions.forEach(option => {
            const optionText = option.textContent.trim() || option.querySelector('span')?.textContent.trim();
            if (optionText === correctAnswer) {
              option.classList.add('quiz-answer-correct');
              option.style.border = '2px solid #10b981';
            }
          });
        }
        
        if (selectedAnswer) {
          const selectedLabel = selectedAnswer.closest('label') || selectedAnswer.parentElement;
          if (selectedLabel) {
            if (selectedAnswer.value === correctAnswer) {
              correctAnswers++;
              selectedLabel.classList.add('quiz-answer-correct');
              selectedLabel.style.border = '2px solid #10b981';
            } else {
              selectedLabel.classList.add('quiz-answer-incorrect');
              selectedLabel.style.border = '2px solid #ef4444';
            }
          }
        }
      });

      this.showQuizResultsDialog(correctAnswers, totalQuestions);
    }

    showQuizResultsDialog(correctAnswers, totalQuestions) {
      const dialog = document.getElementById('quiz-results-dialog');
      const messageEl = document.getElementById('quiz-results-message');
      if (!dialog || !messageEl) return;
      
      const percentage = Math.round((correctAnswers / totalQuestions) * 100);
      let message = '';
      
      if (percentage === 100) {
        message = 'YOU WON!';
      } else if (correctAnswers === 2) {
        message = 'YOU DID OK';
      } else if (correctAnswers === 1) {
        message = 'AT LEAST YOU KNEW ONE THING!';
      } else {
        message = 'YOU COULDN\'T BE MORE WRONG!';
      }
      
      messageEl.textContent = message;
      messageEl.className = 'quiz-results-message quiz-results-message--' + 
        (percentage === 100 ? 'win' : correctAnswers === 2 ? 'ok' : correctAnswers === 1 ? 'partial' : 'fail');
      
      dialog.showModal();
    }

    addSubmitButton() {
      if (!this.quizContent) return;

      const submitButton = this.quizContent.querySelector('#submitQuiz');
      if (submitButton) {
        submitButton.addEventListener('click', () => this.checkQuizAnswers());
      }
    }
  }

  // Export to global scope
  window.ContentGenerator = ContentGenerator;
})();
