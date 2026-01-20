/**
 * API Routes
 * Handles AI API calls for summaries, quizzes, and Q&A
 */

import express from 'express';
import { authenticate } from '../config/auth.js';
import { query } from '../config/database.js';
import { resetDailyUsageIfNeeded, incrementUsage } from '../config/usage.js';

const router = express.Router();

// All API routes require authentication
router.use(authenticate);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn('[API] Warning: OPENAI_API_KEY not configured');
}

/**
 * Helper function to call OpenAI API
 */
async function callOpenAI(messages, maxTokens = 1500, temperature = 0.7) {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: maxTokens,
      temperature: temperature
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * POST /api/summarize
 * Generate summary for video, webpage, or PDF
 */
router.post('/summarize', async (req, res) => {
  try {
    const { videoId, transcript, context, title, contentType, contentUrl } = req.body;
    const userId = req.user.userId;

    // Validate content type
    const validContentTypes = ['video', 'webpage', 'pdf'];
    const type = contentType || 'video'; // Default to video for backward compatibility
    
    if (!validContentTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid contentType. Must be one of: ${validContentTypes.join(', ')}` });
    }

    // Get content text (transcript for video, text for webpage/pdf)
    const contentText = transcript || req.body.text || req.body.content;
    if (!contentText) {
      return res.status(400).json({ error: 'Content text is required' });
    }

    // Check usage limit before generation
    await resetDailyUsageIfNeeded(userId);
    const usageResult = await query(
      'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
      [userId]
    );

    if (usageResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = usageResult.rows[0];
    if (user.enhancements_used >= user.enhancements_limit) {
      return res.status(403).json({
        error: 'Daily enhancement limit reached',
        enhancementsUsed: user.enhancements_used,
        enhancementsLimit: user.enhancements_limit
      });
    }

    // Increment usage before generation
    const incrementResult = await incrementUsage(userId);
    if (!incrementResult.success) {
      return res.status(403).json({
        error: incrementResult.error || 'Failed to increment usage',
        usage: incrementResult.usage
      });
    }

    // Clean content text
    let cleanContent = contentText;
    if (type === 'video') {
      // Remove timestamps from video transcripts
      cleanContent = contentText.replace(/\[\d+:\d+\]/g, '').replace(/\s+/g, ' ').trim();
    } else {
      // Clean whitespace for webpages/PDFs
      cleanContent = contentText.replace(/\s+/g, ' ').trim();
    }

    if (cleanContent.length < 10) {
      return res.status(400).json({ error: 'Content is too short or empty' });
    }

    // Calculate target word count based on content type
    const contentWordCount = cleanContent.split(/\s+/).length;
    let targetWordCount;
    let maxTokens;

    if (type === 'video') {
      // Video: similar to existing logic
      const estimatedVideoMinutes = contentWordCount / 150;
      const targetReadingMinutes = estimatedVideoMinutes / 10;
      targetWordCount = Math.round(targetReadingMinutes * 150);
      targetWordCount = Math.max(300, Math.min(2000, targetWordCount));
    } else {
      // Webpage/PDF: summarize to 10-20% of original
      targetWordCount = Math.round(contentWordCount * 0.15);
      targetWordCount = Math.max(200, Math.min(2000, targetWordCount));
    }

    maxTokens = Math.round(targetWordCount * 1.2);

    // Generate system prompt based on content type
    const contextPrompt = context ? `\n\nAdditional context: ${context}` : '';
    let systemPrompt;

    if (type === 'video') {
      systemPrompt = `Summarize this video about ${title || 'the topic'} for a 5th grader, aiming for about ${targetWordCount} words. Use <h4> for headings and <strong> for important terms.${contextPrompt}`;
    } else if (type === 'webpage') {
      systemPrompt = `Summarize this webpage "${title || 'article'}" for a 5th grader, aiming for about ${targetWordCount} words. Use <h4> for headings and <strong> for important terms. Keep it simple and easy to understand.${contextPrompt}`;
    } else if (type === 'pdf') {
      systemPrompt = `Summarize this PDF document "${title || 'document'}" for a 5th grader, aiming for about ${targetWordCount} words. Use <h4> for headings and <strong> for important terms. Keep it simple and easy to understand.${contextPrompt}`;
    }

    const summary = await callOpenAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: cleanContent }
    ], maxTokens);

    // Get updated usage
    const updatedUsageResult = await query(
      'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
      [userId]
    );
    const updatedUsage = updatedUsageResult.rows[0];

    res.json({
      summary,
      contentType: type,
      usage: {
        enhancementsUsed: updatedUsage.enhancements_used,
        enhancementsLimit: updatedUsage.enhancements_limit,
        remaining: Math.max(0, updatedUsage.enhancements_limit - updatedUsage.enhancements_used)
      }
    });
  } catch (error) {
    console.error('Summarize error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate summary' });
  }
});

/**
 * POST /api/quiz
 * Generate quiz questions
 */
router.post('/quiz', async (req, res) => {
  try {
    const { videoId, transcript, summary, difficulty, title } = req.body;
    const userId = req.user.userId;

    if (!transcript && !summary) {
      return res.status(400).json({ error: 'Transcript or summary is required' });
    }

    // Check usage limit before generation
    await resetDailyUsageIfNeeded(userId);
    const usageResult = await query(
      'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
      [userId]
    );

    if (usageResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = usageResult.rows[0];
    if (user.enhancements_used >= user.enhancements_limit) {
      return res.status(403).json({
        error: 'Daily enhancement limit reached',
        enhancementsUsed: user.enhancements_used,
        enhancementsLimit: user.enhancements_limit
      });
    }

    // Increment usage before generation
    const incrementResult = await incrementUsage(userId);
    if (!incrementResult.success) {
      return res.status(403).json({
        error: incrementResult.error || 'Failed to increment usage',
        usage: incrementResult.usage
      });
    }

    // Truncate transcript/summary aggressively to avoid token limits
    // Rough estimate: 4 chars per token, so 4000 chars ≈ 1000 tokens
    // System prompt is ~500 tokens, so we have ~1500 tokens left for content
    const maxTranscriptLength = 4000; // ~1000 tokens
    const maxSummaryLength = 1000; // ~250 tokens
    const truncatedTranscript = transcript ? transcript.substring(0, maxTranscriptLength) : '';
    const truncatedSummary = summary ? summary.substring(0, maxSummaryLength) : '';
    
    // Use summary if available (shorter), otherwise use truncated transcript
    const contentToUse = truncatedSummary || truncatedTranscript;
    
    if (!contentToUse) {
      return res.status(400).json({ error: 'Transcript or summary is required' });
    }
    
    // Generate quiz
    const contextToUse = difficulty ? `\n\nThe user requests: ${difficulty} difficulty` : '';
    const systemPrompt = `You are making a quiz about content (video, webpage, or document). Create EXACTLY 3 multiple-choice questions that a 5th grader can understand.${contextToUse}
Topic: ${title || 'unknown topic'}
Follow these rules:
1. Make EXACTLY 3 questions
2. Use simple words and short sentences
3. Ask about the main ideas from the video
4. Make questions clear and easy to understand
5. Focus on the important parts
6. Use words that a 5th grader knows
7. Each question needs 3 choices (A, B, C)
8. Only one answer should be right
9. Wrong answers should make sense but be clearly wrong
10. Use this exact format for each question:
<div class="question">
  <p class="question-text">1. Your question text here?</p>
  <div class="answers">
    <label class="answer">
      <input type="radio" name="q1" value="a">
      <span>Answer A</span>
    </label>
    <label class="answer">
      <input type="radio" name="q1" value="b">
      <span>Answer B</span>
    </label>
    <label class="answer">
      <input type="radio" name="q1" value="c">
      <span>Answer C</span>
    </label>
  </div>
  <div class="correct-answer" style="display: none;">a</div>
</div>

11. After all questions, add this navigation structure:
<div class="quiz-navigation">
  <span id="questionCounter">Question 1/3</span>
  <div class="quiz-nav-controls">
    <button id="prevQuestion" class="nav-button" disabled>&lt;</button>
    <button id="nextQuestion" class="nav-button">&gt;</button>
    <button id="submitQuiz" class="submit-quiz">Submit Quiz</button>
  </div>
</div>

- Use q1, q2, q3 for the radio button names
- Use a, b, c for the radio button values
- Include the correct answer in the hidden div
- Number questions 1, 2, 3
- Make all 3 questions in one response
- Check that you have exactly 3 questions`;

    // Use truncated content to avoid token limits
    const content = truncatedSummary 
      ? `Content Summary: ${truncatedSummary}${contextToUse}` 
      : `Content Transcript: ${truncatedTranscript}${contextToUse}`;

    const quiz = await callOpenAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: content }
    ], 1500);

    // Verify we got exactly 3 questions
    const questionCount = (quiz.match(/<div class="question">/g) || []).length;
    if (questionCount !== 3) {
      console.warn(`[API] Generated ${questionCount} questions instead of 3`);
    }

    // Get updated usage
    const updatedUsageResult = await query(
      'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
      [userId]
    );
    const updatedUsage = updatedUsageResult.rows[0];

    res.json({
      quiz,
      usage: {
        enhancementsUsed: updatedUsage.enhancements_used,
        enhancementsLimit: updatedUsage.enhancements_limit,
        remaining: Math.max(0, updatedUsage.enhancements_limit - updatedUsage.enhancements_used)
      }
    });
  } catch (error) {
    console.error('Quiz generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate quiz' });
  }
});

/**
 * POST /api/qa
 * Answer questions about video, webpage, or PDF
 */
router.post('/qa', async (req, res) => {
  try {
    const { videoId, transcript, question, chatHistory, summary, title, contentType, text, contentUrl } = req.body;
    const userId = req.user.userId;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Determine content type
    const type = contentType || 'video'; // Default to video for backward compatibility
    const contentText = type === 'video' ? (transcript || '') : (text || '');

    if (!contentText && !summary) {
      return res.status(400).json({ error: 'Content text or summary is required' });
    }

    // Check usage limit before generation
    await resetDailyUsageIfNeeded(userId);
    const usageResult = await query(
      'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
      [userId]
    );

    if (usageResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = usageResult.rows[0];
    if (user.enhancements_used >= user.enhancements_limit) {
      return res.status(403).json({
        error: 'Daily enhancement limit reached',
        enhancementsUsed: user.enhancements_used,
        enhancementsLimit: user.enhancements_limit
      });
    }

    // Increment usage before generation
    const incrementResult = await incrementUsage(userId);
    if (!incrementResult.success) {
      return res.status(403).json({
        error: incrementResult.error || 'Failed to increment usage',
        usage: incrementResult.usage
      });
    }

    // Build system message based on content type
    let systemContent;
    const contentTitle = title || (type === 'video' ? 'unknown video' : type === 'pdf' ? 'unknown document' : 'unknown page');
    
    if (type === 'video') {
      systemContent = `You are helping a 5th grader understand a YouTube video titled "${contentTitle}". Give short, simple answers that are easy to understand. Use basic words and short sentences. If you're not sure about something, just say so in a simple way.`;
    } else if (type === 'webpage') {
      systemContent = `You are helping a 5th grader understand a webpage titled "${contentTitle}". Give short, simple answers that are easy to understand. Use basic words and short sentences. If you're not sure about something, just say so in a simple way.`;
    } else if (type === 'pdf') {
      systemContent = `You are helping a 5th grader understand a PDF document titled "${contentTitle}". Give short, simple answers that are easy to understand. Use basic words and short sentences. If you're not sure about something, just say so in a simple way.`;
    }

    systemContent += `

Rules:
1. Keep answers short (2-3 sentences if possible)
2. Use words that a 5th grader knows
3. Break down complex ideas into simple parts
4. Use examples when it helps
5. Be friendly and encouraging
6. If you need to use a big word, explain what it means
7. Focus on the main points
8. Keep explanations clear and direct`;

    // Build messages array with chat history
    const messages = [
      {
        role: 'system',
        content: systemContent
      }
    ];

    // Add chat history if provided
    if (chatHistory && Array.isArray(chatHistory)) {
      chatHistory.forEach(msg => {
        if (msg.role && msg.content) {
          messages.push({ role: msg.role, content: msg.content });
        }
      });
    }

    // Add current context
    const contentLabel = type === 'video' ? 'Video' : type === 'pdf' ? 'PDF document' : 'Webpage';
    const contextContent = summary
      ? `${contentLabel} content: ${contentText || ''}\n\n${contentLabel} summary: ${summary}\n\nQuestion: ${question}`
      : `${contentLabel} content: ${contentText}\n\nQuestion: ${question}`;

    messages.push({ role: 'user', content: contextContent });

    // Generate answer
    const answer = await callOpenAI(messages, 150, 0.7);

    // Get updated usage
    const updatedUsageResult = await query(
      'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
      [userId]
    );
    const updatedUsage = updatedUsageResult.rows[0];

    res.json({
      answer,
      contentType: type,
      usage: {
        enhancementsUsed: updatedUsage.enhancements_used,
        enhancementsLimit: updatedUsage.enhancements_limit,
        remaining: Math.max(0, updatedUsage.enhancements_limit - updatedUsage.enhancements_used)
      }
    });
  } catch (error) {
    console.error('Q&A error:', error);
    res.status(500).json({ error: error.message || 'Failed to answer question' });
  }
});

/**
 * POST /api/chat
 * Simple ChatGPT chat (no context from video/webpage)
 * Supports vision model for image analysis
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, chatHistory, context, useVisionModel, imageData, image, images } = req.body;
    const userId = req.user.userId;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check usage limit before generation
    await resetDailyUsageIfNeeded(userId);
    const usageResult = await query(
      'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
      [userId]
    );

    if (usageResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = usageResult.rows[0];
    if (user.enhancements_used >= user.enhancements_limit) {
      return res.status(403).json({
        error: 'Daily enhancement limit reached',
        enhancementsUsed: user.enhancements_used,
        enhancementsLimit: user.enhancements_limit
      });
    }

    // Increment usage before generation
    const incrementResult = await incrementUsage(userId);
    if (!incrementResult.success) {
      return res.status(403).json({
        error: incrementResult.error || 'Failed to increment usage',
        usage: incrementResult.usage
      });
    }

    // Check if vision model is needed (image present)
    const hasImage = useVisionModel && (imageData || image || (Array.isArray(images) && images.length > 0));
    const imageToUse = imageData || image || (Array.isArray(images) && images[0]);
    
    console.log(`[API Chat] Vision request: useVisionModel=${useVisionModel}, hasImage=${hasImage}, imageDataLength=${imageToUse?.length || 0}`);

    // Build system message with context if provided
    // Truncate context aggressively to avoid token limits
    // Chat history can be long, so we need to be conservative with context
    const maxContextLength = 3000; // ~750 tokens, leaving room for chat history
    const truncatedContext = context ? context.substring(0, maxContextLength) : '';
    
    let systemContent = `You are a helpful AI assistant. Give clear, concise answers. Keep responses simple and easy to understand.`;
    
    // Add vision capabilities notice if image is present
    if (hasImage) {
      systemContent += `\n\nIMPORTANT: You CAN view and analyze images. When the user sends you an image, you can see it and describe what's in it. `;
      systemContent += `You can read text in images, identify objects, analyze screenshots, and answer questions about image content. `;
      systemContent += `Do NOT say you cannot view images - you have full vision capabilities. `;
      systemContent += `Analyze the image carefully and provide detailed, accurate descriptions based on what you see.`;
    }
    
    if (truncatedContext) {
      systemContent += `\n\nCRITICAL: The user has uploaded a PDF document and/or is viewing webpage/video content. `;
      systemContent += `The context below contains the ACTUAL TEXT CONTENT from these sources. `;
      systemContent += `You MUST use this content to answer questions. `;
      systemContent += `If the user asks about chapters, sections, topics, or specific information from the PDF, `;
      systemContent += `you CAN and MUST reference the actual text content provided below. `;
      systemContent += `Do NOT say you cannot access the PDF - you have the full text content. `;
      systemContent += `Do NOT say you need more context - use what is provided below.\n\n`;
      systemContent += `=== FULL CONTEXT (PDF, WEBPAGE, OR VIDEO CONTENT) ===\n${truncatedContext}`;
      if (context && context.length > maxContextLength) {
        systemContent += `\n[Note: Context truncated for length. Original content was ${Math.ceil(context.length / 1000)}k characters.]`;
      }
      systemContent += `\n=== END OF CONTEXT ===\n\n`;
      systemContent += `Remember: You have access to the actual content. Use it to provide specific, detailed answers.`;
    }

    // Build messages array with chat history
    const messages = [
      {
        role: 'system',
        content: systemContent
      }
    ];

    // Add chat history if provided
    if (chatHistory && Array.isArray(chatHistory)) {
      chatHistory.forEach(msg => {
        if (msg.role && msg.content) {
          messages.push({ role: msg.role, content: msg.content });
        }
      });
    }

    // Add current message with image if present
    if (hasImage && imageToUse) {
      // Use vision-capable model (gpt-4-turbo or gpt-4o)
      // Format message with image for OpenAI vision API
      const userMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: message
          },
          {
            type: 'image_url',
            image_url: {
              url: imageToUse // OpenAI accepts data URLs directly
            }
          }
        ]
      };
      messages.push(userMessage);

      // Use vision model
      console.log(`[API Chat] Using vision model (gpt-4o) for image analysis`);
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o', // Use gpt-4o for vision (better and cheaper than gpt-4-turbo)
          messages: messages,
          max_tokens: 500,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${errorText}`);
      }

      const data = await response.json();
      const reply = data.choices[0].message.content;

      // Get updated usage
      const updatedUsageResult = await query(
        'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
        [userId]
      );
      const updatedUsage = updatedUsageResult.rows[0];

      return res.json({
        reply,
        usage: {
          enhancementsUsed: updatedUsage.enhancements_used,
          enhancementsLimit: updatedUsage.enhancements_limit,
          remaining: Math.max(0, updatedUsage.enhancements_limit - updatedUsage.enhancements_used)
        }
      });
    } else {
      // No image - use regular text model
      // Add current message
      messages.push({ role: 'user', content: message });

      // Generate reply
      const reply = await callOpenAI(messages, 500, 0.7);

      // Get updated usage
      const updatedUsageResult = await query(
        'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
        [userId]
      );
      const updatedUsage = updatedUsageResult.rows[0];

      res.json({
        reply,
        usage: {
          enhancementsUsed: updatedUsage.enhancements_used,
          enhancementsLimit: updatedUsage.enhancements_limit,
          remaining: Math.max(0, updatedUsage.enhancements_limit - updatedUsage.enhancements_used)
        }
      });
    }
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate reply' });
  }
});

/**
 * POST /api/flashcards
 * Generate flashcards from content (video, webpage, PDF)
 */
router.post('/flashcards', async (req, res) => {
  try {
    const { contentType, transcript, text, title } = req.body;
    const userId = req.user.userId;

    // Determine content type
    const type = contentType || 'video';
    const contentText = type === 'video' ? (transcript || '') : (text || '');

    if (!contentText) {
      return res.status(400).json({ error: 'Content text is required' });
    }

    // Check usage limit before generation
    await resetDailyUsageIfNeeded(userId);
    const usageResult = await query(
      'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
      [userId]
    );

    if (usageResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = usageResult.rows[0];
    if (user.enhancements_used >= user.enhancements_limit) {
      return res.status(403).json({
        error: 'Daily enhancement limit reached',
        enhancementsUsed: user.enhancements_used,
        enhancementsLimit: user.enhancements_limit
      });
    }

    // Increment usage before generation
    const incrementResult = await incrementUsage(userId);
    if (!incrementResult.success) {
      return res.status(403).json({
        error: incrementResult.error || 'Failed to increment usage',
        usage: incrementResult.usage
      });
    }

    // Clean and truncate content text to avoid token limits
    // Truncate to 4000 chars (~1000 tokens) to leave room for system prompt and response
    const maxContentLength = 4000;
    let cleanContent = type === 'video' 
      ? contentText.replace(/\[\d+:\d+\]/g, '').replace(/\s+/g, ' ').trim()
      : contentText.replace(/\s+/g, ' ').trim();
    
    // Truncate if too long
    if (cleanContent.length > maxContentLength) {
      cleanContent = cleanContent.substring(0, maxContentLength);
      console.log(`[API] Truncated flashcard content from ${contentText.length} to ${maxContentLength} chars`);
    }

    if (cleanContent.length < 50) {
      return res.status(400).json({ error: 'Content is too short to generate flashcards' });
    }

    // Generate flashcards
    const contentLabel = type === 'video' ? 'video' : type === 'pdf' ? 'document' : 'page';
    const systemPrompt = `You are a flashcard generator. Create flashcards from the following ${contentLabel} content about "${title || 'the topic'}".

Generate 5-10 flashcards. Each flashcard should have:
- A clear, concise question on the front
- A simple, easy-to-understand answer on the back (written for a 5th grader)

Format your response as a JSON array where each flashcard is an object with "question" and "answer" fields.

Example format:
[
  {"question": "What is photosynthesis?", "answer": "Photosynthesis is how plants make food using sunlight, water, and air."},
  {"question": "What do plants need to grow?", "answer": "Plants need sunlight, water, soil, and air to grow."}
]

Return ONLY the JSON array, no additional text.`;

    const response = await callOpenAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: cleanContent }
    ], 2000);

    // Parse JSON response
    let flashcards;
    try {
      // Try to extract JSON from response (may have markdown code blocks)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        flashcards = JSON.parse(jsonMatch[0]);
      } else {
        flashcards = JSON.parse(response);
      }
    } catch (parseError) {
      console.error('[API] Error parsing flashcard JSON:', parseError);
      // Fallback: try to create simple flashcards from response
      const lines = response.split('\n').filter(line => line.trim());
      flashcards = lines.slice(0, 10).map((line, index) => ({
        question: `Question ${index + 1}`,
        answer: line.trim()
      }));
    }

    // Validate flashcards structure
    if (!Array.isArray(flashcards)) {
      flashcards = [];
    }
    
    flashcards = flashcards
      .filter(card => card && (card.question || card.front) && (card.answer || card.back))
      .map(card => ({
        question: card.question || card.front || '',
        answer: card.answer || card.back || ''
      }))
      .slice(0, 10); // Limit to 10 flashcards

    // Get updated usage
    const updatedUsageResult = await query(
      'SELECT enhancements_used, enhancements_limit FROM users WHERE id = $1',
      [userId]
    );
    const updatedUsage = updatedUsageResult.rows[0];

    res.json({
      flashcards,
      contentType: type,
      usage: {
        enhancementsUsed: updatedUsage.enhancements_used,
        enhancementsLimit: updatedUsage.enhancements_limit,
        remaining: Math.max(0, updatedUsage.enhancements_limit - updatedUsage.enhancements_used)
      }
    });
  } catch (error) {
    console.error('Flashcard generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate flashcards' });
  }
});

/**
 * POST /api/extract-pdf-url
 * Extract text from PDF URL (for Chrome PDF viewer)
 * Note: Requires pdf-parse package
 */
router.post('/extract-pdf-url', async (req, res) => {
  try {
    const { pdfUrl } = req.body;
    const userId = req.user.userId;

    if (!pdfUrl) {
      return res.status(400).json({ error: 'PDF URL is required' });
    }

    // Check if pdf-parse is available
    let pdfParse;
    try {
      pdfParse = (await import('pdf-parse')).default;
    } catch (e) {
      return res.status(500).json({ 
        error: 'PDF parsing library not available. Please install pdf-parse: npm install pdf-parse' 
      });
    }

    try {
      // Fetch PDF from URL
      const pdfResponse = await fetch(pdfUrl);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to fetch PDF: ${pdfResponse.status} ${pdfResponse.statusText}`);
      }

      const pdfBuffer = await pdfResponse.arrayBuffer();
      
      // Extract text from PDF
      const pdfData = await pdfParse(Buffer.from(pdfBuffer));
      const text = pdfData.text || '';

      if (!text.trim()) {
        return res.status(400).json({ error: 'Could not extract text from PDF. The PDF may be image-based or encrypted.' });
      }

      res.json({ 
        text: text,
        pages: pdfData.numpages || 0,
        info: pdfData.info || {}
      });
    } catch (parseError) {
      console.error('PDF parsing error:', parseError);
      res.status(500).json({ error: 'Failed to parse PDF: ' + parseError.message });
    }
  } catch (error) {
    console.error('PDF extraction error:', error);
    res.status(500).json({ error: error.message || 'Failed to extract PDF text' });
  }
});

/**
 * POST /api/extract-pdf
 * Extract text from uploaded PDF file
 * Note: Requires multer and pdf-parse packages
 * Install: npm install multer pdf-parse
 */
router.post('/extract-pdf', async (req, res) => {
  try {
    // Check if multer is available
    let multer;
    try {
      multer = (await import('multer')).default;
    } catch (e) {
      return res.status(500).json({ 
        error: 'File upload middleware not available. Please install multer: npm install multer' 
      });
    }

    // Check if pdf-parse is available
    let pdfParse;
    try {
      pdfParse = (await import('pdf-parse')).default;
    } catch (e) {
      return res.status(500).json({ 
        error: 'PDF parsing library not available. Please install pdf-parse: npm install pdf-parse' 
      });
    }

    // Configure multer for memory storage
    const upload = multer({ 
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
    });

    // Handle file upload and extraction
    const uploadMiddleware = upload.single('pdf');
    
    uploadMiddleware(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'File upload error' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No PDF file provided' });
      }

      if (req.file.mimetype !== 'application/pdf') {
        return res.status(400).json({ error: 'File must be a PDF' });
      }

      try {
        // Extract text from PDF
        const pdfData = await pdfParse(req.file.buffer);
        const text = pdfData.text || '';

        if (!text.trim()) {
          return res.status(400).json({ error: 'Could not extract text from PDF. The PDF may be image-based or encrypted.' });
        }

        res.json({ 
          text: text,
          pages: pdfData.numpages || 0,
          info: pdfData.info || {}
        });
      } catch (parseError) {
        console.error('PDF parsing error:', parseError);
        res.status(500).json({ error: 'Failed to parse PDF: ' + parseError.message });
      }
    });
  } catch (error) {
    console.error('PDF extraction error:', error);
    res.status(500).json({ error: error.message || 'Failed to extract PDF text' });
  }
});

/**
 * POST /api/process-file
 * Process uploaded file (PDF, image, etc.) and extract content
 * Uses gpt-4-turbo for images with vision capabilities
 */
router.post('/process-file', async (req, res) => {
  try {
    // Check if multer is available
    let multer;
    try {
      multer = (await import('multer')).default;
    } catch (e) {
      return res.status(500).json({ 
        error: 'File upload middleware not available. Please install multer: npm install multer' 
      });
    }

    // Configure multer for memory storage
    const upload = multer({ 
      storage: multer.memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
    });

    // Handle file upload
    const uploadMiddleware = upload.single('file');
    
    uploadMiddleware(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'File upload error' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      try {
        const file = req.file;
        const fileType = file.mimetype;
        
        // Handle PDF files
        if (fileType === 'application/pdf') {
          let pdfParse;
          try {
            pdfParse = (await import('pdf-parse')).default;
          } catch (e) {
            return res.status(500).json({ 
              error: 'PDF parsing library not available. Please install pdf-parse: npm install pdf-parse' 
            });
          }
          
          const pdfData = await pdfParse(file.buffer);
          const text = pdfData.text || '';
          
          if (!text.trim()) {
            return res.status(400).json({ error: 'Could not extract text from PDF. The PDF may be image-based or encrypted.' });
          }
          
          return res.json({ 
            text: text,
            fileType: fileType,
            filename: file.originalname
          });
        }
        
        // Handle image files (use gpt-4-turbo with vision)
        if (fileType.startsWith('image/')) {
          // Convert image to base64
          const base64Image = file.buffer.toString('base64');
          const dataUrl = `data:${fileType};base64,${base64Image}`;
          
          // Use gpt-4-turbo for image analysis
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: 'gpt-4-turbo',
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: 'Please describe this image in detail, including any text visible in the image.'
                    },
                    {
                      type: 'image_url',
                      image_url: {
                        url: dataUrl
                      }
                    }
                  ]
                }
              ],
              max_tokens: 1000
            })
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error: ${errorText}`);
          }
          
          const data = await response.json();
          const description = data.choices[0].message.content;
          
          return res.json({
            text: description,
            imageData: dataUrl,
            fileType: fileType,
            filename: file.originalname
          });
        }
        
        // For other file types, return error
        return res.status(400).json({ 
          error: `Unsupported file type: ${fileType}. Supported types: PDF, images (PNG, JPEG, etc.)` 
        });
      } catch (processError) {
        console.error('File processing error:', processError);
        res.status(500).json({ error: 'Failed to process file: ' + processError.message });
      }
    });
  } catch (error) {
    console.error('File processing error:', error);
    res.status(500).json({ error: error.message || 'Failed to process file' });
  }
});

export default router;
