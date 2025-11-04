// Vercel Serverless Function Entry Point
// This wraps the Express app for backend-only deployment on Vercel

import('../dist/index.js').then((module) => {
  // Export the Express app as a Vercel serverless function
  module.default || module.app;
});

// Re-export the built server
export { default } from '../dist/index.js';
