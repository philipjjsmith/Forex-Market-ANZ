import { API_ENDPOINTS } from '@/config/api';

export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  token?: string;
  error?: string;
  message?: string;
}

// Get API base URL
const getApiBaseUrl = (): string => {
  if (import.meta.env.PROD) {
    return 'https://forex-market-anz.onrender.com';
  }
  return ''; // Development uses relative URLs (Vite proxy)
};

// Token storage keys
const TOKEN_KEY = 'forex_auth_token';

// Get stored token
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// Set token in localStorage
function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

// Remove token from localStorage
function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Get authorization headers
function getAuthHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
}

// Register new user
export async function register(username: string, email: string, password: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await response.json();

    // Store token if registration successful
    if (data.success && data.token) {
      setToken(data.token);
    }

    return data;
  } catch (error) {
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
}

// Login with email and password
export async function login(email: string, password: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    // Store token if login successful
    if (data.success && data.token) {
      setToken(data.token);
    }

    return data;
  } catch (error) {
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
}

// Logout
export async function logout(): Promise<AuthResponse> {
  // Remove token from localStorage
  removeToken();

  try {
    await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });

    return {
      success: true,
      message: 'Logged out successfully',
    };
  } catch (error) {
    // Even if API call fails, we removed the token locally
    return {
      success: true,
      message: 'Logged out successfully',
    };
  }
}

// Get current authenticated user
export async function getCurrentUser(): Promise<User | null> {
  const token = getToken();

  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (data.success && data.user) {
      return data.user;
    }

    // Token invalid - remove it
    removeToken();
    return null;
  } catch (error) {
    return null;
  }
}

// Request password reset
export async function forgotPassword(email: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
}

// Reset password with token
export async function resetPassword(token: string, password: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token, password }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
}

// Login with Google (redirects to OAuth flow)
export function loginWithGoogle(): void {
  window.location.href = `${getApiBaseUrl()}/api/auth/google`;
}
