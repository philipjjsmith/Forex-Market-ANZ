import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import bcrypt from 'bcrypt';
import { storage } from './storage';
import type { User } from '@shared/schema';

// Local Strategy (username/password login)
passport.use('local', new LocalStrategy(
  {
    usernameField: 'email', // Use email instead of username for login
    passwordField: 'password',
  },
  async (email, password, done) => {
    try {
      const user = await storage.getUserByEmail(email);

      if (!user) {
        return done(null, false, { message: 'Incorrect email or password' });
      }

      // Check if user signed up with Google (no password)
      if (!user.password) {
        return done(null, false, { message: 'Please sign in with Google' });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return done(null, false, { message: 'Incorrect email or password' });
      }

      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }
));

// Google OAuth Strategy (only initialize if credentials are provided)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use('google', new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists with this Google ID
        let user = await storage.getUserByGoogleId(profile.id);

        if (user) {
          return done(null, user);
        }

        // Check if user exists with this email
        const email = profile.emails?.[0]?.value;
        if (email) {
          user = await storage.getUserByEmail(email);

          if (user) {
            // Link Google account to existing user
            await storage.updateUserGoogleId(user.id, profile.id);
            return done(null, user);
          }
        }

        // Create new user
        const newUser = await storage.createUser({
          username: profile.displayName || profile.emails?.[0]?.value?.split('@')[0] || 'user',
          email: email || `${profile.id}@google.com`,
          password: '', // No password for Google users
        }, profile.id);

        return done(null, newUser);
      } catch (error) {
        return done(error as Error);
      }
    }
  ));
  console.log('✅ Google OAuth enabled');
} else {
  console.log('⚠️  Google OAuth disabled (credentials not configured)');
}

// Serialize user to session
passport.serializeUser((user: Express.User, done) => {
  done(null, (user as User).id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await storage.getUser(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export default passport;
