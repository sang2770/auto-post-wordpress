const express = require('express');
const router = express.Router();
const AdsMappingService = require('../services/adsMappingService');
const StorageService = require('../services/storageService');

const adsMappingService = new AdsMappingService();
const storageService = new StorageService();

// Get current ads mapping configuration
router.get('/config', async (req, res) => {
    try {
        const config = await storageService.getConfig();

        res.json({
            success: true,
            mappingGroups: config?.adsMappingGroups || [],
            globalColumns: config?.adsGlobalColumns || {
                storeColumn: 'A',
                clicksColumn: 'D',
                moneyColumn: 'E'
            },
            dollarPrice: config?.dollarPrice || 23000,
            configured: !!(config?.adsMappingGroups && config?.adsMappingGroups.length > 0)
        });
    } catch (error) {
        console.error('Error getting ads mapping config:', error);
        res.status(500).json({ error: error.message });
    }
});

// Configure ads mapping groups
router.post('/config', async (req, res) => {
    try {
        const { mappingGroups, globalColumns, dollarPrice } = req.body;

        if (!mappingGroups || !Array.isArray(mappingGroups) || mappingGroups.length === 0) {
            return res.status(400).json({
                error: 'At least one mapping group is required'
            });
        }

        // Validate all mapping groups
        const validatedGroups = [];
        for (let i = 0; i < mappingGroups.length; i++) {
            const group = mappingGroups[i];
            const { name, destinationUrl, sourceUrls, sourceEmails } = group;

            // Support both legacy sourceUrls and new sourceEmails
            const hasSourceUrls = sourceUrls && Array.isArray(sourceUrls) && sourceUrls.length > 0;
            const hasSourceEmails = sourceEmails && Array.isArray(sourceEmails) && sourceEmails.length > 0;

            if (!name || !destinationUrl || (!hasSourceUrls && !hasSourceEmails)) {
                return res.status(400).json({
                    error: `Name, destination URL and at least one source (URL or email) are required for group ${i + 1}`
                });
            }

            // Validate destination URL
            const destSheetId = adsMappingService.googleSheetsService.extractSheetId(destinationUrl);
            if (!destSheetId) {
                return res.status(400).json({
                    error: `Invalid destination URL for group ${i + 1}`
                });
            }

            const groupConfig = {
                name: name.trim(),
                destinationUrl,
                destSheetId
            };

            // Handle source URLs or emails
            if (hasSourceUrls) {
                // Legacy format - validate source URLs
                const validatedSourceUrls = [];
                for (let j = 0; j < sourceUrls.length; j++) {
                    const sourceUrl = sourceUrls[j];
                    const sourceSheetId = adsMappingService.googleSheetsService.extractSheetId(sourceUrl);
                    if (!sourceSheetId) {
                        return res.status(400).json({
                            error: `Invalid source URL ${j + 1} for group ${i + 1}`
                        });
                    }
                    validatedSourceUrls.push({
                        url: sourceUrl,
                        sheetId: sourceSheetId
                    });
                }
                groupConfig.sourceUrls = validatedSourceUrls;
            }

            if (hasSourceEmails) {
                // New format - store emails directly (URLs will be resolved at runtime)
                groupConfig.sourceEmails = sourceEmails.filter(email => email && email.trim());
            }

            validatedGroups.push(groupConfig);
        }

        // Validate global columns
        const validatedColumns = {
            storeColumn: globalColumns?.storeColumn || 'D',
            clicksColumn: globalColumns?.clicksColumn || 'P',
            moneyColumn: globalColumns?.moneyColumn || 'O'
        };

        // Save configuration
        const config = await storageService.getConfig();
        console.log('Saving ads mapping configuration:', config);

        config.adsMappingGroups = validatedGroups;
        config.adsGlobalColumns = validatedColumns;
        config.adsMappingConfiguredAt = new Date().toISOString();
        config.dollarPrice = dollarPrice;
        await storageService.saveConfig(config);

        res.json({
            success: true,
            message: `Successfully configured ${validatedGroups.length} ads mapping groups`,
            mappingGroups: validatedGroups,
            globalColumns: validatedColumns
        });

    } catch (error) {
        console.error('Error configuring ads mapping:', error);
        res.status(500).json({ error: error.message });
    }
});// Preview mapping for a group (multiple sources to one destination)


// Test connection to group sheets (multiple sources + one destination)
router.post('/test-group-connection', async (req, res) => {
    try {
        const { sourceUrls, destinationUrl } = req.body;

        if (!sourceUrls || !Array.isArray(sourceUrls) || sourceUrls.length === 0 || !destinationUrl) {
            return res.status(400).json({
                error: 'Source URLs array and destination URL are required'
            });
        }

        const results = {
            destination: { accessible: false, error: null },
            sources: []
        };

        // Test destination sheet
        try {
            const destSheetId = adsMappingService.googleSheetsService.extractSheetId(destinationUrl);
            if (!destSheetId) {
                throw new Error('Invalid destination URL');
            }

            await adsMappingService.googleSheetsService.initAuth();
            await adsMappingService.googleSheetsService.sheets.spreadsheets.get({
                spreadsheetId: destSheetId
            });

            results.destination.accessible = true;
        } catch (error) {
            results.destination.error = error.message;
        }

        // Test all source sheets
        for (const sourceUrl of sourceUrls) {
            const sourceResult = { accessible: false, error: null, url: sourceUrl };

            try {
                const sourceSheetId = adsMappingService.googleSheetsService.extractSheetId(sourceUrl);
                if (!sourceSheetId) {
                    throw new Error('Invalid source URL');
                }

                await adsMappingService.googleSheetsService.sheets.spreadsheets.get({
                    spreadsheetId: sourceSheetId
                });

                sourceResult.accessible = true;
            } catch (error) {
                sourceResult.error = error.message;
            }

            results.sources.push(sourceResult);
        }

        res.json({
            success: true,
            connectionTest: results
        });

    } catch (error) {
        console.error('Error testing group connection:', error);
        res.status(500).json({ error: error.message });
    }
});

// Execute mapping for all configured groups
router.post('/execute', async (req, res) => {
    try {
        const config = await storageService.getConfig();
        const mappingGroups = config?.adsMappingGroups;

        if (!mappingGroups || mappingGroups.length === 0) {
            return res.status(400).json({
                error: 'No mapping groups configured. Please configure mapping groups first.'
            });
        }

        console.log(`Starting ads mapping execution for ${mappingGroups.length} groups`);

        // Check if groups have sourceEmails (new format) or sourceUrls (legacy format)
        const hasEmailBasedGroups = mappingGroups.some(group => group.sourceEmails && group.sourceEmails.length > 0);

        let results;
        if (hasEmailBasedGroups) {
            results = await adsMappingService.processGroupMappingsWithEmails(mappingGroups);
        } else {
            results = await adsMappingService.processGroupMappings(mappingGroups);
        }

        // Update last execution time
        config.lastAdsMappingExecution = new Date().toISOString();
        await storageService.saveConfig(config);

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;

        res.json({
            success: true,
            message: `Mapping execution completed. ${successCount} successful, ${failureCount} failed.`,
            results,
            summary: {
                total: results.length,
                successful: successCount,
                failed: failureCount,
                executedAt: config.lastAdsMappingExecution
            }
        });

    } catch (error) {
        console.error('Error executing ads mapping:', error);
        res.status(500).json({ error: error.message });
    }
});// Execute mapping for a specific pair
router.post('/execute-single', async (req, res) => {
    try {
        const { sourceUrl, destinationUrl, storeNameColumn, clicksColumn, moneyColumn } = req.body;

        if (!sourceUrl || !destinationUrl) {
            return res.status(400).json({
                error: 'Both source URL and destination URL are required'
            });
        }

        const pair = {
            name: 'Single Execution',
            sourceUrl,
            destinationUrl,
            storeNameColumn: storeNameColumn || 'A',
            clicksColumn: clicksColumn || 'D',
            moneyColumn: moneyColumn || 'E'
        };

        const results = await adsMappingService.processMappingPairs([pair]);

        res.json({
            success: true,
            message: 'Single mapping execution completed',
            result: results[0]
        });

    } catch (error) {
        console.error('Error executing single ads mapping:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get mapping execution history
router.get('/history', async (req, res) => {
    try {
        const config = await storageService.getConfig();

        res.json({
            success: true,
            history: {
                lastExecution: config?.lastAdsMappingExecution || null,
                configuredAt: config?.adsMappingConfiguredAt || null,
                groupsCount: config?.adsMappingGroups?.length || 0
            }
        });

    } catch (error) {
        console.error('Error getting ads mapping history:', error);
        res.status(500).json({ error: error.message });
    }
});// Test connection to source/destination sheets
router.post('/test-connection', async (req, res) => {
    try {
        const { sourceUrl, destinationUrl } = req.body;

        if (!sourceUrl || !destinationUrl) {
            return res.status(400).json({
                error: 'Both source URL and destination URL are required'
            });
        }

        const results = {
            source: { accessible: false, error: null },
            destination: { accessible: false, error: null }
        };

        // Test source sheet
        try {
            const sourceSheetId = adsMappingService.googleSheetsService.extractSheetId(sourceUrl);
            if (!sourceSheetId) {
                throw new Error('Invalid source URL');
            }

            await adsMappingService.googleSheetsService.initAuth();
            await adsMappingService.googleSheetsService.sheets.spreadsheets.get({
                spreadsheetId: sourceSheetId
            });

            results.source.accessible = true;
        } catch (error) {
            results.source.error = error.message;
        }

        // Test destination sheet
        try {
            const destSheetId = adsMappingService.googleSheetsService.extractSheetId(destinationUrl);
            if (!destSheetId) {
                throw new Error('Invalid destination URL');
            }

            await adsMappingService.googleSheetsService.sheets.spreadsheets.get({
                spreadsheetId: destSheetId
            });

            results.destination.accessible = true;
        } catch (error) {
            results.destination.error = error.message;
        }

        res.json({
            success: true,
            connectionTest: results
        });

    } catch (error) {
        console.error('Error testing connection:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
