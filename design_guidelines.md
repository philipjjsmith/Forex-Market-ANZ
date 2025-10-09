# Design Guidelines: Market Analysis & Tracking Platform

## Design Approach

**Selected Framework**: Design System Approach (TradingView/Yahoo Finance Reference)
**Justification**: This is a utility-focused, information-dense financial application where performance, data clarity, and professional aesthetics are paramount. The TradingView and Yahoo Finance references provide proven patterns for complex market data visualization.

## Core Design Elements

### A. Color Palette

**Brand & Functional Colors** (as specified):
- Primary: #1E3A8A (deep blue) - navigation, headers, primary actions
- Secondary: #059669 (market green) - positive values, bullish indicators, gains
- Danger: #DC2626 (market red) - negative values, bearish indicators, losses
- Background: #F8FAFC (light grey) - main canvas
- Dark: #1F2937 (charcoal) - text, borders, secondary panels
- Accent: #6366F1 (indigo) - highlights, active states, notifications

**Extended Palette**:
- Success variants: #10B981 (lighter green), #047857 (darker green)
- Error variants: #EF4444 (lighter red), #B91C1C (darker red)
- Neutral grays: #F3F4F6, #E5E7EB, #D1D5DB, #9CA3AF, #6B7280, #374151
- Chart colors: #8B5CF6 (purple), #F59E0B (amber), #14B8A6 (teal) for multi-line indicators
- Warning: #F59E0B (amber) - alerts, pending states

### B. Typography

**Font Families** (as specified):
- Primary: Inter - UI elements, body text, labels
- Secondary: Roboto - data tables, numbers, metrics
- Monospace: JetBrains Mono - prices, trading values, technical indicators

**Type Scale**:
- Display: 32px/40px (Inter SemiBold) - dashboard headers
- H1: 24px/32px (Inter SemiBold) - panel titles
- H2: 20px/28px (Inter Medium) - section headers
- H3: 16px/24px (Inter Medium) - card headers
- Body: 14px/20px (Inter Regular) - general text
- Small: 12px/16px (Inter Regular) - labels, metadata
- Mono Large: 18px/24px (JetBrains Mono Medium) - featured prices
- Mono Regular: 14px/20px (JetBrains Mono Regular) - table data
- Mono Small: 12px/16px (JetBrains Mono Regular) - timestamps, codes

### C. Layout System

**Spacing Primitives**: Tailwind units of 2, 4, 8, 12, 16 (as in p-2, gap-4, m-8, space-y-12, py-16)

**Grid Framework**:
- Dashboard: Multi-panel layout with flexible grid (lg:grid-cols-12)
- Main content: 8-column span, sidebar: 4-column span
- Cards: Grid of 2-3 columns (md:grid-cols-2 lg:grid-cols-3)
- Data tables: Full-width with responsive horizontal scroll
- Chart panels: Minimum 600px height, responsive scaling

**Container Strategy**:
- App shell: Full viewport height with fixed navigation
- Content areas: max-w-7xl with px-4 md:px-6 lg:px-8
- Panels: Contained within grid, overflow handling

### D. Component Library

**Navigation**:
- Top bar: Fixed header with logo, pair selector, time range controls, user actions
- Sidebar (optional): Collapsible watchlist panel with drag-drop
- Tabs: Underlined active state with accent color, for switching views (Charts/Signals/Portfolio)

**Data Visualization**:
- Candlestick charts: Using provided scaffold, with overlay indicators (MA lines, Bollinger Bands)
- Line charts: Price trends, performance graphs with gradient fills
- Bar charts: Volume displays, comparison metrics
- Pie/Donut charts: Portfolio allocation, sector distribution
- Sparklines: Inline mini-charts in tables for quick trends

**Data Tables**:
- Headers: Sticky, sortable columns with arrow indicators
- Rows: Alternating subtle background (#F9FAFB), hover state (#F3F4F6)
- Cells: Monospace fonts for numeric data, right-aligned numbers
- Color coding: Green/red text for positive/negative values
- Pagination: Bottom-aligned with page size selector

**Cards & Panels**:
- White background with subtle shadow (shadow-sm)
- Rounded corners (rounded-lg)
- 16px padding (p-4), headers with border-bottom
- Collapsible sections with chevron indicators
- Stat cards: Large number display with trend arrows and percentage change

**Forms & Controls**:
- Inputs: Border-2, focus ring in primary color, rounded-md
- Selectors: Dropdown with search for pair selection
- Toggles: For auto-refresh, indicator visibility
- Sliders: For confidence filters, time range selection
- Buttons: Primary (bg-primary text-white), Secondary (outline), Danger (bg-danger)

**Signals Display**:
- Signal cards: Entry price, stop loss, take profit targets with visual bars
- Confidence badges: Percentage with color scale (50-70% amber, 70-85% indigo, 85%+ green)
- Order type pills: Rounded-full badges (MARKET, LIMIT, STOP)
- Rationale expansion: Collapsible detail section with technical reasoning

**Status Indicators**:
- Live pulse: Animated green dot for real-time updates
- Trend arrows: TrendingUp/TrendingDown icons with corresponding colors
- Alert badges: Numbered notifications in accent color
- Loading states: Skeleton screens matching content structure

### E. Animations & Interactions

**Micro-interactions** (minimal, purposeful):
- Chart updates: Smooth transitions for new data points (300ms)
- Number changes: CountUp animation for price ticks
- Sort indicators: Subtle rotation on column headers (200ms)
- Panel collapse: Height transition with ease-in-out (250ms)
- Hover effects: Scale 1.02 on interactive cards (150ms)

**Avoid**: Excessive animations that distract from data consumption

## Layout Patterns

**Dashboard Structure**:
1. Fixed header (64px height) - navigation and controls
2. Main grid container with responsive breakpoints:
   - Mobile: Single column stack
   - Tablet: 2-column with priority panels
   - Desktop: 3-4 column grid with customizable layout
3. Chart panel: Prominent placement, 50-60% viewport height
4. Watchlist sidebar: Collapsible, 280px fixed width
5. Signals/Portfolio: Tab-based content switching below charts

**Information Hierarchy**:
- Level 1: Current price and 24h change (largest, most prominent)
- Level 2: Key metrics (volume, high/low, indicators)
- Level 3: Detailed analytics and historical data
- Level 4: Metadata and timestamps

**Responsive Behavior**:
- Desktop (lg:): Full multi-panel layout with sidebar
- Tablet (md:): Stacked panels, collapsible sidebar
- Mobile: Single column with swipeable tabs, sticky price header

## Professional Financial Aesthetics

- **Precision**: All prices to 5 decimal places for forex pairs
- **Clarity**: High contrast for readability, especially for numbers
- **Professionalism**: Minimal decorative elements, focus on functionality
- **Trust**: Consistent color coding (green=up, red=down universally)
- **Density**: Information-rich without clutter, strategic whitespace
- **Real-time feel**: Live updates with visual feedback (pulse, highlights)