const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');
const dotenv = require('dotenv');

const GoogleSheetsService = require('./services/googleSheetsService');
const WordPressService = require('./services/wordpressService');
const StorageService = require('./services/storageService');

// Import routers
const reportsRouter = require('./routes/reports');
const {adsMappingRouter, handleExecute} = require('./routes/adsMapping');
const emailRegistrationRouter = require('./routes/emailRegistration');

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

app.get('/reports.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

app.get('/ads-mapping.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ads-mapping.html'));
});

// Use routers
app.use('/api/reports', reportsRouter);
app.use('/api/ads-mapping', adsMappingRouter);
app.use('/api/email-registration', emailRegistrationRouter);

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

// Export stores and coupons to Excel
app.get('/api/export-excel', async (req, res) => {
    try {
        console.log('Starting Excel export...');

        // Fetch all stores from WordPress
        const stores = await wordpressService.getAllStores();
        console.log(`Fetched ${stores.length} stores for export`);

        // Fetch coupons for each store
        const storesWithCoupons = [];
        for (const store of stores) {
            try {
                const coupons = await wordpressService.getCouponsForStore(store.id);
                storesWithCoupons.push({
                    ...store,
                    coupons: coupons || []
                });
            } catch (error) {
                console.error(`Failed to fetch coupons for store ${store.title?.rendered}:`, error.message);
                storesWithCoupons.push({
                    ...store,
                    coupons: []
                });
            }
        }

        // Generate Excel file
        const excelBuffer = await generateExcelFile(storesWithCoupons);

        // Set headers for file download
        const filename = `stores_export_${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        res.send(excelBuffer);
        console.log(`Excel export completed: ${filename}`);

    } catch (error) {
        console.error('Excel export error:', error);
        res.status(500).json({
            error: 'Failed to export Excel file',
            details: error.message
        });
    }
});

// Helper function to generate Excel file
async function generateExcelFile(storesWithCoupons) {
    const ExcelJS = require('exceljs');

    const workbook = new ExcelJS.Workbook();

    // Create Stores sheet
    const storesSheet = workbook.addWorksheet('Stores');

    // Define stores columns
    storesSheet.columns = [
        { header: 'Store Name', key: 'name', width: 25 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Link', key: 'link', width: 50 },
        { header: 'Guide', key: 'guide', width: 30 },
        { header: 'About', key: 'about', width: 30 },
        { header: 'Q&A', key: 'qa', width: 30 },
        { header: 'Featured Image', key: 'featured_image', width: 50 },
        { header: 'Total Coupons', key: 'coupon_count', width: 15 },
        { header: 'Created Date', key: 'created_date', width: 20 }
    ];

    // Add stores data
    storesWithCoupons.forEach(store => {
        storesSheet.addRow({
            name: store.title?.rendered || '',
            description: store.acf?.name || '',
            link: store.link || '',
            guide: store.acf?.guilde || '',
            about: store.acf?.about || '',
            qa: store.acf?.q_and_a || '',
            featured_image: store.featured_media_url || '',
            coupon_count: store.coupons.length,
            created_date: store.date ? new Date(store.date).toLocaleDateString() : ''
        });
    });

    // Style the stores header
    storesSheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE6F3FF' }
        };
    });

    // Create Coupons sheet
    const couponsSheet = workbook.addWorksheet('Coupons');

    // Define coupons columns
    couponsSheet.columns = [
        { header: 'Store Name', key: 'store_name', width: 25 },
        { header: 'Coupon Name', key: 'coupon_name', width: 30 },
        { header: 'Coupon Code', key: 'coupon_code', width: 20 },
        { header: 'Discount Value', key: 'discount_value', width: 15 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Is Deal', key: 'is_deal', width: 10 },
        { header: 'Is Verified', key: 'is_verified', width: 12 },
        { header: 'Store Link', key: 'store_link', width: 50 },
        { header: 'Coupon Link', key: 'coupon_link', width: 50 },
        { header: 'Created Date', key: 'created_date', width: 20 }
    ];

    // Add coupons data
    storesWithCoupons.forEach(store => {
        const storeName = store.title?.rendered || '';
        store.coupons.forEach(coupon => {
            couponsSheet.addRow({
                store_name: storeName,
                coupon_name: coupon.title?.rendered || '',
                coupon_code: coupon.acf?.coupon_code || '',
                discount_value: coupon.acf?.discount_value || '',
                description: coupon.content?.rendered ? coupon.content.rendered.replace(/<[^>]*>/g, '') : '',
                is_deal: coupon.acf?.is_deal ? 'Yes' : 'No',
                is_verified: coupon.acf?.is_verified ? 'Yes' : 'No',
                store_link: store.link || '',
                coupon_link: coupon.link || '',
                created_date: coupon.date ? new Date(coupon.date).toLocaleDateString() : ''
            });
        });
    });

    // Style the coupons header
    couponsSheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF0FFF0' }
        };
    });

    // Create Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');

    summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 25 },
        { header: 'Value', key: 'value', width: 15 }
    ];

    const totalStores = storesWithCoupons.length;
    const totalCoupons = storesWithCoupons.reduce((sum, store) => sum + store.coupons.length, 0);
    const totalDeals = storesWithCoupons.reduce((sum, store) =>
        sum + store.coupons.filter(c => c.acf?.is_deal).length, 0);
    const totalCodes = totalCoupons - totalDeals;

    summarySheet.addRows([
        { metric: 'Total Stores', value: totalStores },
        { metric: 'Total Coupons', value: totalCoupons },
        { metric: 'Total Coupon Codes', value: totalCodes },
        { metric: 'Total Deals (No Code)', value: totalDeals },
        { metric: 'Export Date', value: new Date().toLocaleDateString() },
        { metric: 'Export Time', value: new Date().toLocaleTimeString() }
    ]);

    // Style the summary sheet
    summarySheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFF00' }
        };
    });

    summarySheet.getColumn('A').eachCell((cell, rowNumber) => {
        if (rowNumber > 1) {
            cell.font = { bold: true };
        }
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

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

// Helper function to compare store data for changes
function hasStoreChanged(currentStore, previousStore) {
    if (!previousStore) return true;

    // Compare basic store properties
    const storeProps = ['name', 'description', 'about', 'guide', 'qa', 'image'];
    for (const prop of storeProps) {
        if (currentStore[prop] !== previousStore[prop]) {
            return true;
        }
    }

    // Compare coupons
    const currentCoupons = currentStore.coupons || [];
    const previousCoupons = previousStore.coupons || [];

    if (currentCoupons.length !== previousCoupons.length) {
        return true;
    }

    // Sort coupons by name for consistent comparison
    const sortedCurrent = [...currentCoupons].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const sortedPrevious = [...previousCoupons].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    for (let i = 0; i < sortedCurrent.length; i++) {
        const currentCoupon = sortedCurrent[i];
        const previousCoupon = sortedPrevious[i];

        const couponProps = ['name', 'code', 'discountValue', 'description', 'isDeal', 'isVerified'];
        for (const prop of couponProps) {
            if (currentCoupon[prop] !== previousCoupon[prop]) {
                return true;
            }
        }
    }

    return false;
}

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

    // Get previous data for comparison
    console.log('Fetching previous data for change comparison...');
    const lastData = await storageService.getLastData();
    let previousStores = [];
    if (lastData) {
        try {
            previousStores = googleSheetsService.processSheetData(lastData);
        } catch (error) {
            console.error('Failed to process previous data:', error.message);
            console.log('Continuing without change comparison...');
        }
    }

    // Create a map of previous stores for quick lookup
    const previousStoresMap = new Map();
    previousStores.forEach(store => {
        previousStoresMap.set(store.name.toLowerCase(), store);
    });

    const newStores = googleSheetsService.processSheetData(currentData);
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let unchangedCount = 0;
    let errors = [];
    let totalCouponsCreated = 0;
    let imagesProcessed = 0;
    let imagesSkipped = 0;

    for (const store of newStores) {
        try {
            // Check for duplicates
            const duplicateCheck = wordpressService.checkDuplicate(store, existingStores);
            if (duplicateCheck.isDuplicate) {
                // Check if store data has actually changed
                const previousStore = previousStoresMap.get(store.name.toLowerCase());
                const hasChanged = hasStoreChanged(store, previousStore);

                if (!hasChanged) {
                    console.log(`No changes detected for store: ${store.name}, skipping update`);
                    unchangedCount++;
                    continue;
                }

                console.log(`Found existing store: ${store.name}, ${hasChanged ? 'changes detected, updating' : 'forcing update (manual trigger)'}...`);

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
        storesUnchanged: unchangedCount,
        totalRows: currentData.totalRows || 0,
        storeWithCouponsRows: currentData.storeListWithCoupons?.length || 0,
        storeInfoRows: currentData.storeInfo?.length || 0,
        totalStores: newStores.length,
        existingStoresCount: existingStores.length,
        totalCouponsCreated: totalCouponsCreated,
        imagesProcessed: imagesProcessed,
        imagesSkipped: imagesSkipped,
        errors: errors,
        hasChanges: createdCount > 0 || updatedCount > 0,
        ...(isManualTrigger && { manualTrigger: true })
    };
    await storageService.saveLastRun(runInfo);

    const logMessage = isManualTrigger ? 'Manual creation' : 'Processing';
    console.log(`${logMessage} complete. Created ${createdCount} stores, updated ${updatedCount} stores, unchanged ${unchangedCount} stores, with ${totalCouponsCreated} coupons processed, ${imagesProcessed} images processed, skipped ${skippedCount} duplicates.`);

    return {
        storesCreated: createdCount,
        storesUpdated: updatedCount,
        storesSkipped: skippedCount,
        storesUnchanged: unchangedCount,
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

        const isAvailable = await googleSheetsService.checkAvailability(config.storeSheetsUrl);
        if (!isAvailable?.accessible) {
            console.log('Store Sheets URL is not accessible, skipping check');
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

// Background job to generate daily reports
async function generateDailyReport() {
    try {
        console.log('Generating daily report...');

        const config = await storageService.getConfig();

        // Check if report configuration exists
        if (!config?.dataUrl || !config?.reportUrl) {
            console.log('No report configuration found, skipping daily report generation');
            return;
        }

        // Get current date in UTC+7 timezone
        const utcNow = new Date();
        const utcPlus7Time = new Date(utcNow.getTime() + (7 * 60 * 60 * 1000));
        const targetDate = utcPlus7Time.toISOString().split('T')[0]; // YYYY-MM-DD format

        console.log(`Generating daily report for date: ${targetDate} (UTC+7)`);

        // Fetch data from the data sheet
        const rawData = await googleSheetsService.fetchReportData(config.dataUrl);

        // Import the functions from reports route
        const { processDataByStore, writeReportToSheet } = require('./routes/reports');

        // Process data by store
        const reportData = processDataByStore(rawData);

        // Write report to the report sheet
        await writeReportToSheet(config.reportUrl, reportData, targetDate);

        console.log(`Daily report generated successfully for ${targetDate}`);
        console.log(`Stores processed: ${Object.keys(reportData).length}`);
        console.log(`Total records processed from sheet: ${rawData.length}`);

    } catch (error) {
        console.error('Error generating daily report:', error);
    }
}

// Schedule the job to run every 5 minutes
const pollingInterval = process.env.POLLING_INTERVAL || 5;
cron.schedule(`*/${pollingInterval} * * * *`, checkForChanges);

// Schedule daily report generation at 2:00 AM UTC+7
cron.schedule('0 2 * * *', generateDailyReport, {
    timezone: 'Asia/Bangkok' // UTC+7
});

// Schedule ads mapping refresh at 1:00 AM UTC+7
cron.schedule('0 1 * * *', async () => {
    try {
        await handleExecute();
    } catch (error) {
        console.error('Error refreshing ads mapping data:', error);
    }
}, {
    timezone: 'Asia/Bangkok' // UTC+7
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Polling interval: ${pollingInterval} minutes`);
    console.log('Daily report scheduled for 11:59 PM UTC+7 (end of day)');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    process.exit(0);
});
