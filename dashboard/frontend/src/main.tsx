/**
 * Main entry point for the Zonaliser frontend application.
 *
 * This module initializes the React application by mounting the App component
 * to the root DOM element (`<div id="root">` in the HTML template). It enables
 * React StrictMode to surface potential issues during development and imports
 * the global CSS styles that apply across the entire application.
 *
 * The React 18+ concurrent rendering API (`createRoot`) is used, which supports
 * automatic batching, transitions, and streaming SSR hydration.
 *
 * @module Entry Point
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

/**
 * Retrieves the root DOM element where the React application will be mounted.
 * Throws a fatal error if the root element is not found, since the app cannot
 * render without a valid mount point.
 *
 * NOTE: This logic runs at module evaluation time (top-level scope). The
 * `document.getElementById` call will only succeed after the DOM has been
 * parsed, which is guaranteed because this script is placed at the end of
 * the HTML `<body>` (or loaded with `defer`).
 *
 * @returns {HTMLElement} The root element
 * @throws {Error} If the root element with id 'root' is not found
 */
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

/**
 * Renders the React application with StrictMode enabled.
 *
 * StrictMode helps detect potential issues in development by:
 * - Warning about side effects in event handlers
 * - Warning about multiple render passes (simulating user-visible behavior)
 * - Warning about changes to refs and context
 * - Checking that all components have a display name
 *
 * `createRoot` is the React 18+ concurrent rendering API. Compared to the
 * legacy `ReactDOM.render`, it enables:
 * - Automatic batching of state updates across event handlers and callbacks
 * - Support for React transitions (`useTransition`, `useDeferredValue`)
 * - Streaming server-side rendering with `Suspense`
 *
 * The `<App />` component is the root of the component tree and is expected
 * to handle routing, state management, and layout for the entire application.
 */
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
