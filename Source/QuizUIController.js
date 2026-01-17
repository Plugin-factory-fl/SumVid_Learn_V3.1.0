/**
 * Quiz UI Controller Module
 * Handles quiz UI initialization and rendering
 */

(function() {
  'use strict';

  class QuizUIController {
    constructor(options = {}) {
      this.quizContainer = options.quizContainer;
      this.quizContent = options.quizContent;
      this.quizHeader = options.quizHeader;
      this.quizQuestionsContainer = options.quizQuestionsContainer;
      this.quizEmpty = options.quizEmpty;
      this.currentQuestionIndex = 0;
      this.totalQuestions = 0;
    }

    async initializeQuizUI() {
      const makeTestButton = document.getElementById('make-test-button');
      const regenerateQuizButton = document.getElementById('regenerate-quiz-button');
      
      if (!this.quizContainer || !makeTestButton) {
        console.warn('[Eureka AI] Quiz UI elements not found');
        return;
      }
      
      makeTestButton.addEventListener('click', async () => {
        await this.handleGenerateQuiz();
      });

      if (regenerateQuizButton) {
        regenerateQuizButton.addEventListener('click', async () => {
          await this.handleGenerateQuiz(true);
        });
      }
      
      await this.renderQuiz();
    }

    async handleGenerateQuiz(forceRegenerate = false) {
      const makeTestButton = document.getElementById('make-test-button');
      const regenerateQuizButton = document.getElementById('regenerate-quiz-button');
      
      if (!makeTestButton) return;

      const stored = await chrome.storage.local.get(['currentContentInfo', 'currentVideoInfo']);
      const contentInfo = stored.currentContentInfo || stored.currentVideoInfo;
      
      if (!contentInfo) {
        alert('No content available to generate quiz from.');
        return;
      }

      const contentType = contentInfo.type || 'video';
      const contentText = contentType === 'video' 
        ? (contentInfo.transcript || '')
        : (contentInfo.text || '');
      
      if (!contentText || contentText.length < 50) {
        alert('Content is too short to generate quiz. Please ensure you have a summary or transcript available.');
        return;
      }

      if (window.usageManager) {
        const limitReached = await window.usageManager.checkUsageLimit();
        if (limitReached) {
          alert('Daily enhancement limit reached. Your limit will reset tomorrow.');
          return;
        }
      }

      makeTestButton.disabled = true;
      makeTestButton.textContent = 'Generating...';
      
      if (this.quizContent) {
        this.quizContent.classList.remove('collapsed', 'hidden');
      }
      if (this.quizQuestionsContainer) {
        this.quizQuestionsContainer.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-secondary);">Generating questions...</p>';
        this.quizQuestionsContainer.classList.remove('hidden');
      }
      if (this.quizEmpty) {
        this.quizEmpty.classList.add('hidden');
      }
      if (this.quizContainer) {
        this.quizContainer.classList.remove('hidden');
      }

      if (window.showLoadingIndicator) {
        window.showLoadingIndicator(this.quizContainer);
      }

      try {
        const videoId = contentInfo.url ? this.getVideoId(contentInfo.url) : null;
        
        // Check for cached quiz (unless forcing regenerate)
        if (!forceRegenerate && videoId && window.contentGenerator) {
          const cachedQuiz = await window.contentGenerator.loadGeneratedContent(videoId, 'quiz');
          if (cachedQuiz) {
            await this.displayQuiz(cachedQuiz, videoId);
            if (regenerateQuizButton) regenerateQuizButton.style.display = 'block';
            makeTestButton.style.display = 'none';
            if (window.usageManager) {
              await window.usageManager.updateStatusCards();
            }
            return;
          }
        }

        // Get summary text if available
        let summaryText = '';
        if (videoId && window.contentGenerator) {
          const cachedSummary = await window.contentGenerator.loadGeneratedContent(videoId, 'summary');
          if (cachedSummary) {
            const summaryEl = document.querySelector('.summary-text');
            if (summaryEl) summaryText = summaryEl.textContent || summaryEl.innerText;
          }
        }

        // Generate new quiz
        const response = await chrome.runtime.sendMessage({
          action: 'generate-quiz',
          transcript: contentType === 'video' ? contentText : '',
          summary: summaryText,
          context: ''
        });

        if (response?.error) {
          throw new Error(response.error);
        }

        // Background script returns { success: true, questions } where questions is the HTML string
        // Handle both formats for compatibility: { quiz } or { questions }
        const quizHTML = response?.quiz || response?.questions;
        
        if (quizHTML && typeof quizHTML === 'string') {
          await this.displayQuiz(quizHTML, videoId);
          
          if (videoId && window.contentGenerator) {
            await window.contentGenerator.saveGeneratedContent(videoId, 'quiz', quizHTML);
          }
          
          if (regenerateQuizButton) regenerateQuizButton.style.display = 'block';
          makeTestButton.style.display = 'none';
          
          if (window.showCompletionBadge) {
            window.showCompletionBadge(this.quizContainer);
          }
          
          if (window.usageManager) {
            await window.usageManager.updateStatusCards();
          }
        } else {
          console.error('[QuizUIController] Invalid quiz response format:', response);
          throw new Error('Invalid quiz response format - expected quiz HTML string');
        }
      } catch (error) {
        console.error('[Eureka AI] Quiz generation error:', error);
        alert('Failed to generate quiz. Please try again.');
        if (this.quizQuestionsContainer) {
          this.quizQuestionsContainer.innerHTML = `<p style="text-align: center; padding: 20px; color: #e74c3c;">Failed to generate quiz: ${error.message}</p>`;
        }
      } finally {
        makeTestButton.disabled = false;
        makeTestButton.textContent = 'Make Test';
      }
    }

    async displayQuiz(quizHTML, videoId) {
      if (!this.quizQuestionsContainer) return;

      // Ensure empty state is hidden when quiz is displayed
      if (this.quizEmpty) {
        this.quizEmpty.classList.add('hidden');
        this.quizEmpty.style.display = 'none'; // Force hide with inline style
        this.quizEmpty.style.visibility = 'hidden';
        this.quizEmpty.style.opacity = '0';
      }

      // Insert quiz HTML into questions container (preserves structure)
      this.quizQuestionsContainer.innerHTML = quizHTML;
      this.quizQuestionsContainer.classList.remove('hidden');
      this.quizQuestionsContainer.style.display = ''; // Ensure visible

      // Initialize navigation and submit button
      this.initializeQuizNavigation();
      this.addSubmitButton();
    }

    async renderQuiz() {
      console.log('[QuizUIController] renderQuiz called');
      
      // CRITICAL: Ensure parent #video-info is visible before rendering
      const videoInfo = document.getElementById('video-info');
      if (videoInfo && videoInfo.classList.contains('hidden')) {
        console.warn('[QuizUIController] video-info has hidden class, removing it');
        videoInfo.classList.remove('hidden');
        videoInfo.style.setProperty('display', 'flex', 'important');
        videoInfo.style.setProperty('visibility', 'visible', 'important');
        videoInfo.style.setProperty('opacity', '1', 'important');
      }
      
      // ALWAYS re-find elements to ensure they exist
      this.quizQuestionsContainer = document.getElementById('quiz-questions-container');
      this.quizEmpty = document.getElementById('quiz-empty');
      this.quizContent = document.getElementById('quiz-content');
      this.quizContainer = document.getElementById('quiz-container');
      
      console.log('[QuizUIController] Elements found:', {
        questionsContainer: !!this.quizQuestionsContainer,
        empty: !!this.quizEmpty,
        content: !!this.quizContent,
        container: !!this.quizContainer
      });

      if (!this.quizQuestionsContainer || !this.quizEmpty) {
        console.error('[QuizUIController] Missing required elements');
        return;
      }

      // Check for cached quiz
      const stored = await chrome.storage.local.get(['currentContentInfo', 'currentVideoInfo']);
      const contentInfo = stored.currentContentInfo || stored.currentVideoInfo;
      const videoId = contentInfo?.url ? this.getVideoId(contentInfo.url) : null;

      if (videoId && window.contentGenerator) {
        const cachedQuiz = await window.contentGenerator.loadGeneratedContent(videoId, 'quiz');
        if (cachedQuiz && cachedQuiz.trim()) {
          console.log('[QuizUIController] Found cached quiz, displaying it');
          await this.displayQuiz(cachedQuiz, videoId);
          return;
        }
      }

      // No cached quiz - show empty state
      console.log('[QuizUIController] No cached quiz, showing empty state');
      
      // Remove conflicting inline styles - CSS will handle visibility when tab is active
      if (this.quizContent) {
        this.quizContent.style.removeProperty('display');
        this.quizContent.style.removeProperty('visibility');
        this.quizContent.style.removeProperty('opacity');
        this.quizContent.classList.remove('collapsed', 'hidden');
      }
      
      if (this.quizQuestionsContainer) {
        this.quizQuestionsContainer.innerHTML = '';
        this.quizQuestionsContainer.classList.add('hidden');
      }
      if (this.quizEmpty) {
        this.quizEmpty.classList.remove('hidden');
      }
      
      this.currentQuestionIndex = 0;
      this.totalQuestions = 0;
    }

    initializeQuizNavigation() {
      this.currentQuestionIndex = 0;
      const questions = this.quizQuestionsContainer?.querySelectorAll('.question');
      if (questions) {
        this.totalQuestions = questions.length;
        questions[0]?.classList.add('active');
      }
      
      // Add navigation buttons if they don't exist
      let navWrapper = this.quizQuestionsContainer?.querySelector('.quiz-navigation-wrapper');
      if (!navWrapper && this.quizQuestionsContainer) {
        const originalHTML = this.quizQuestionsContainer.innerHTML;
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
        
        this.quizQuestionsContainer.innerHTML = '';
        this.quizQuestionsContainer.appendChild(navWrapper);
        
        const newQuestions = contentWrapper.querySelectorAll('.question');
        if (newQuestions.length > 0) {
          newQuestions[0].classList.add('active');
        }
      }
      
      this.updateQuestionCounter();
      
      const prevButton = this.quizQuestionsContainer?.querySelector('#quiz-prev-button');
      const nextButton = this.quizQuestionsContainer?.querySelector('#quiz-next-button');
      
      // Remove old listeners and add new ones
      if (prevButton) {
        const newPrevButton = prevButton.cloneNode(true);
        prevButton.parentNode.replaceChild(newPrevButton, prevButton);
        newPrevButton.addEventListener('click', () => this.navigateQuestions(-1));
      }
      if (nextButton) {
        const newNextButton = nextButton.cloneNode(true);
        nextButton.parentNode.replaceChild(newNextButton, nextButton);
        newNextButton.addEventListener('click', () => this.navigateQuestions(1));
      }
      
      this.updateNavigationButtons();
    }

    navigateQuestions(direction) {
      const contentWrapper = this.quizQuestionsContainer?.querySelector('.quiz-content-wrapper');
      const questions = contentWrapper?.querySelectorAll('.question') || this.quizQuestionsContainer?.querySelectorAll('.question');
      if (!questions) return;

      questions[this.currentQuestionIndex]?.classList.remove('active');
      
      this.currentQuestionIndex = Math.max(0, Math.min(this.totalQuestions - 1, this.currentQuestionIndex + direction));
      
      questions[this.currentQuestionIndex]?.classList.add('active');
      this.updateQuestionCounter();
      this.updateNavigationButtons();
    }

    updateQuestionCounter() {
      const counter = this.quizQuestionsContainer?.querySelector('#questionCounter');
      if (counter) {
        counter.textContent = `Question ${this.currentQuestionIndex + 1}/${this.totalQuestions}`;
      }
    }

    updateNavigationButtons() {
      const prevButton = this.quizQuestionsContainer?.querySelector('#quiz-prev-button');
      const nextButton = this.quizQuestionsContainer?.querySelector('#quiz-next-button');
      
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
      const contentWrapper = this.quizQuestionsContainer?.querySelector('.quiz-content-wrapper');
      const questions = contentWrapper?.querySelectorAll('.question') || this.quizQuestionsContainer?.querySelectorAll('.question');
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
      const scoreEl = document.getElementById('quiz-results-score');
      if (!dialog || !messageEl) return;
      
      const percentage = Math.round((correctAnswers / totalQuestions) * 100);
      
      // Display score
      if (scoreEl) {
        scoreEl.textContent = `${correctAnswers}/${totalQuestions} (${percentage}%)`;
        scoreEl.className = 'quiz-results-score quiz-results-score--' + 
          (percentage === 100 ? 'win' : correctAnswers === 2 ? 'ok' : correctAnswers === 1 ? 'partial' : 'fail');
      }
      
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
      if (!this.quizQuestionsContainer) return;

      const submitButton = this.quizQuestionsContainer.querySelector('#submitQuiz');
      if (submitButton) {
        // Remove old listener and add new one
        const newSubmitButton = submitButton.cloneNode(true);
        submitButton.parentNode.replaceChild(newSubmitButton, submitButton);
        newSubmitButton.addEventListener('click', () => this.checkQuizAnswers());
      }
    }

    getVideoId(url) {
      try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('v');
      } catch (error) {
        console.error('Error parsing video URL:', error);
        return null;
      }
    }
  }

  // Export to global scope
  window.QuizUIController = QuizUIController;
})();
