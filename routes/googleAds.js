const express = require('express');
const router = express.Router();
const GoogleAdsService = require('../services/googleAdsService');
const GoogleSheetsService = require('../services/googleSheetsService');
const StorageService = require('../services/storageService');
const { updateSheetWithAdsData, syncSingleAccount } = require('../services/googleAdsHelpers');

const googleAdsService = new GoogleAdsService();
const googleSheetsService = new GoogleSheetsService();
const storageService = new StorageService();

// Check authentication status for a specific customer
router.get('/auth/status/:customerId', async (req, res) => {
    try {
        const { customerId } = req.params;
        const isAuthenticated = await googleAdsService.isAuthConfiguredForCustomer(customerId);
        res.json({
            success: true,
            customerId,
            isAuthenticated
        });
    } catch (error) {
        console.error('Error checking auth status for customer:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all authenticated accounts
router.get('/auth/accounts', async (req, res) => {
    try {
        const accounts = await googleAdsService.getAuthenticatedAccounts();
        res.json({
            success: true,
            accounts
        });
    } catch (error) {
        console.error('Error getting authenticated accounts:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Check authentication status
router.get('/auth/status', async (req, res) => {
    try {
        const isConfigured = await googleAdsService.isAuthConfigured();
        res.json({
            success: true,
            isAuthenticated: isConfigured
        });
    } catch (error) {
        console.error('Error checking auth status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Start OAuth flow for specific customer
router.get('/auth/start/:customerId', async (req, res) => {
    try {
        const { customerId } = req.params;
        const { customerName } = req.query;

        const authUrl = googleAdsService.generateAuthUrl(customerId, customerName);
        res.json({
            success: true,
            authUrl
        });
    } catch (error) {
        console.error('Error starting auth flow for customer:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Start OAuth flow
router.get('/auth/start', async (req, res) => {
    try {
        const authUrl = googleAdsService.generateAuthUrl();
        res.json({
            success: true,
            authUrl
        });
    } catch (error) {
        console.error('Error starting auth flow:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// OAuth callback
router.get('/auth/callback', async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.status(400).send('Authorization code not provided');
        }

        await googleAdsService.handleAuthCallback(code, state);

        const customerInfo = state ? JSON.parse(state) : null;
        const customerName = customerInfo?.customerName || 'account';

        res.send(`
            <html>
                <body>
                    <h1>Authentication Successful!</h1>
                    <p>Google Ads API has been authenticated successfully for ${customerName}.</p>
                    <p>You can close this window and return to the application.</p>
                    <script>
                        setTimeout(() => {
                            window.close();
                        }, 3000);
                    </script>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('Error handling auth callback:', error);
        res.status(500).send(`Authentication failed: ${error.message}`);
    }
});

// Get Google Ads configuration
router.get('/config', async (req, res) => {
    try {
        const config = await storageService.getConfig() || {};
        const googleAdsConfig = config.googleAds || {};
        const isAuthenticated = await googleAdsService.isAuthConfigured();

        res.json({
            success: true,
            googleAdsConfig,
            isAuthenticated
        });
    } catch (error) {
        console.error('Error getting configuration:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all customer accounts (using service account - no refresh token needed)
router.get('/accounts', async (req, res) => {
    try {
        const accounts = await googleAdsService.getCustomerAccounts();
        res.json({
            success: true,
            accounts
        });
    } catch (error) {
        console.error('Error getting accounts:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get campaign data for a specific account (using service account)
router.get('/campaigns/:customerId', async (req, res) => {
    try {
        const { customerId } = req.params;
        const { date_range = 'LAST_30_DAYS' } = req.query;

        const campaigns = await googleAdsService.getAggregatedCampaignData(
            customerId,
            date_range
        );

        res.json({
            success: true,
            customerId,
            campaigns
        });
    } catch (error) {
        console.error('Error getting campaigns:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sync Google Ads data with Google Sheets (using service account)
router.post('/sync', async (req, res) => {
    try {
        const {
            customerId,
            sheetUrls = [],
            date_range = 'LAST_30_DAYS'
        } = req.body;

        if (!customerId) {
            return res.status(400).json({
                error: 'Customer ID is required'
            });
        }

        if (!sheetUrls || sheetUrls.length === 0) {
            return res.status(400).json({
                error: 'At least one sheet URL is required'
            });
        }

        // Get campaign data from Google Ads
        const campaigns = await googleAdsService.getAggregatedCampaignData(
            customerId,
            date_range
        );

        const results = [];

        // Process each sheet URL
        for (const sheetUrl of sheetUrls) {
            try {
                // Get store data from Google Sheets
                await googleSheetsService.initAuth();
                const sheetData = await googleSheetsService.getDataFromSheet(sheetUrl);

                // Match campaigns with store data
                const matchedData = await googleAdsService.matchCampaignWithStoreData(
                    campaigns,
                    sheetData
                );

                // Update the sheet with Google Ads data
                if (matchedData.length > 0) {
                    await updateSheetWithAdsData(sheetUrl, matchedData, googleSheetsService);

                    results.push({
                        sheetUrl,
                        matchedRecords: matchedData.length,
                        totalCampaigns: campaigns.length,
                        success: true
                    });
                } else {
                    results.push({
                        sheetUrl,
                        matchedRecords: 0,
                        totalCampaigns: campaigns.length,
                        success: true,
                        message: 'No matching campaigns found'
                    });
                }
            } catch (sheetError) {
                console.error(`Error processing sheet ${sheetUrl}:`, sheetError);
                results.push({
                    sheetUrl,
                    success: false,
                    error: sheetError.message
                });
            }
        }

        res.json({
            success: true,
            customerId,
            totalCampaigns: campaigns.length,
            results
        });
    } catch (error) {
        console.error('Error syncing data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Configure Google Ads settings (using service account - no refresh token needed)
router.post('/configure', async (req, res) => {
    try {
        const {
            customerId,
            customerName,
            sheetUrls = [],
            syncInterval = 'daily'
        } = req.body;

        if (!customerId) {
            return res.status(400).json({
                error: 'Customer ID is required'
            });
        }

        // Load current config
        const config = await storageService.getConfig() || {};

        // Add Google Ads configuration
        if (!config.googleAds) {
            config.googleAds = {};
        }

        config.googleAds[customerId] = {
            customerId,
            customerName,
            sheetUrls,
            syncInterval,
            configuredAt: new Date().toISOString(),
            lastSync: null
        };

        config.lastUpdated = new Date().toISOString();

        // Save updated config
        await storageService.saveConfig(config);

        res.json({
            success: true,
            message: 'Google Ads configuration saved successfully',
            customerId
        });
    } catch (error) {
        console.error('Error configuring Google Ads:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get Google Ads configuration
router.get('/config', async (req, res) => {
    try {
        const config = await storageService.getConfig() || {};

        res.json({
            success: true,
            googleAdsConfig: config.googleAds || {}
        });
    } catch (error) {
        console.error('Error getting Google Ads config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sync all configured accounts
router.post('/sync-all', async (req, res) => {
    try {
        const config = await storageService.getConfig() || {};

        if (!config.googleAds || Object.keys(config.googleAds).length === 0) {
            return res.status(400).json({
                error: 'No Google Ads accounts configured'
            });
        }

        const results = [];

        for (const [customerId, adsConfig] of Object.entries(config.googleAds)) {
            try {
                // Sync this account
                const syncResult = await syncSingleAccount(adsConfig, googleAdsService, googleSheetsService);
                results.push({
                    customerId,
                    customerName: adsConfig.customerName,
                    ...syncResult
                });

                // Update last sync time
                config.googleAds[customerId].lastSync = new Date().toISOString();
            } catch (accountError) {
                console.error(`Error syncing account ${customerId}:`, accountError);
                results.push({
                    customerId,
                    customerName: adsConfig.customerName,
                    success: false,
                    error: accountError.message
                });
            }
        }

        // Save updated config with last sync times
        config.lastUpdated = new Date().toISOString();
        await storageService.saveConfig(config);

        res.json({
            success: true,
            results
        });
    } catch (error) {
        console.error('Error syncing all accounts:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sync a single configured account
router.post('/sync-single/:customerId', async (req, res) => {
    try {
        const { customerId } = req.params;
        const config = await storageService.getConfig() || {};

        if (!config.googleAds || !config.googleAds[customerId]) {
            return res.status(404).json({
                error: 'Account not found in configuration'
            });
        }

        const adsConfig = config.googleAds[customerId];
        const syncResult = await syncSingleAccount(adsConfig, googleAdsService, googleSheetsService);

        // Update last sync time
        config.googleAds[customerId].lastSync = new Date().toISOString();
        config.lastUpdated = new Date().toISOString();
        await storageService.saveConfig(config);

        res.json({
            success: true,
            customerId,
            customerName: adsConfig.customerName,
            ...syncResult
        });
    } catch (error) {
        console.error('Error syncing single account:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete a specific account configuration
router.delete('/config/:customerId', async (req, res) => {
    try {
        const { customerId } = req.params;
        let config = await storageService.getConfig() || {};

        if (!config.googleAds) {
            config.googleAds = {};
        }

        if (!config.googleAds[customerId]) {
            return res.status(404).json({
                success: false,
                error: 'Account configuration not found'
            });
        }

        // Remove the configuration
        delete config.googleAds[customerId];
        config.lastUpdated = new Date().toISOString();

        await storageService.saveConfig(config);

        res.json({
            success: true,
            message: `Configuration for account ${customerId} removed successfully`
        });
    } catch (error) {
        console.error('Error removing configuration:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
