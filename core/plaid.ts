import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';

export function isPlaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error('Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to your .env file.');
  }
  const env = process.env.PLAID_ENV ?? 'sandbox';
  const config = new Configuration({
    basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });
  return new PlaidApi(config);
}

export async function createLinkToken(userId: string, daysRequested = 180) {
  const response = await getPlaidClient().linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Fungible',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
    transactions: { days_requested: daysRequested },
  });
  return response.data.link_token;
}

export async function exchangePublicToken(publicToken: string) {
  const response = await getPlaidClient().itemPublicTokenExchange({ public_token: publicToken });
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}
