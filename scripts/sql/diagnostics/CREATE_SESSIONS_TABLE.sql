-- Create sessions table for storing user sessions
CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP NOT NULL
);

-- Create index for faster lookups on expiration
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions (expire);
