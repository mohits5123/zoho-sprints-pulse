/**
 * Type declaration for CSS module imports.
 *
 * This module declaration tells TypeScript that any file with a `.css` extension
 * can be imported as a module, and that the import will resolve to a record of
 * string-to-string key-value pairs (the CSS class names defined in the stylesheet).
 *
 * This is essential for projects using CSS Modules, where imported styles are
 * automatically scoped and hashed by the build tool (e.g., Vite, Webpack).
 * Without this declaration, TypeScript would raise an error on statements like:
 *
 *   import styles from './Button.css';
 *
 * @module styles
 */
declare module '*.css';