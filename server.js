const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');
const dotenv = require('dotenv');

const GoogleSheetsService = require('./services/googleSheetsService');
const WordPressService = require('./services/wordpressService');
const StorageService = require('./services/storageService');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Services
const googleSheetsService = new GoogleSheetsService();
const wordpressService = new WordPressService();
const storageService = new StorageService();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.post('/api/configure', async (req, res) => {
    try {
        const { storeSheetsUrl, storeDetailSheetsUrl } = req.body;

        if (!storeSheetsUrl || !storeDetailSheetsUrl) {
            return res.status(400).json({ error: 'Both Store and Store Detail Google Sheets URLs are required' });
        }

        // Validate URLs can extract sheet IDs
        const storeSheetId = googleSheetsService.extractSheetId(storeSheetsUrl);
        const storeDetailSheetId = googleSheetsService.extractSheetId(storeDetailSheetsUrl);

        if (!storeSheetId || !storeDetailSheetId) {
            return res.status(400).json({ error: 'Invalid Google Sheets URLs' });
        }

        // Save configuration with timestamp (store full URLs for direct use)
        const configData = {
            storeSheetsUrl,
            storeDetailSheetsUrl,
            storeSheetId,
            storeDetailSheetId,
            configuredAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
        await storageService.saveConfig(configData);

        // Initial data fetch from both sheets using full URLs
        const data = await googleSheetsService.fetchSheetDataFromSeparateUrls(storeSheetsUrl, storeDetailSheetsUrl);
        await storageService.saveLastData(data);

        // Log configuration save
        console.log(`Configuration saved to JSON file: ${JSON.stringify(configData, null, 2)}`);

        res.json({
            success: true,
            message: 'Configuration saved successfully to JSON file',
            storeSheetId,
            storeDetailSheetId,
            rowCount: data.totalRows,
            storeWithCouponsRows: data.storeListWithCoupons.length,
            storeInfoRows: data.storeInfo.length,
            configFile: 'data/config.json'
        });
    } catch (error) {
        console.error('Configuration error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/status', async (req, res) => {
    try {
        const config = await storageService.getConfig();
        const lastRun = await storageService.getLastRun();

        res.json({
            configured: !!(config?.storeSheetId && config?.storeDetailSheetId),
            storeSheetId: config?.storeSheetId,
            storeDetailSheetId: config?.storeDetailSheetId,
            lastRun: lastRun,
            pollingInterval: process.env.POLLING_INTERVAL || 5
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/test-connection', async (req, res) => {
    try {
        const config = await storageService.getConfig();
        if (!config?.storeSheetsUrl || !config?.storeDetailSheetsUrl) {
            return res.status(400).json({ error: 'No configuration found - both store and store detail sheet URLs required' });
        }

        const data = await googleSheetsService.fetchSheetDataFromSeparateUrls(config.storeSheetsUrl, config.storeDetailSheetsUrl);
        const processedStores = googleSheetsService.processSheetData(data);

        res.json({
            success: true,
            totalRows: data.totalRows,
            storeWithCouponsRows: data.storeListWithCoupons.length,
            storeInfoRows: data.storeInfo.length,
            processedStores: processedStores.length,
            totalCoupons: processedStores.reduce((sum, store) => sum + (store.coupons?.length || 0), 0),
            sampleData: processedStores.slice(0, 3) // Return first 3 processed stores as sample
        });
    } catch (error) {
        console.error('Test connection error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get current configuration
app.get('/api/config', async (req, res) => {
    try {
        const config = await storageService.getConfig();
        if (!config) {
            return res.status(404).json({ error: 'No configuration found' });
        }

        // Return full configuration for form population
        res.json({
            configured: true,
            storeSheetId: config.storeSheetId,
            storeDetailSheetId: config.storeDetailSheetId,
            configuredAt: config.configuredAt,
            lastUpdated: config.lastUpdated,
            storeSheetsUrl: config.storeSheetsUrl || 'Not set',
            storeDetailSheetsUrl: config.storeDetailSheetsUrl || 'Not set'
        });
    } catch (error) {
        console.error('Config retrieval error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export configuration as JSON
app.get('/api/config/export', async (req, res) => {
    try {
        const config = await storageService.getConfig();
        const lastRun = await storageService.getLastRun();
        const stats = await storageService.getStats();

        const exportData = {
            config: config,
            lastRun: lastRun,
            stats: stats,
            exportedAt: new Date().toISOString()
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=auto-store-config.json');
        res.json(exportData);

        console.log('Configuration exported to JSON');
    } catch (error) {
        console.error('Config export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Clear all configuration
app.delete('/api/config', async (req, res) => {
    try {
        await storageService.clearAllData();
        console.log('All configuration data cleared from JSON files');
        res.json({ success: true, message: 'Configuration cleared successfully' });
    } catch (error) {
        console.error('Config clear error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get existing stores from WordPress
app.get('/api/stores', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const { data: stores, totalCount } = await wordpressService.getStores(limit);
        res.json({
            success: true,
            count: stores.length,
            totalCount: totalCount,
            stores: stores.map(store => ({
                id: store.id,
                title: store.title?.rendered || store.title,
                status: store.status,
                date: store.date,
                link: store.link
            }))
        });
    } catch (error) {
        console.error('Error fetching stores:', error);
        res.status(500).json({ error: error.message });
    }
});

// Trigger store creation manually
app.post('/api/create-stores-now', async (req, res) => {
    try {
        console.log('Manual store creation triggered...');

        const config = await storageService.getConfig();
        if (!config?.storeSheetsUrl || !config?.storeDetailSheetsUrl) {
            return res.status(400).json({ error: 'No configuration found. Please configure both Store and Store Detail Google Sheets URLs first.' });
        }

        // Fetch current sheet data from separate URLs
        const currentData = await googleSheetsService.fetchSheetDataFromSeparateUrls(config.storeSheetsUrl, config.storeDetailSheetsUrl);

        // Process stores using shared function
        const results = await processStores(currentData, { isManualTrigger: true });

        res.json({
            success: true,
            message: `Process completed successfully!`,
            results: results
        });
    } catch (error) {
        console.error('Error in manual store creation:', error);
        res.status(500).json({ error: error.message });
    }
});

// Shared function to process stores with duplicate checking
async function processStores(currentData, options = {}) {
    const { isManualTrigger = false } = options;

    // Fetch existing stores from WordPress to check for duplicates
    console.log('Fetching existing stores from WordPress...');
    let existingStores = [];
    try {
        existingStores = await wordpressService.getAllStores();
    } catch (error) {
        console.error('Failed to fetch existing stores:', error.message);
        console.log('Continuing without duplicate checking...');
    }

    const newStores = googleSheetsService.processSheetData(currentData);
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errors = [];
    let totalCouponsCreated = 0;
    let imagesProcessed = 0;
    let imagesSkipped = 0;

    for (const store of newStores) {
        try {
            // Check for duplicates
            const duplicateCheck = wordpressService.checkDuplicate(store, existingStores);

            if (duplicateCheck.isDuplicate) {
                console.log(`Found existing store: ${store.name}, updating...`);

                // Update existing store and its coupons
                const result = await wordpressService.updateStoreWithCoupons(store, duplicateCheck.existingStore.id);
                updatedCount++;
                totalCouponsCreated += result.successfulCoupons;

                // Track image processing
                if (result.featuredImageId) {
                    imagesProcessed++;
                } else if (store.image) {
                    imagesSkipped++;
                }

                console.log(`Updated store: ${store.name} with ${result.successfulCoupons}/${result.totalCoupons} coupons`);

                // Log any coupon processing failures
                const failedCoupons = result.coupons.filter(c => !c.success);
                if (failedCoupons.length > 0) {
                    failedCoupons.forEach(coupon => {
                        errors.push({
                            storeName: store.name,
                            couponName: coupon.name,
                            error: coupon.error,
                            type: 'coupon'
                        });
                    });
                }
                continue;
            } else {
                // Create new store with coupons if any coupons exist
                if (store.coupons && store.coupons.length > 0) {
                    const result = await wordpressService.createStoreWithCoupons(store);
                    createdCount++;
                    totalCouponsCreated += result.successfulCoupons;

                    // Track image processing
                    if (result.featuredImageId) {
                        imagesProcessed++;
                    } else if (store.image) {
                        imagesSkipped++;
                    }

                    console.log(`Created store: ${store.name} with ${result.successfulCoupons}/${result.totalCoupons} coupons`);

                    // Log any coupon creation failures
                    const failedCoupons = result.coupons.filter(c => !c.success);
                    if (failedCoupons.length > 0) {
                        failedCoupons.forEach(coupon => {
                            errors.push({
                                storeName: store.name,
                                couponName: coupon.name,
                                error: coupon.error,
                                type: 'coupon'
                            });
                        });
                    }
                } else {
                    // Create store without coupons
                    const result = await wordpressService.createStore(store);
                    createdCount++;

                    // Track image processing
                    if (result.featuredImageId) {
                        imagesProcessed++;
                    } else if (store.image) {
                        imagesSkipped++;
                    }

                    console.log(`Created store: ${store.name} (no coupons)`);
                }
            }


        } catch (error) {
            console.error(`Failed to create store ${store.name}:`, error.message);
            errors.push({ storeName: store.name, error: error.message, type: 'store' });
        }
    }

    // Cleanup image resources
    wordpressService.cleanupImageResources();

    // Save the data as processed
    await storageService.saveLastData(currentData);

    // Save detailed run information
    const runInfo = {
        timestamp: new Date().toISOString(),
        storesCreated: createdCount,
        storesUpdated: updatedCount,
        storesSkipped: skippedCount,
        totalRows: currentData.totalRows || 0,
        storeWithCouponsRows: currentData.storeListWithCoupons?.length || 0,
        storeInfoRows: currentData.storeInfo?.length || 0,
        totalStores: newStores.length,
        existingStoresCount: existingStores.length,
        totalCouponsCreated: totalCouponsCreated,
        imagesProcessed: imagesProcessed,
        imagesSkipped: imagesSkipped,
        errors: errors,
        hasChanges: true,
        ...(isManualTrigger && { manualTrigger: true })
    };
    await storageService.saveLastRun(runInfo);

    const logMessage = isManualTrigger ? 'Manual creation' : 'Processing';
    console.log(`${logMessage} complete. Created ${createdCount} stores, updated ${updatedCount} stores, with ${totalCouponsCreated} coupons processed, ${imagesProcessed} images processed, skipped ${skippedCount} duplicates.`);

    return {
        storesCreated: createdCount,
        storesUpdated: updatedCount,
        storesSkipped: skippedCount,
        totalFromSheet: newStores.length,
        existingInWordPress: existingStores.length,
        couponsCreated: totalCouponsCreated,
        imagesProcessed: imagesProcessed,
        imagesSkipped: imagesSkipped,
        errors: errors,
        totalRows: currentData.totalRows || 0,
        storeWithCouponsRows: currentData.storeListWithCoupons?.length || 0,
        storeInfoRows: currentData.storeInfo?.length || 0
    };
}

// Background job to check for changes
async function checkForChanges() {
    try {
        console.log('Checking for changes...');

        const config = await storageService.getConfig();
        if (!config?.storeSheetsUrl || !config?.storeDetailSheetsUrl) {
            console.log('No configuration found, skipping check');
            return;
        }

        const currentData = await googleSheetsService.fetchSheetDataFromSeparateUrls(config.storeSheetsUrl, config.storeDetailSheetsUrl);
        const lastData = await storageService.getLastData();

        // Compare data
        const hasChanges = !lastData || JSON.stringify(currentData) !== JSON.stringify(lastData);

        if (hasChanges) {
            console.log('Changes detected, processing new stores...');
            await processStores(currentData, { isManualTrigger: false });
        } else {
            console.log('No changes detected');

            // Save run info even when no changes
            const runInfo = {
                timestamp: new Date().toISOString(),
                storesCreated: 0,
                storesUpdated: 0,
                totalRows: currentData.totalRows || 0,
                storeWithCouponsRows: currentData.storeListWithCoupons?.length || 0,
                storeInfoRows: currentData.storeInfo?.length || 0,
                hasChanges: false
            };
            await storageService.saveLastRun(runInfo);
        }
    } catch (error) {
        console.error('Error checking for changes:', error);
    }
}

// Schedule the job to run every 5 minutes
const pollingInterval = process.env.POLLING_INTERVAL || 5;
cron.schedule(`*/${pollingInterval} * * * *`, checkForChanges);

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Polling interval: ${pollingInterval} minutes`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    process.exit(0);
});
