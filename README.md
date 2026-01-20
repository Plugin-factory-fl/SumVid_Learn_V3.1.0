# Eureka AI - Chat Workflow Sidebar for Learners and Educators

A powerful Chrome extension that helps you understand YouTube videos better by providing AI-powered summaries, interactive quizzes, and a smart Q&A system - all written at a 5th-grade reading level for maximum accessibility.

## Features

- **Smart Video Detection**: Automatically detects when you're watching a YouTube video
- **Draggable Sticky Button**: Convenient button on YouTube pages that opens the sidebar with a helpful toast notification
- **AI-Powered Summaries**: Get clear, easy-to-understand summaries of video content
- **Interactive Quizzes**: Test your understanding with automatically generated multiple-choice questions
- **Q&A System**: Ask questions about the video and get simple, clear answers
- **User Authentication**: Secure login and account management with backend integration
- **Freemium System**: Daily usage limits with upgrade options
- **Dark Mode Support**: Toggle between light and dark themes for comfortable viewing
- **Settings Panel**: Customize your extension experience
- **Copy & Share**: Export summaries, quiz results, and chat conversations
- **Accessibility Focus**: All content is written at a 5th-grade reading level

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extension directory
5. The extension is now installed and ready to use

**Note**: For full functionality, you'll need to set up the backend server (see Backend Setup below).

## Usage

1. Navigate to any YouTube video
2. The sticky button will appear on the page (bottom-right by default, draggable)
3. Click the sticky button or the extension icon to open the sidebar
4. Log in to your account (or create one) to track usage and access premium features
5. Use the following features:
   - Click "Summarize" to generate an AI-powered summary
   - Click "Make Test" to generate a quiz
   - Ask questions about the video content
   - View your usage statistics in the status cards
   - Toggle dark mode in the settings panel
   - Copy and share your learning materials

## Backend Setup

The extension requires a backend server for authentication, usage tracking, and AI API calls. See [backend/README.md](backend/README.md) for detailed setup instructions.

### Quick Backend Setup

1. **Local Development**:
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Edit .env with your configuration
   npm run migrate
   npm run dev
   ```

2. **Production Deployment (Render)**:
   - See [backend/README.md](backend/README.md) for complete deployment guide
   - Backend is configured for Render.com deployment
   - Update `BACKEND_URL` in `background.js` and `Source/LoginMenu.js` with your Render backend URL

### Required Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT token signing
- `OPENAI_API_KEY` - Your OpenAI API key
- `STRIPE_SECRET_KEY` - Stripe secret key (for premium subscriptions)
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `STRIPE_PRICE_ID` - Stripe subscription price ID

## Project Structure

```
/
├── backend/                # Backend server (Node.js/Express)
│   ├── config/            # Configuration files (database, auth, stripe, usage)
│   ├── routes/            # API routes (auth, api, user, checkout, webhooks)
│   ├── scripts/           # Database migration scripts
│   ├── server.js          # Main server file
│   ├── package.json       # Backend dependencies
│   └── README.md          # Backend documentation
├── icons/                 # Extension icons
├── Source/                # Source JavaScript modules
│   ├── StickyButton.js    # Sticky button implementation
│   ├── LoginMenu.js       # Authentication and account management
│   ├── SettingsPanel.js   # Settings dialog management
│   └── usageTracker.js    # Usage tracking (frontend)
├── styles/                # CSS stylesheets
│   ├── StickyButton.css   # Sticky button styles
│   ├── LoginMenu.css      # Login menu styles
│   └── SettingsPanel.css  # Settings panel styles
├── manifest.json          # Extension configuration
├── background.js          # Background service worker
├── content.js            # Content script for YouTube pages
├── sidebar.html          # Sidebar interface
├── sidebar.css           # Sidebar styling
├── sidebar.js            # Sidebar functionality
└── README.md             # This file
```

## GitHub Repository

This project is prepared for GitHub. To set up:

1. Create a new repository on GitHub named `SumVid_Learn_V3.1.0`
2. Add the remote:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/SumVid_Learn_V3.1.0.git
   ```
3. Push the code:
   ```bash
   git add .
   git commit -m "Initial commit: SumVid Learn V3.1.0 with backend integration"
   git branch -M main
   git push -u origin main
   ```

**Note**: Make sure to update `.gitignore` to exclude sensitive files like `.env` and never commit API keys.

## How It Works

### Extension Architecture

- **Content Script** (`content.js`): Injects the sticky button and sidebar iframe into YouTube pages
- **Background Script** (`background.js`): Handles API calls to the backend server
- **Sidebar** (`sidebar.html/js`): Main UI for displaying summaries, quizzes, and Q&A
- **Backend Server**: Handles authentication, usage tracking, and AI API calls

### Data Flow

1. User watches a YouTube video
2. Content script extracts video info and transcript
3. User clicks "Summarize", "Make Test", or asks a question
4. Background script sends request to backend with authentication token
5. Backend validates request, checks usage limits, calls OpenAI API
6. Backend increments usage and returns response
7. Extension displays results to user

## Technical Details

Built with:
- **Frontend**: Vanilla JavaScript, HTML/CSS
- **Chrome Extension**: Manifest V3
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL
- **AI**: OpenAI GPT-3.5 Turbo
- **Authentication**: JWT tokens
- **Payments**: Stripe (for premium subscriptions)
- **Deployment**: Render.com (backend), Chrome Web Store (extension)

## Version History

### V1.0.0 (Current)
- Complete Eureka AI release with full feature set
- Chat workflow sidebar for learners and educators
- AI-powered summaries, flashcards, quizzes, and smart chat
- Support for YouTube videos, webpages, and PDFs
- Content written at 5th-grade reading level for accessibility
- User authentication and usage tracking
- Freemium system with transparent pricing
- Privacy-first design with no browsing tracking
- Notes management and organization
- Highlight to clarify feature
- Dark mode support
- Responsive design and modern UI

## Development

### Local Development Setup

1. **Extension**:
   - Load the extension in Chrome developer mode
   - Update `BACKEND_URL` in `background.js` and `Source/LoginMenu.js` to point to local backend (e.g., `http://localhost:3000`)

2. **Backend**:
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Configure .env with local database and API keys
   npm run migrate
   npm run dev
   ```

### Testing

- Test the extension on YouTube video pages
- Verify sticky button appears and is draggable
- Test login/registration flows
- Test summary, quiz, and Q&A generation
- Verify usage tracking and limits
- Test dark mode and settings

## Deployment

### Backend Deployment (Render)

See [backend/README.md](backend/README.md) for detailed deployment instructions.

1. Create PostgreSQL database on Render
2. Create web service on Render
3. Configure environment variables
4. Deploy and run migrations
5. Set up Stripe webhook endpoint

### Extension Deployment (Chrome Web Store)

1. Build the extension (if using a build process)
2. Create a ZIP file of the extension directory
3. Go to Chrome Web Store Developer Dashboard
4. Upload the extension
5. Fill in store listing details
6. Submit for review

## Security Notes

- Never commit API keys or secrets to version control
- Use environment variables for sensitive configuration
- JWT tokens are stored in Chrome local storage
- Passwords are hashed using bcrypt (10 rounds)
- Rate limiting is enabled on backend API routes
- CORS is configured to only allow extension origins

## License

ISC

## Support

For issues, feature requests, or questions, please open an issue on the GitHub repository.
