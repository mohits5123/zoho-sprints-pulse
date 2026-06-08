/**
 * Main entry point for the Zonaliser frontend application.
 *
 * This module initializes the React application by mounting the App component
 * to the root DOM element. It sets up StrictMode for development rigor and
 * imports the global CSS styles.
 *
 * @module Entry Point
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

/**
 * Retrieves the root DOM element where the React application will be mounted.
 * Throws an error if the root element is not found in the document.
 *
 * @returns {HTMLElement | null} The root element, or null if not found
 * @throws {Error} If the root element with id 'root' is not found
 */
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

/**
 * Renders the React application with StrictMode enabled.
 *
 * StrictMode helps detect potential issues in development by:
 * - Warning about side effects in event handlers
 * - Warning about multiple render passes
 * - Warning about changes to refs and context
 * - Checking that all components have a display name
 *
 * @param {HTMLElement} root - The root DOM element to mount the application to
 */
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
