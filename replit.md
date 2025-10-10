# Market Analysis & Tracking Platform

## Overview

This is a professional market analysis and trading platform designed for forex and financial market tracking. The application provides real-time data visualization, technical analysis tools, trading signal generation, and portfolio management capabilities. Built with a focus on performance and data clarity, it delivers a TradingView-inspired experience with comprehensive technical indicators and multi-timeframe analysis.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Core Framework**: React with TypeScript using Vite as the build tool and development server. The application follows a component-based architecture with a clear separation between presentation components and business logic.

**UI Component System**: Utilizes shadcn/ui (Radix UI primitives) with a custom design system inspired by TradingView and Yahoo Finance. The design emphasizes information density, professional aesthetics, and data clarity with a carefully crafted color palette for financial data visualization (market green #059669 for gains, market red #DC2626 for losses).

**Styling Approach**: Tailwind CSS with custom configuration implementing a comprehensive design system. The configuration includes custom border radius values, HSL-based color system with CSS variables for theme support, and specialized spacing primitives optimized for financial dashboards.

**State Management**: React Query (@tanstack/react-query) for server state management and data fetching. Local component state managed with React hooks. LocalStorage used for persisting user preferences like saved trading signals.

**Routing**: Wouter for lightweight client-side routing, currently implementing a single dashboard view with potential for expansion.

**Charts & Visualization**: Recharts library for rendering price charts, technical indicators, and market data visualizations with support for candlestick patterns, moving averages, and volume displays.

### Backend Architecture

**Server Framework**: Express.js serving as a lightweight API layer and static file server for the React application.

**Development Setup**: Custom Vite middleware integration for hot module replacement (HMR) during development. Production builds are bundled separately using esbuild for the server code.

**API Pattern**: RESTful API design with routes prefixed under `/api`. The current implementation uses an in-memory storage layer with a clean interface designed for easy migration to persistent storage.

**Session Management**: Infrastructure in place for session-based authentication using connect-pg-simple, though full authentication is not yet implemented.

### Data Architecture

**ORM & Database**: Drizzle ORM configured for PostgreSQL via Neon serverless driver. Schema definitions are centralized in the shared directory for type safety across frontend and backend.

**Current Schema**: Basic user authentication schema with plans for expansion to include market data, watchlists, portfolios, and trading signals.

**Data Validation**: Zod schemas integrated with Drizzle for runtime type validation and form validation using @hookform/resolvers.

**Technical Indicators Engine**: Custom implementation of technical analysis indicators (SMA, EMA, RSI, ATR, ADX, Bollinger Bands) built in TypeScript with a strategy pattern for signal generation. The MA Crossover Multi-Timeframe strategy analyzes multiple timeframes to generate comprehensive trading signals.

### External Dependencies

**Database**: PostgreSQL via @neondatabase/serverless for serverless-compatible database connections. Drizzle ORM handles schema management and migrations.

**UI Components**: Extensive use of Radix UI primitives (@radix-ui/*) for accessible, unstyled component foundations. These are styled using Tailwind CSS following the shadcn/ui pattern.

**Typography**: Google Fonts integration with Inter (UI elements), Roboto (data tables), and JetBrains Mono (prices/monospace data) to match financial application conventions.

**Development Tools**: 
- Replit-specific plugins for development banner and runtime error overlay
- TypeScript for type safety across the entire stack
- Vite for fast development builds and optimized production bundles

**Chart Library**: Recharts for declarative chart components with full TypeScript support and customization capabilities.

**Date Handling**: date-fns for date manipulation and formatting in a functional programming style.

**Form Management**: React Hook Form with Zod resolvers for type-safe form validation and state management.

**Utility Libraries**:
- clsx and tailwind-merge (via cn utility) for conditional className composition
- class-variance-authority for type-safe variant-based component styling
- cmdk for command palette/search functionality
- embla-carousel-react for carousel implementations

### Key Architectural Decisions

**Monorepo Structure**: Organized into three main directories - `client` (frontend), `server` (backend), and `shared` (common types and schemas). This promotes code reuse and type safety across the stack.

**Type Safety**: Full TypeScript implementation with path aliases (@/, @shared/) for clean imports. Drizzle's type inference provides end-to-end type safety from database to UI.

**Mock Data Strategy**: Comprehensive mock data generation for development and testing, particularly for candle data and technical indicators, allowing frontend development without external data dependencies.

**Modular Indicator System**: Technical indicators are implemented as static methods in a shared class, making them reusable across strategies and easy to test independently.

**Signal Architecture**: Trading signals are generated with complete metadata including entry/exit points, risk/reward ratios, confidence scores, and detailed rationale. Signals support multiple order types (market, limit, stop) and execution strategies.

**Responsive Design**: Mobile-first approach with custom breakpoint handling and device detection hooks for optimal display across screen sizes.

**Theme System**: Dual theme support (light/dark) using CSS variables and Tailwind's dark mode class strategy, with financial-specific color semantics preserved across themes.