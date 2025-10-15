import { type User, type InsertUser, type SavedSignal, users, savedSignals } from "@shared/schema";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { eq, and, gt } from "drizzle-orm";
import { db } from "./db";

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

// Drizzle ORM Storage Implementation (uses Neon PostgreSQL)
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

    const result = await db.insert(users).values({
      username: insertUser.username,
      email: insertUser.email,
      password: hashedPassword,
      googleId: googleId || null,
    }).returning();

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
        resetPasswordExpires: expires,
      })
      .where(eq(users.id, userId));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const result = await db.select()
      .from(users)
      .where(
        and(
          eq(users.resetPasswordToken, token),
          gt(users.resetPasswordExpires, new Date())
        )
      )
      .limit(1);

    return result[0];
  }

  async clearPasswordResetToken(userId: string): Promise<void> {
    await db.update(users)
      .set({
        resetPasswordToken: null,
        resetPasswordExpires: null,
      })
      .where(eq(users.id, userId));
  }

  // Saved signals methods
  async getSavedSignals(userId: string): Promise<SavedSignal[]> {
    return await db.select()
      .from(savedSignals)
      .where(eq(savedSignals.userId, userId));
  }

  async saveSignal(userId: string, signalData: any, candles: any): Promise<SavedSignal> {
    const result = await db.insert(savedSignals).values({
      userId,
      signalData,
      candles,
    }).returning();

    return result[0];
  }

  async unsaveSignal(signalId: string): Promise<void> {
    await db.delete(savedSignals).where(eq(savedSignals.id, signalId));
  }
}

// Use in-memory storage for now (switch to DrizzleStorage when database is configured)
export const storage = new MemStorage();
