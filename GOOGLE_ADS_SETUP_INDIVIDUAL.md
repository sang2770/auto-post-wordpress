# Google Ads API OAuth 2.0 Setup Guide (Individual Account Authentication)

## Prerequisites

To use the Google Ads integration, you need to set up OAuth 2.0 authentication with Google Ads API. This system supports individual account authentication - each Google Ads account needs to be authenticated separately (no MCC/Manager account required).

## Step 1: Create Google Ads API Application

1. Go to the [Google Ads API Center](https://developers.google.com/google-ads/api/docs/first-call/overview)
2. Create a new Google Cloud Project or use an existing one
3. Enable the Google Ads API for your project
4. Create OAuth 2.0 credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Navigate to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - Choose "Web application" as the application type
   - Add authorized redirect URIs:
     - `http://localhost:3000/api/google-ads/auth/callback` (for local development)
     - `https://yourdomain.com/api/google-ads/auth/callback` (for production)

## Step 2: Get Developer Token

1. Apply for a Google Ads API Developer Token:
   - Go to [Google Ads Manager Account](https://ads.google.com/)
   - Navigate to Tools & Settings > Setup > API Center
   - Apply for API access and wait for approval
   - Once approved, you'll receive a Developer Token

## Step 3: Configure Environment Variables

Create a `.env` file in your project root with the following variables:

```env
# Google Ads API OAuth 2.0 Configuration
GOOGLE_ADS_CLIENT_ID=your-oauth-client-id
GOOGLE_ADS_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_ADS_DEVELOPER_TOKEN=your-developer-token
```

**Note:** No manager account ID is needed for individual account authentication.

## Step 4: Install Dependencies

Make sure you have the required npm packages installed:

```bash
npm install google-ads-api
```

## Step 5: Individual Account Authentication Flow

1. Start your application: `npm start`
2. Navigate to the Google Ads page: `http://localhost:3000/google-ads.html`
3. In the "Quản Lý Tài Khoản" section:
   - Enter the Customer ID (e.g., "123-456-7890")
   - Enter a display name for the account
   - Click "Xác thực" to start OAuth flow for that specific account
4. You'll be redirected to Google's consent screen
5. Grant the necessary permissions
6. You'll be redirected back with authentication complete for that account
7. Repeat steps 3-6 for each Google Ads account you want to use

## Authentication Benefits

### Individual Account Approach:

- ✅ No MCC (Manager Customer Center) required
- ✅ Each account has its own refresh token
- ✅ Independent authentication - one account failure doesn't affect others
- ✅ Better security isolation
- ✅ Works with any Google Ads account (standard or manager)

### Features:

- **Multiple Account Support**: Authenticate and manage multiple Google Ads accounts independently
- **Individual Refresh Tokens**: Each account has its own secure authentication
- **Account Management**: View authenticated accounts, re-authenticate when needed
- **Configuration Per Account**: Set up Google Sheets sync for each authenticated account separately

## Required Permissions

Your OAuth application will request the following Google Ads API scopes:

- `https://www.googleapis.com/auth/adwords` - Read and manage Google Ads campaigns

## Data Storage Structure

The system stores authentication data in the following structure:

```json
{
  "googleAdsAccounts": {
    "123-456-7890": {
      "customerName": "Account Name",
      "refresh_token": "refresh_token_here",
      "access_token": "access_token_here",
      "expires_at": "2025-09-11T...",
      "authenticatedAt": "2025-09-11T..."
    }
  },
  "googleAds": {
    "123-456-7890": {
      "customerName": "Account Name",
      "sheetUrls": ["https://docs.google.com/spreadsheets/..."],
      "syncInterval": "daily",
      "lastSync": "2025-09-11T..."
    }
  }
}
```

## Troubleshooting

### Common Issues:

1. **"Developer token not approved"**

   - Your Google Ads API developer token needs approval from Google
   - This can take several days to weeks
   - You can use test accounts while waiting for approval

2. **"Redirect URI mismatch"**

   - Make sure your redirect URI in Google Cloud Console matches exactly
   - Include the full path: `/api/google-ads/auth/callback`

3. **"Client ID not found"**

   - Verify your `GOOGLE_ADS_CLIENT_ID` environment variable is set correctly
   - Make sure you're using the OAuth 2.0 Client ID, not the Service Account ID

4. **"Invalid client secret"**

   - Verify your `GOOGLE_ADS_CLIENT_SECRET` environment variable is set correctly

5. **"Account authentication failed"**
   - Each account needs individual authentication
   - Make sure the Customer ID format is correct (e.g., "123-456-7890")
   - Verify the account owner has granted the necessary permissions

### Testing with Test Accounts

During development, you can use Google Ads test accounts:

1. Create a test manager account in Google Ads
2. Use the test account's customer ID for authentication
3. Test accounts don't require developer token approval

## Production Deployment

For production deployment:

1. Update your OAuth redirect URI to your production domain
2. Make sure your developer token is approved for production use
3. Set the environment variables in your production environment
4. Consider using a secure secret management system for sensitive credentials
5. Each client will need to authenticate their own accounts

## Security Notes

- Never commit your `.env` file to version control
- Use secure environment variable management in production
- Regularly rotate your client secrets
- Monitor API usage and set up billing alerts
- Each account's refresh token is stored separately for security isolation

## API Limits

- Google Ads API has rate limits and quotas
- Monitor your usage in the Google Cloud Console
- Consider implementing caching and batching for efficiency
- Each authenticated account counts toward your API usage limits
