import { API_ENDPOINTS } from '@/config/api';

export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
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

// Register new user
export async function register(username: string, email: string, password: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Important for cookies
      body: JSON.stringify({ username, email, password }),
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

// Login with email and password
export async function login(email: string, password: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Important for cookies
      body: JSON.stringify({ email, password }),
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

// Logout
export async function logout(): Promise<AuthResponse> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      error: 'Logout failed',
    };
  }
}

// Get current authenticated user
export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
      credentials: 'include',
    });

    const data = await response.json();

    if (data.success && data.user) {
      return data.user;
    }

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
