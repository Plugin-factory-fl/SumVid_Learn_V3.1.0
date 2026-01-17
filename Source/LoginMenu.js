/**
 * Login Menu Module
 * Handles all functionality related to the account login dialog with backend integration
 */

const BACKEND_URL = 'https://sumvid-learn-backend.onrender.com'; // Update with your backend URL

/**
 * Stores authentication token in Chrome storage and sends to background script
 */
async function storeAuthToken(token) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ sumvid_auth_token: token }, () => {
      // Also send to background script
      chrome.runtime.sendMessage({ type: 'AUTH_TOKEN', token }, () => {
        resolve();
      });
    });
  });
}

/**
 * Gets authentication token from Chrome storage
 */
async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['sumvid_auth_token'], (items) => {
      resolve(items?.sumvid_auth_token || null);
    });
  });
}

/**
 * Clears authentication token
 */
async function clearAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['sumvid_auth_token'], () => {
      // Also notify background script
      chrome.runtime.sendMessage({ type: 'AUTH_TOKEN', action: 'clear' }, () => {
        resolve();
      });
    });
  });
}

/**
 * Registers a new user account
 */
async function registerUser(name, email, password) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: name || null,
        email: email,
        password: password,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error || 'Registration failed');
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Logs in an existing user
 */
async function loginUser(email, password) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        password: password,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Requests password reset token for an email
 */
async function requestPasswordReset(email) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to request password reset');
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Resets password using email and token
 */
async function resetPassword(email, token, newPassword) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, token, newPassword }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to reset password');
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Changes password (requires authentication)
 */
async function changePassword(currentPassword, newPassword) {
  try {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${BACKEND_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to change password');
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Fetches user profile from backend
 */
async function getUserProfile() {
  try {
    const token = await getAuthToken();
    if (!token) {
      return null;
    }

    const response = await fetch(`${BACKEND_URL}/api/user/profile`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token is invalid, clear it
        await clearAuthToken();
      }
      return null;
    }

    const data = await response.json();
    return data.user || data;
  } catch (error) {
    console.error('[LoginMenu] Error fetching user profile:', error);
    return null;
  }
}

/**
 * Fetches user usage stats from backend
 */
async function getUserUsage() {
  try {
    const token = await getAuthToken();
    if (!token) {
      return null;
    }

    const response = await fetch(`${BACKEND_URL}/api/user/usage`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        await clearAuthToken();
      }
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[LoginMenu] Error fetching user usage:', error);
    return null;
  }
}

/**
 * Updates the logged-in view with user information
 */
async function updateLoggedInView() {
  const loggedInView = document.getElementById('account-logged-in-view');
  const loginView = document.getElementById('account-form');

  if (!loggedInView || !loginView) return;

  const userProfile = await getUserProfile();
  
  if (userProfile) {
    loggedInView.hidden = false;
    loggedInView.style.display = 'block';
    loginView.hidden = true;
    loginView.style.display = 'none';
    
    const userNameEl = document.getElementById('account-user-name');
    const userEmailEl = document.getElementById('account-user-email');
    const planNameEl = document.getElementById('account-plan-name');
    const displayName = (userProfile.name && userProfile.name.trim()) 
      ? userProfile.name 
      : (userProfile.email || 'User');
    if (userNameEl) {
      userNameEl.textContent = displayName;
    }
    if (userEmailEl && userProfile.email) {
      userEmailEl.textContent = `(${userProfile.email})`;
    }
    
    const subscriptionStatus = userProfile.subscription_status || 'freemium';
    if (planNameEl) {
      planNameEl.textContent = subscriptionStatus === 'premium' ? 'PRO' : 'Freemium';
    }

    // Show/hide crown icon
    const crownIcon = document.getElementById('account-crown-icon');
    if (crownIcon) {
      crownIcon.style.display = subscriptionStatus === 'premium' ? 'block' : 'none';
    }
  } else {
    loggedInView.hidden = true;
    loggedInView.style.display = 'none';
    loginView.hidden = false;
    loginView.style.display = 'block';
  }
}

/**
 * Updates status card with user info (in account dialog)
 */
async function updateStatusCard() {
  const userProfile = await getUserProfile();
  const userStatusEl = document.getElementById('account-user-status');
  const userPlanEl = document.getElementById('account-user-plan');
  const crownIcon = document.getElementById('account-crown-icon');
  const upgradeButton = document.getElementById('upgrade-button');
  const enhancementsCard = document.getElementById('account-enhancements-used-card');

  if (userProfile) {
    const displayName = (userProfile.name && userProfile.name.trim())
      ? userProfile.name
      : (userProfile.email || 'User');
    if (userStatusEl) {
      userStatusEl.textContent = displayName;
    }
    const subscriptionStatus = userProfile.subscription_status || 'freemium';
    const isPremium = subscriptionStatus === 'premium';
    
    // Hide/show upgrade button based on premium status
    if (upgradeButton) {
      if (isPremium) {
        upgradeButton.style.display = 'none';
      } else {
        upgradeButton.style.display = '';
      }
    }
    
    // Hide/show enhancements used card based on premium status
    if (enhancementsCard) {
      if (isPremium) {
        enhancementsCard.style.display = 'none';
      } else {
        enhancementsCard.style.display = '';
      }
    }
    
    // Hide/show "Upgrade to Pro" description text based on premium status
    const planDescription = document.querySelector('.account__plan-description');
    if (planDescription) {
      if (isPremium) {
        planDescription.style.display = 'none';
      } else {
        planDescription.style.display = '';
      }
    }
    if (userPlanEl) {
      userPlanEl.textContent = subscriptionStatus === 'premium' ? 'PRO' : 'Freemium';
    }
    if (crownIcon) {
      crownIcon.style.display = subscriptionStatus === 'premium' ? 'block' : 'none';
    }
  } else {
    if (userStatusEl) {
      userStatusEl.textContent = 'Not Logged In';
    }
    if (userPlanEl) {
      userPlanEl.textContent = 'Freemium';
    }
    if (crownIcon) {
      crownIcon.style.display = 'none';
    }
  }
}

let accountHandlersInitialized = false;

/**
 * Registers event handlers for the account login dialog
 */
function registerAccountHandlers() {
  // Prevent multiple initializations
  if (accountHandlersInitialized) {
    return;
  }
  accountHandlersInitialized = true;

  let accountDialog = document.getElementById('account-dialog');
  const accountTrigger = document.getElementById('open-account');
  const accountForm = document.getElementById('account-form');
  let createAccountDialog = document.getElementById('create-account-dialog');
  const createAccountForm = document.getElementById('create-account-form');
  const createAccountLink = document.getElementById('open-create-account');
  const forgotPasswordButton = document.getElementById('forgot-password');
  let forgotPasswordEmailDialog = document.getElementById('forgot-password-email-dialog');
  const forgotPasswordEmailForm = document.getElementById('forgot-password-email-form');
  let resetPasswordDialog = document.getElementById('forgot-password-reset-dialog');
  const resetPasswordForm = document.getElementById('forgot-password-reset-form');

  if (!accountDialog || !accountTrigger || !accountForm) {
    return;
  }
  
  // Move all dialogs to body immediately to escape all containers
  if (accountDialog && accountDialog.parentElement !== document.body) {
    document.body.appendChild(accountDialog);
  }
  if (createAccountDialog && createAccountDialog.parentElement !== document.body) {
    document.body.appendChild(createAccountDialog);
  }
  if (forgotPasswordEmailDialog && forgotPasswordEmailDialog.parentElement !== document.body) {
    document.body.appendChild(forgotPasswordEmailDialog);
  }
  if (resetPasswordDialog && resetPasswordDialog.parentElement !== document.body) {
    document.body.appendChild(resetPasswordDialog);
  }

  const loggedInView = document.getElementById('account-logged-in-view');
  const loginView = document.getElementById('account-form');
  const switchAccountButton = document.getElementById('switch-account');
  const upgradeButton = document.getElementById('upgrade-button');

  // Open account dialog - simplified
  accountTrigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (accountDialog.open) {
      accountDialog.close();
      return;
    }

    // Update view before showing
    (async () => {
      await updateLoggedInView();
      await updateStatusCard();
      // Update premium UI when dialog opens
      if (window.premiumManager) {
        await window.premiumManager.updateUIForPremium();
      }
      accountDialog.showModal();
    })().catch(() => {
      // Even if update fails, show dialog
      accountDialog.showModal();
    });
  });

  // Handle backdrop click for account dialog
  accountDialog.addEventListener('click', (e) => {
    if (e.target === accountDialog) {
      accountDialog.close();
    }
  });

  // Prevent clicks inside account dialog from closing it
  const accountDialogContent = accountDialog.querySelector('.modal__content');
  if (accountDialogContent) {
    accountDialogContent.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // Handle close button for account dialog
  const accountCloseButton = accountDialog.querySelector('.account__cancel, .modal__close');
  if (accountCloseButton) {
    accountCloseButton.addEventListener('click', (e) => {
      e.preventDefault();
      accountDialog.close();
    });
  }

  // Handle switch account button
  if (switchAccountButton) {
    switchAccountButton.addEventListener('click', async () => {
      await clearAuthToken();
      await updateLoggedInView();
      await updateStatusCard();
      // Update usage cards if window.UsageTracker exists
      if (window.updateStatusCards) {
        await window.updateStatusCards();
      }
    });
  }

  // Handle upgrade button
  if (upgradeButton) {
    upgradeButton.addEventListener('click', async () => {
      const token = await getAuthToken();
      if (!token) {
        alert('Please log in to upgrade to Pro');
        return;
      }

      try {
        console.log('[Upgrade] Creating checkout session...');
        const response = await fetch(`${BACKEND_URL}/api/checkout/create-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
        });

        console.log('[Upgrade] Response status:', response.status);
        
        if (!response.ok) {
          let errorMessage = `Server error: ${response.status}`;
          try {
            const errorData = await response.json();
            console.error('[Upgrade] Error response:', errorData);
            // Prefer the detailed message over the generic error
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (parseError) {
            const text = await response.text().catch(() => '');
            console.error('[Upgrade] Non-JSON error response:', text);
            errorMessage = text || errorMessage;
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log('[Upgrade] Checkout session created:', data);
        
        if (data.url) {
          window.open(data.url, '_blank');
        } else {
          console.warn('[Upgrade] No checkout URL in response:', data);
          alert('Upgrade feature coming soon!');
        }
      } catch (error) {
        console.error('[Upgrade] Error details:', error);
        const errorMessage = error.message || 'Unknown error occurred';
        alert(`Failed to initiate upgrade: ${errorMessage}`);
      }
    });
  }

  // Handle Get Pro button (in status section)
  const getProButton = document.getElementById('get-pro-button');
  if (getProButton) {
    getProButton.addEventListener('click', async () => {
      const token = await getAuthToken();
      if (!token) {
        alert('Please log in to upgrade to Pro');
        return;
      }

      // Disable button to prevent double-clicks
      getProButton.disabled = true;
      const originalText = getProButton.textContent;
      getProButton.textContent = 'Loading...';

      try {
        console.log('[Get Pro] Creating checkout session...');
        const response = await fetch(`${BACKEND_URL}/api/checkout/create-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
        });

        console.log('[Get Pro] Response status:', response.status);
        
        if (!response.ok) {
          let errorMessage = `Server error: ${response.status}`;
          try {
            const errorData = await response.json();
            console.error('[Get Pro] Error response:', errorData);
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (parseError) {
            const text = await response.text().catch(() => '');
            console.error('[Get Pro] Non-JSON error response:', text);
            errorMessage = text || errorMessage;
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log('[Get Pro] Checkout session created:', data);
        
        if (data.url) {
          window.open(data.url, '_blank');
          // Reset button after successful checkout session creation
          getProButton.disabled = false;
          getProButton.textContent = originalText;
        } else {
          console.warn('[Get Pro] No checkout URL in response:', data);
          alert('Upgrade feature coming soon!');
          getProButton.disabled = false;
          getProButton.textContent = originalText;
        }
      } catch (error) {
        console.error('[Get Pro] Error details:', error);
        const errorMessage = error.message || 'Unknown error occurred';
        alert(`Failed to initiate upgrade: ${errorMessage}`);
        getProButton.disabled = false;
        getProButton.textContent = originalText;
      }
    });
  }

  // Handle login form submission
  accountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleLoginSubmit();
  });

  // Also handle login button click (since it's type="button")
  const loginSubmitButton = accountForm.querySelector('.account__submit');
  if (loginSubmitButton) {
    loginSubmitButton.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleLoginSubmit();
    });
  }

  async function handleLoginSubmit() {
    const formData = new FormData(accountForm);
    const email = formData.get('email');
    const password = formData.get('password');

    const errorEl = document.getElementById('login-error-message');
    const submitButton = accountForm.querySelector('.account__submit');

    if (!email || !password) {
      if (errorEl) {
        errorEl.textContent = 'Please enter both email and password';
        errorEl.hidden = false;
      }
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Logging in...';
    }

    try {
      const result = await loginUser(email, password);
      await storeAuthToken(result.token);
      
      if (errorEl) {
        errorEl.hidden = true;
      }

      accountDialog.close();
      await updateLoggedInView();
      await updateStatusCard();
      // Update usage cards
      if (window.updateStatusCards) {
        await window.updateStatusCards();
      }
    } catch (error) {
      console.error('Login error:', error);
      if (errorEl) {
        errorEl.textContent = error.message || 'Login failed. Please check your credentials.';
        errorEl.hidden = false;
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Log In';
      }
    }
  }

  // Handle create account link
  if (createAccountLink && createAccountDialog) {
    createAccountLink.addEventListener('click', (e) => {
      e.preventDefault();
      accountDialog.close();
      createAccountDialog.showModal();
    });
  }

  // Handle create account form
  if (createAccountForm && createAccountDialog) {
    createAccountForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(createAccountForm);
      const name = formData.get('name');
      const email = formData.get('email');
      const password = formData.get('password');
      const confirmPassword = formData.get('confirmPassword');

      const errorEl = document.getElementById('create-account-error-message');
      const submitButton = createAccountForm.querySelector('.create-account__submit');

      if (!email || !password) {
        if (errorEl) {
          errorEl.textContent = 'Please enter both email and password';
          errorEl.hidden = false;
        }
        return;
      }

      if (password !== confirmPassword) {
        if (errorEl) {
          errorEl.textContent = 'Passwords do not match';
          errorEl.hidden = false;
        }
        return;
      }

      if (password.length < 8) {
        if (errorEl) {
          errorEl.textContent = 'Password must be at least 8 characters long';
          errorEl.hidden = false;
        }
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Creating account...';
      }

      try {
        const result = await registerUser(name, email, password);
        await storeAuthToken(result.token);
        
        if (errorEl) {
          errorEl.hidden = true;
        }

        createAccountDialog.close();
        accountDialog.close();
        await updateLoggedInView();
        await updateStatusCard();
        // Update usage cards
        if (window.updateStatusCards) {
          await window.updateStatusCards();
        }
      } catch (error) {
        console.error('Registration error:', error);
        if (errorEl) {
          errorEl.textContent = error.message || 'Registration failed. Please try again.';
          errorEl.hidden = false;
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Create Account';
        }
      }
    });
  }

  // Handle forgot password
  if (forgotPasswordButton && forgotPasswordEmailDialog) {
    forgotPasswordButton.addEventListener('click', (e) => {
      e.preventDefault();
      accountDialog.close();
      forgotPasswordEmailDialog.showModal();
    });
  }

  // Handle password reset email form
  if (forgotPasswordEmailForm && forgotPasswordEmailDialog) {
    forgotPasswordEmailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(forgotPasswordEmailForm);
      const email = formData.get('email');
      const errorEl = document.getElementById('forgot-password-error-message');
      const submitButton = forgotPasswordEmailForm.querySelector('.forgot-password-email__submit');

      if (!email) {
        if (errorEl) {
          errorEl.textContent = 'Please enter your email address';
          errorEl.hidden = false;
        }
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Sending...';
      }

      try {
        const result = await requestPasswordReset(email);
        // Show reset password dialog with token
        if (result.token && resetPasswordDialog && resetPasswordForm) {
          // Store email and token for reset form
          resetPasswordForm.dataset.email = email;
          resetPasswordForm.dataset.token = result.token;
          forgotPasswordEmailDialog.close();
          resetPasswordDialog.showModal();
        } else {
          alert('Password reset email sent! Please check your email for instructions.');
          forgotPasswordEmailDialog.close();
        }
      } catch (error) {
        console.error('Password reset error:', error);
        if (errorEl) {
          errorEl.textContent = error.message || 'Failed to send password reset. Please try again.';
          errorEl.hidden = false;
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Send Reset Link';
        }
      }
    });
  }

  // Handle reset password form
  if (resetPasswordForm && resetPasswordDialog) {
    resetPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(resetPasswordForm);
      const newPassword = formData.get('newPassword');
      const confirmPassword = formData.get('confirmPassword');
      const email = resetPasswordForm.dataset.email;
      const token = resetPasswordForm.dataset.token;
      const errorEl = document.getElementById('forgot-password-reset-error-message');
      const submitButton = resetPasswordForm.querySelector('.forgot-password-reset__submit');

      if (!newPassword || !confirmPassword) {
        if (errorEl) {
          errorEl.textContent = 'Please enter both password fields';
          errorEl.hidden = false;
        }
        return;
      }

      if (newPassword !== confirmPassword) {
        if (errorEl) {
          errorEl.textContent = 'Passwords do not match';
          errorEl.hidden = false;
        }
        return;
      }

      if (newPassword.length < 8) {
        if (errorEl) {
          errorEl.textContent = 'Password must be at least 8 characters long';
          errorEl.hidden = false;
        }
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Resetting...';
      }

      try {
        await resetPassword(email, token, newPassword);
        alert('Password reset successful! You can now log in with your new password.');
        resetPasswordDialog.close();
        accountDialog.showModal();
      } catch (error) {
        console.error('Reset password error:', error);
        if (errorEl) {
          errorEl.textContent = error.message || 'Failed to reset password. Please try again.';
          errorEl.hidden = false;
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Reset Password';
        }
      }
    });
  }

  // Note: Change password dialog not yet implemented in HTML - can be added later

  // Password toggle handlers (delegated to handle dynamic content)
  document.addEventListener('click', (e) => {
    const toggleButton = e.target.closest('.account__password-toggle');
    if (toggleButton) {
      e.preventDefault();
      e.stopPropagation();
      const targetId = toggleButton.getAttribute('data-target');
      const passwordInput = document.getElementById(targetId);
      if (passwordInput) {
        if (passwordInput.type === 'password') {
          passwordInput.type = 'text';
          toggleButton.textContent = 'Hide';
        } else {
          passwordInput.type = 'password';
          toggleButton.textContent = 'Show';
        }
      }
    }
  });

  // Close button handlers
  const closeButtons = accountDialog.querySelectorAll('.modal__close, .account__cancel');
  closeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      accountDialog.close();
    });
  });

  if (createAccountDialog) {
    const createCloseButtons = createAccountDialog.querySelectorAll('.modal__close, .create-account__cancel');
    createCloseButtons.forEach((button) => {
      button.addEventListener('click', () => {
        createAccountDialog.close();
      });
    });
  }

  if (forgotPasswordEmailDialog) {
    const forgotCloseButtons = forgotPasswordEmailDialog.querySelectorAll('.modal__close, .forgot-password-email__cancel');
    forgotCloseButtons.forEach((button) => {
      button.addEventListener('click', () => {
        forgotPasswordEmailDialog.close();
      });
    });
  }

  if (resetPasswordDialog) {
    const resetCloseButtons = resetPasswordDialog.querySelectorAll('.modal__close, .forgot-password-reset__cancel');
    resetCloseButtons.forEach((button) => {
      button.addEventListener('click', () => {
        resetPasswordDialog.close();
      });
    });
  }

  // Initialize status card on load
  updateStatusCard();
}

/**
 * Initialize login menu on page load
 */
async function initializeLoginMenu() {
  await updateLoggedInView();
  await updateStatusCard();
}

// Export to window for non-module usage
window.LoginMenu = {
  registerAccountHandlers,
  initializeLoginMenu,
  updateStatusCard,
  getUserProfile,
  getUserUsage
};
