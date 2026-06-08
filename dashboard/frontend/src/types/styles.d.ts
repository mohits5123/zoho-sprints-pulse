/**
 * Declares a module augmentation for any file matching '*.css'.
 * This allows TypeScript to correctly handle CSS imports (e.g., `import styles from './style.css'`)
 * without compiler errors when using CSS modules in the frontend.
 */
declare module '*.css';