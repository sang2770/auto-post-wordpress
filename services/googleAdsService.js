const { GoogleAdsApi, enums } = require('google-ads-api');
const StorageService = require('./storageService');

class GoogleAdsService {
    constructor() {
        this.client = null;
        this.storageService = new StorageService();
        this.customers = new Map(); // Cache for customer accounts
        this.validateEnvironment();
    }

    // Validate required environment variables
    validateEnvironment() {
        const required = [
            'GOOGLE_ADS_CLIENT_ID',
            'GOOGLE_ADS_CLIENT_SECRET',
            'GOOGLE_ADS_DEVELOPER_TOKEN'
        ];

        const missing = required.filter(env => !process.env[env]);

        if (missing.length > 0) {
            console.error('Missing required Google Ads environment variables:', missing);
            console.error('Please set the following environment variables:');
            missing.forEach(env => console.error(`- ${env}`));
        }
    }

    // Initialize Google Ads API client for a specific customer
    async initAuthForCustomer(customerId) {
        try {
            const config = await this.storageService.getConfig();
            const accountAuth = config?.googleAdsAccounts?.[customerId];

            if (!accountAuth?.refresh_token) {
                throw new Error(`No authentication found for customer ${customerId}. Please authenticate this account first.`);
            }

            // Create client for specific customer
            const client = new GoogleAdsApi({
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
                refresh_token: accountAuth.refresh_token,
            });

            console.log(`Google Ads API client initialized for customer: ${customerId}`);
            return client;
        } catch (error) {
            console.error(`Error initializing Google Ads auth for customer ${customerId}:`, error);
            throw new Error(`Failed to initialize auth for customer ${customerId}: ${error.message}`);
        }
    }

    // Initialize Google Ads API with OAuth 2.0 authentication (legacy method - kept for compatibility)
    async initAuth(customerId = null) {
        if (customerId) {
            return this.initAuthForCustomer(customerId);
        }

        if (this.client) {
            return this.client;
        }

        try {
            // Load OAuth tokens from storage
            const config = await this.storageService.getConfig();
            const googleAdsAuth = config?.googleAdsAuth;

            if (!googleAdsAuth || !googleAdsAuth.refresh_token) {
                throw new Error('Google Ads authentication not configured. Please run OAuth setup first.');
            }

            // Initialize Google Ads API client with OAuth 2.0
            this.client = new GoogleAdsApi({
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
                refresh_token: googleAdsAuth.refresh_token,
            });

            console.log('Google Ads API authentication initialized successfully with OAuth 2.0');
            return this.client;
        } catch (error) {
            console.error('Error initializing Google Ads authentication:', error);
            throw new Error(`Failed to initialize Google Ads auth: ${error.message}`);
        }
    }

    // Save OAuth tokens for a specific customer account
    async saveAuthTokensForCustomer(customerId, customerName, tokens) {
        try {
            let config = await this.storageService.getConfig() || {};

            // Initialize googleAdsAccounts if it doesn't exist
            if (!config.googleAdsAccounts) {
                config.googleAdsAccounts = {};
            }

            config.googleAdsAccounts[customerId] = {
                customerName: customerName,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: tokens.expiry_date,
                scope: tokens.scope,
                authenticatedAt: new Date().toISOString()
            };

            config.lastUpdated = new Date().toISOString();
            await this.storageService.saveConfig(config);

            console.log(`Google Ads OAuth tokens saved for customer: ${customerId} (${customerName})`);
        } catch (error) {
            console.error(`Error saving Google Ads OAuth tokens for customer ${customerId}:`, error);
            throw error;
        }
    }

    // Save OAuth tokens after authentication (legacy method - kept for compatibility)
    async saveAuthTokens(tokens) {
        try {
            let config = await this.storageService.getConfig() || {};

            config.googleAdsAuth = {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: tokens.expiry_date,
                scope: tokens.scope
            };

            config.lastUpdated = new Date().toISOString();
            await this.storageService.saveConfig(config);

            console.log('Google Ads OAuth tokens saved successfully');
        } catch (error) {
            console.error('Error saving Google Ads OAuth tokens:', error);
            throw error;
        }
    }

    // Check if authentication is configured for a specific customer
    async isAuthConfiguredForCustomer(customerId) {
        try {
            const config = await this.storageService.getConfig();
            return !!(config?.googleAdsAccounts?.[customerId]?.refresh_token);
        } catch (error) {
            console.error(`Error checking auth config for customer ${customerId}:`, error);
            return false;
        }
    }

    // Check if authentication is configured (legacy method)
    async isAuthConfigured() {
        try {
            const config = await this.storageService.getConfig();
            return !!(config?.googleAdsAuth?.refresh_token);
        } catch (error) {
            return false;
        }
    }

    // Get list of authenticated accounts
    async getAuthenticatedAccounts() {
        try {
            const config = await this.storageService.getConfig();
            const accounts = config?.googleAdsAccounts || {};

            return Object.entries(accounts).map(([customerId, accountData]) => ({
                customerId,
                customerName: accountData.customerName,
                authenticatedAt: accountData.authenticatedAt,
                hasValidToken: !!(accountData.refresh_token)
            }));
        } catch (error) {
            console.error('Error getting authenticated accounts:', error);
            return [];
        }
    }

    // Generate OAuth URL for user authentication
    generateAuthUrl(customerId = null, customerName = null) {
        const { OAuth2Client } = require('google-auth-library');

        const oauth2Client = new OAuth2Client(
            process.env.GOOGLE_ADS_CLIENT_ID,
            process.env.GOOGLE_ADS_CLIENT_SECRET,
            'http://localhost:3000/api/google-ads/auth/callback'
        );

        const scopes = ['https://www.googleapis.com/auth/adwords'];

        // Include customer info in state parameter
        const state = customerId ? JSON.stringify({ customerId, customerName }) : null;

        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent', // Force consent to get refresh token
            ...(state && { state })
        });
    }

    // Handle OAuth callback
    async handleAuthCallback(code, state = null) {
        const { OAuth2Client } = require('google-auth-library');

        const oauth2Client = new OAuth2Client(
            process.env.GOOGLE_ADS_CLIENT_ID,
            process.env.GOOGLE_ADS_CLIENT_SECRET,
            'http://localhost:3000/api/google-ads/auth/callback'
        );

        const { tokens } = await oauth2Client.getToken(code);

        // If state is provided, save tokens for specific customer
        if (state) {
            try {
                const customerInfo = JSON.parse(state);
                await this.saveAuthTokensForCustomer(
                    customerInfo.customerId,
                    customerInfo.customerName,
                    tokens
                );
                console.log(`Authentication completed for customer: ${customerInfo.customerId}`);
            } catch (error) {
                console.error('Error parsing state parameter:', error);
                // Fallback to legacy method
                await this.saveAuthTokens(tokens);
            }
        } else {
            // Legacy method - save as general auth
            await this.saveAuthTokens(tokens);
        }

        // Reset client to force re-initialization with new tokens
        this.client = null;

        return tokens;
    }

    // Get all accessible customer accounts (no refresh token needed)
    async getCustomerAccounts() {
        try {
            await this.initAuth();

            const customer = this.client.Customer({
                customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
            });

            const query = `
        SELECT
          customer_client.descriptive_name,
          customer_client.id,
          customer_client.manager,
          customer_client.test_account,
          customer_client.currency_code
        FROM customer_client
        WHERE customer_client.status = 'ENABLED'
      `;

            const response = await customer.query(query);

            const accounts = response.map(row => ({
                id: row.customer_client.id,
                name: row.customer_client.descriptive_name,
                isManager: row.customer_client.manager,
                isTestAccount: row.customer_client.test_account,
                currencyCode: row.customer_client.currency_code,
            }));

            // Cache the accounts
            accounts.forEach(account => {
                this.customers.set(account.id, account);
            });

            return accounts;
        } catch (error) {
            console.error('Error getting customer accounts:', error);
            throw new Error(`Failed to get customer accounts: ${error.message}`);
        }
    }

    // Get campaign data for a specific customer account using individual authentication
    async getCampaignData(customerId, dateRange = 'LAST_30_DAYS') {
        try {
            const client = await this.initAuthForCustomer(customerId);

            const customer = client.Customer({
                customer_id: customerId,
            });

            const query = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversion_value_micros,
          metrics.ctr,
          metrics.average_cpc,
          segments.date
        FROM campaign
        WHERE 
          campaign.status != 'REMOVED'
          AND segments.date DURING ${dateRange}
        ORDER BY segments.date DESC
      `;

            const response = await customer.query(query);

            return response.map(row => ({
                campaignId: row.campaign.id,
                campaignName: row.campaign.name,
                status: row.campaign.status,
                channelType: row.campaign.advertising_channel_type,
                date: row.segments.date,
                impressions: parseInt(row.metrics.impressions) || 0,
                clicks: parseInt(row.metrics.clicks) || 0,
                cost: (parseInt(row.metrics.cost_micros) || 0) / 1000000, // Convert micros to currency
                conversions: parseFloat(row.metrics.conversions) || 0,
                conversionValue: (parseInt(row.metrics.conversion_value_micros) || 0) / 1000000,
                ctr: parseFloat(row.metrics.ctr) || 0,
                averageCpc: (parseInt(row.metrics.average_cpc) || 0) / 1000000,
            }));
        } catch (error) {
            console.error('Error getting campaign data:', error);
            throw new Error(`Failed to get campaign data: ${error.message}`);
        }
    }

    // Get aggregated campaign data (summary by campaign) - no refresh token needed
    async getAggregatedCampaignData(customerId, dateRange = 'LAST_30_DAYS') {
        try {
            const campaignData = await this.getCampaignData(customerId, dateRange);

            // Group by campaign and aggregate metrics
            const aggregated = {};

            campaignData.forEach(data => {
                const key = data.campaignName;

                if (!aggregated[key]) {
                    aggregated[key] = {
                        campaignName: data.campaignName,
                        campaignId: data.campaignId,
                        status: data.status,
                        channelType: data.channelType,
                        totalImpressions: 0,
                        totalClicks: 0,
                        totalCost: 0,
                        totalConversions: 0,
                        totalConversionValue: 0,
                        avgCtr: 0,
                        avgCpc: 0,
                        dataPoints: 0
                    };
                }

                aggregated[key].totalImpressions += data.impressions;
                aggregated[key].totalClicks += data.clicks;
                aggregated[key].totalCost += data.cost;
                aggregated[key].totalConversions += data.conversions;
                aggregated[key].totalConversionValue += data.conversionValue;
                aggregated[key].avgCtr += data.ctr;
                aggregated[key].avgCpc += data.averageCpc;
                aggregated[key].dataPoints += 1;
            });

            // Calculate averages
            Object.values(aggregated).forEach(campaign => {
                if (campaign.dataPoints > 0) {
                    campaign.avgCtr = campaign.avgCtr / campaign.dataPoints;
                    campaign.avgCpc = campaign.avgCpc / campaign.dataPoints;
                }
            });

            return Object.values(aggregated);
        } catch (error) {
            console.error('Error getting aggregated campaign data:', error);
            throw new Error(`Failed to get aggregated campaign data: ${error.message}`);
        }
    }

    // Match campaign names with store names from Google Sheets
    async matchCampaignWithStoreData(campaigns, storeData) {
        try {
            const matchedData = [];

            campaigns.forEach(campaign => {
                // Find matching store in sheet data
                const matchingStore = storeData.find(store => {
                    // Normalize names for comparison
                    const storeName = (store['Chiến dịch'] || store['Campaign'] || '').toLowerCase().trim();
                    const campaignName = campaign.campaignName.toLowerCase().trim();

                    // Check for exact match or partial match
                    return storeName === campaignName ||
                        storeName.includes(campaignName) ||
                        campaignName.includes(storeName);
                });

                if (matchingStore) {
                    matchedData.push({
                        ...matchingStore,
                        // Add Google Ads data
                        adsData: {
                            campaignId: campaign.campaignId,
                            campaignName: campaign.campaignName,
                            status: campaign.status,
                            totalClicks: campaign.totalClicks,
                            totalCost: campaign.totalCost,
                            totalImpressions: campaign.totalImpressions,
                            totalConversions: campaign.totalConversions,
                            avgCtr: campaign.avgCtr,
                            avgCpc: campaign.avgCpc
                        }
                    });
                }
            });

            return matchedData;
        } catch (error) {
            console.error('Error matching campaign with store data:', error);
            throw new Error(`Failed to match campaign with store data: ${error.message}`);
        }
    }
}

module.exports = GoogleAdsService;
