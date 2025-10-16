import { type User, type InsertUser, type SavedSignal } from "@shared/schema";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";

// Database imports for DrizzleStorage (commented out - using Supabase client instead)
// import { users, savedSignals } from "@shared/schema";
// import { eq, and, gt } from "drizzle-orm";
// import { db } from "./db";

// Supabase client for REST API access (avoids IPv6 networking issues)
import { supabase } from "./supabase";

const SALT_ROUNDS = 10;

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  createUser(user: InsertUser, googleId?: string): Promise<User>;
  updateUserGoogleId(userId: string, googleId: string): Promise<void>;
  updateUserPassword(userId: string, hashedPassword: string): Promise<void>;
  setPasswordResetToken(userId: string, token: string, expires: Date): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  clearPasswordResetToken(userId: string): Promise<void>;
  // Saved signals methods
  getSavedSignals(userId: string): Promise<SavedSignal[]>;
  saveSignal(userId: string, signalData: any, candles: any): Promise<SavedSignal>;
  unsaveSignal(signalId: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private savedSignals: Map<string, SavedSignal>;

  constructor() {
    this.users = new Map();
    this.savedSignals = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.googleId === googleId,
    );
  }

  async createUser(insertUser: InsertUser, googleId?: string): Promise<User> {
    const id = randomUUID();

    // Hash password if provided
    let hashedPassword: string | null = null;
    if (insertUser.password) {
      hashedPassword = await bcrypt.hash(insertUser.password, SALT_ROUNDS);
    }

    const user: User = {
      id,
      username: insertUser.username,
      email: insertUser.email,
      password: hashedPassword,
      googleId: googleId || null,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      createdAt: new Date(),
    };

    this.users.set(id, user);
    return user;
  }

  async updateUserGoogleId(userId: string, googleId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.googleId = googleId;
      this.users.set(userId, user);
    }
  }

  async updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.password = hashedPassword;
      this.users.set(userId, user);
    }
  }

  async setPasswordResetToken(userId: string, token: string, expires: Date): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.resetPasswordToken = token;
      user.resetPasswordExpires = expires;
      this.users.set(userId, user);
    }
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.resetPasswordToken === token &&
                user.resetPasswordExpires &&
                user.resetPasswordExpires > new Date()
    );
  }

  async clearPasswordResetToken(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      this.users.set(userId, user);
    }
  }

  // Saved signals methods
  async getSavedSignals(userId: string): Promise<SavedSignal[]> {
    return Array.from(this.savedSignals.values()).filter(
      (signal) => signal.userId === userId
    );
  }

  async saveSignal(userId: string, signalData: any, candles: any): Promise<SavedSignal> {
    const id = randomUUID();
    const signal: SavedSignal = {
      id,
      userId,
      signalData,
      candles,
      savedAt: new Date(),
    };
    this.savedSignals.set(id, signal);
    return signal;
  }

  async unsaveSignal(signalId: string): Promise<void> {
    this.savedSignals.delete(signalId);
  }
}

// DrizzleStorage - PostgreSQL database implementation
export class DrizzleStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0];
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser, googleId?: string): Promise<User> {
    // Hash password if provided
    let hashedPassword: string | null = null;
    if (insertUser.password) {
      hashedPassword = await bcrypt.hash(insertUser.password, SALT_ROUNDS);
    }

    const newUser = {
      username: insertUser.username,
      email: insertUser.email,
      password: hashedPassword,
      googleId: googleId || null,
    };

    const result = await db.insert(users).values(newUser).returning();
    return result[0];
  }

  async updateUserGoogleId(userId: string, googleId: string): Promise<void> {
    await db.update(users)
      .set({ googleId })
      .where(eq(users.id, userId));
  }

  async updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
    await db.update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, userId));
  }

  async setPasswordResetToken(userId: string, token: string, expires: Date): Promise<void> {
    await db.update(users)
      .set({
        resetPasswordToken: token,
        resetPasswordExpires: expires
      })
      .where(eq(users.id, userId));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(
      and(
        eq(users.resetPasswordToken, token),
        gt(users.resetPasswordExpires, new Date())
      )
    ).limit(1);
    return result[0];
  }

  async clearPasswordResetToken(userId: string): Promise<void> {
    await db.update(users)
      .set({
        resetPasswordToken: null,
        resetPasswordExpires: null
      })
      .where(eq(users.id, userId));
  }

  // Saved signals methods
  async getSavedSignals(userId: string): Promise<SavedSignal[]> {
    return await db.select().from(savedSignals).where(eq(savedSignals.userId, userId));
  }

  async saveSignal(userId: string, signalData: any, candles: any): Promise<SavedSignal> {
    const result = await db.insert(savedSignals)
      .values({
        userId,
        signalData,
        candles,
      })
      .returning();
    return result[0];
  }

  async unsaveSignal(signalId: string): Promise<void> {
    await db.delete(savedSignals).where(eq(savedSignals.id, signalId));
  }
}

// SupabaseStorage - Uses Supabase REST API (avoids IPv6 networking issues)
export class SupabaseStorage implements IStorage {
  // Helper to convert snake_case DB columns to camelCase User type
  private mapToUser(data: any): User {
    return {
      id: data.id,
      username: data.username,
      email: data.email,
      password: data.password,
      googleId: data.google_id,
      resetPasswordToken: data.reset_password_token,
      resetPasswordExpires: data.reset_password_expires ? new Date(data.reset_password_expires) : null,
      createdAt: new Date(data.created_at),
    };
  }

  async getUser(id: string): Promise<User | undefined> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return undefined;
    return this.mapToUser(data);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !data) return undefined;
    return this.mapToUser(data);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) return undefined;
    return this.mapToUser(data);
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .single();

    if (error || !data) return undefined;
    return this.mapToUser(data);
  }

  async createUser(insertUser: InsertUser, googleId?: string): Promise<User> {
    // Hash password if provided
    let hashedPassword: string | null = null;
    if (insertUser.password) {
      hashedPassword = await bcrypt.hash(insertUser.password, SALT_ROUNDS);
    }

    console.log('🔐 Creating user:', {
      email: insertUser.email,
      username: insertUser.username,
      hasPassword: !!insertUser.password,
      hashedPasswordLength: hashedPassword?.length || 0,
    });

    const { data, error } = await supabase
      .from('users')
      .insert({
        username: insertUser.username,
        email: insertUser.email,
        password: hashedPassword,
        google_id: googleId || null,
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Supabase insert error:', error);
      throw new Error(`Failed to create user: ${error.message}`);
    }

    console.log('✅ User created successfully:', {
      id: data.id,
      hasPasswordInDB: !!data.password,
      passwordLengthInDB: data.password?.length || 0,
    });

    return this.mapToUser(data);
  }

  async updateUserGoogleId(userId: string, googleId: string): Promise<void> {
    await supabase
      .from('users')
      .update({ google_id: googleId })
      .eq('id', userId);
  }

  async updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
    await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', userId);
  }

  async setPasswordResetToken(userId: string, token: string, expires: Date): Promise<void> {
    await supabase
      .from('users')
      .update({
        reset_password_token: token,
        reset_password_expires: expires.toISOString(),
      })
      .eq('id', userId);
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('reset_password_token', token)
      .gt('reset_password_expires', new Date().toISOString())
      .single();

    if (error || !data) return undefined;
    return this.mapToUser(data);
  }

  async clearPasswordResetToken(userId: string): Promise<void> {
    await supabase
      .from('users')
      .update({
        reset_password_token: null,
        reset_password_expires: null,
      })
      .eq('id', userId);
  }

  // Helper to convert snake_case DB columns to camelCase SavedSignal type
  private mapToSavedSignal(data: any): SavedSignal {
    return {
      id: data.id,
      userId: data.user_id,
      signalData: data.signal_data,
      candles: data.candles,
      savedAt: new Date(data.saved_at),
    };
  }

  // Saved signals methods
  async getSavedSignals(userId: string): Promise<SavedSignal[]> {
    const { data, error } = await supabase
      .from('saved_signals')
      .select('*')
      .eq('user_id', userId);

    if (error || !data) return [];
    return data.map(item => this.mapToSavedSignal(item));
  }

  async saveSignal(userId: string, signalData: any, candles: any): Promise<SavedSignal> {
    const { data, error } = await supabase
      .from('saved_signals')
      .insert({
        user_id: userId,
        signal_data: signalData,
        candles: candles,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save signal: ${error.message}`);
    }

    return this.mapToSavedSignal(data);
  }

  async unsaveSignal(signalId: string): Promise<void> {
    await supabase
      .from('saved_signals')
      .delete()
      .eq('id', signalId);
  }
}

// Use Supabase client storage (avoids IPv6 networking issues)
export const storage = new SupabaseStorage();
