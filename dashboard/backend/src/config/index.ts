/**
 * Validates that a required environment variable is set.
 * 
 * Throws an error with helpful instructions if the variable is missing,
 * directing the user to add it to ~/.zshrc and source the file.
 * 
 * @param name - The environment variable name to check
 * @returns The value of the environment variable
 */
function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Add it to ~/.zshrc and run: source ~/.zshrc`
    );
  }
  return val;
}

/**
 * Application configuration object containing runtime settings.
 * 
 * All Zoho credentials are sourced from environment variables for security.
 * Credentials should be added to ~/.zshrc (not a .env file) and sourced before starting the server.
 * 
 * @remarks
 * - `port`: Server listen port (default: 3001, can be overridden via PORT env var)
 * - `zoho`: Zoho Sprints API credentials and endpoints
 *   - `clientId`: OAuth client ID (required)
 *   - `clientSecret`: OAuth client secret (required)
 *   - `refreshToken`: OAuth refresh token (required)
 *   - `portalId`: Optional Zoho portal ID (can be null if not configured)
 *   - `workspaceName`: Optional workspace name (can be null if not configured)
 *   - `accountsUrl`: Zoho accounts URL (fixed: https://accounts.zoho.in)
 *   - `apiBaseUrl`: Zoho Sprints API base URL (fixed: https://sprintsapi.zoho.in/zsapi)
 * - `portalId` and `workspaceName` are nullable; if not set in environment, they default to null
 */
export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  zoho: {
    clientId: requireEnv('ZOHO_CLIENT_ID'),
    clientSecret: requireEnv('ZOHO_CLIENT_SECRET'),
    refreshToken: requireEnv('ZOHO_REFRESH_TOKEN'),
    portalId: process.env.ZOHO_PORTAL_ID ?? null,
    workspaceName: process.env.ZOHO_WORKSPACE_NAME ?? null,
    accountsUrl: 'https://accounts.zoho.in',
    apiBaseUrl: 'https://sprintsapi.zoho.in/zsapi',
  },
};
