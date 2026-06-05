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
