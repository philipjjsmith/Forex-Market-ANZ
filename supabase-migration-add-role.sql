-- Migration: Add role field to users table
-- Date: 2025-10-21
-- Description: Adds role column to users table for role-based access control
--              Sets existing user to admin role

-- Step 1: Add role column to users table (if not exists)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Step 2: Update the specific user to have admin role
-- Replace the email with your admin account email
UPDATE users
SET role = 'admin'
WHERE email = 'philipsmith33105@gmail.com';

-- Step 3: Create index on role column for better query performance
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Step 4: Verify the changes
-- Run this query after migration to confirm:
-- SELECT id, username, email, role FROM users WHERE email = 'philipsmith33105@gmail.com';

-- Notes:
-- - All new users will automatically get 'user' role (set by DEFAULT)
-- - Only users with role='admin' can access /api/admin/* and /api/ai/* endpoints
-- - Frontend also hides admin navigation for non-admin users
-- - This migration is idempotent (safe to run multiple times)
