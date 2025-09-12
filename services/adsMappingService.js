const GoogleSheetsService = require('./googleSheetsService');
const EmailRegistrationService = require('./emailRegistrationService');

class AdsMappingService {
    constructor() {
        this.googleSheetsService = new GoogleSheetsService();
        this.emailRegistrationService = new EmailRegistrationService();
    }

    /**
     * Read Google Ads report data from source sheet
     * Expected structure from Google Ads script:
     * Column A: campaign.id
     * Column B: campaign.name (store name)
     * Column C: metrics.impressions
     * Column D: metrics.clicks
     */
    async readAdsReportData(sourceSheetUrl, sourceRange = 'A:D') {
        try {
            console.log(`Reading ads report data from: ${sourceSheetUrl}`);

            const sheetId = this.googleSheetsService.extractSheetId(sourceSheetUrl);
            if (!sheetId) {
                throw new Error('Invalid source sheet URL');
            }

            await this.googleSheetsService.initAuth();

            const response = await this.googleSheetsService.sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: sourceRange,
            });

            if (!response.data.values || response.data.values.length === 0) {
                throw new Error('No data found in source sheet');
            }

            const rows = response.data.values;
            const data = [];

            // Skip header row if exists
            const startIndex = this.hasHeader(rows) ? 1 : 0;

            for (let i = startIndex; i < rows.length; i++) {
                const row = rows[i];
                if (row.length >= 4) {
                    const campaignId = row[0]?.toString().trim();
                    const storeName = row[1]?.toString().trim();
                    const impressions = this.parseNumber(row[2]);
                    const clicks = this.parseNumber(row[3]);

                    if (storeName && (clicks > 0 || impressions > 0)) {
                        data.push({
                            campaignId,
                            storeName,
                            impressions,
                            clicks,
                            rowIndex: i + 1
                        });
                    }
                }
            }

            console.log(`Found ${data.length} valid ads records`);
            return data;

        } catch (error) {
            console.error('Error reading ads report data:', error);
            throw new Error(`Failed to read ads report data: ${error.message}`);
        }
    }

    /**
     * Map ads data to destination sheet based on store name matching
     * Find rows in destination where store name matches and update clicks/money columns
     */
    async mapDataToDestination(adsData, destinationSheetUrl, storeNameColumn = 'A', clicksColumn = 'D', moneyColumn = 'E') {
        try {
            console.log(`Mapping data to destination: ${destinationSheetUrl}`);

            const sheetId = this.googleSheetsService.extractSheetId(destinationSheetUrl);
            if (!sheetId) {
                throw new Error('Invalid destination sheet URL');
            }

            await this.googleSheetsService.initAuth();

            // First, read the destination sheet to find matching stores
            const readResponse = await this.googleSheetsService.sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: `${storeNameColumn}:${moneyColumn}`,
            });

            if (!readResponse.data.values || readResponse.data.values.length === 0) {
                throw new Error('No data found in destination sheet');
            }

            const destinationRows = readResponse.data.values;
            const updates = [];
            const startIndex = this.hasHeader(destinationRows) ? 1 : 0;

            // Create a map of store names to ads data for quick lookup
            const adsDataMap = new Map();
            adsData.forEach(item => {
                const normalizedStoreName = this.normalizeStoreName(item.storeName);
                if (!adsDataMap.has(normalizedStoreName)) {
                    adsDataMap.set(normalizedStoreName, { clicks: 0, impressions: 0 });
                }
                const existing = adsDataMap.get(normalizedStoreName);
                existing.clicks += item.clicks;
                existing.impressions += item.impressions;
            });

            // Find matching rows and prepare updates
            for (let i = startIndex; i < destinationRows.length; i++) {
                const row = destinationRows[i];
                if (row.length > 0) {
                    const destinationStoreName = row[0]?.toString().trim();
                    const normalizedDestName = this.normalizeStoreName(destinationStoreName);

                    if (adsDataMap.has(normalizedDestName)) {
                        const adsInfo = adsDataMap.get(normalizedDestName);
                        const rowNumber = i + 1;

                        // Add update for clicks column
                        updates.push({
                            range: `${clicksColumn}${rowNumber}`,
                            values: [[adsInfo.clicks]]
                        });

                        // Calculate money (you can adjust this formula based on your business logic)
                        // For now, using clicks * 1000 as example (adjust as needed)
                        const money = adsInfo.clicks * 1000;
                        updates.push({
                            range: `${moneyColumn}${rowNumber}`,
                            values: [[money]]
                        });

                        console.log(`Mapped ${destinationStoreName}: ${adsInfo.clicks} clicks, ${money} money`);
                    }
                }
            }

            if (updates.length === 0) {
                return {
                    success: true,
                    message: 'No matching stores found to update',
                    updatedRows: 0
                };
            }

            // Batch update the destination sheet
            await this.googleSheetsService.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: sheetId,
                resource: {
                    valueInputOption: 'RAW',
                    data: updates
                }
            });

            return {
                success: true,
                message: `Successfully updated ${updates.length / 2} stores`,
                updatedRows: updates.length / 2,
                mappedStores: Array.from(adsDataMap.keys())
            };

        } catch (error) {
            console.error('Error mapping data to destination:', error);
            throw new Error(`Failed to map data to destination: ${error.message}`);
        }
    }

    /**
     * Process multiple URL pairs for ads data mapping
     */
    async processMappingPairs(mappingPairs) {
        const results = [];

        for (const pair of mappingPairs) {
            try {
                console.log(`Processing mapping pair: ${pair.name || 'Unnamed'}`);

                // Read ads data from source
                const adsData = await this.readAdsReportData(pair.sourceUrl);

                // Map to destination
                const mappingResult = await this.mapDataToDestination(
                    adsData,
                    pair.destinationUrl,
                    pair.storeNameColumn || 'A',
                    pair.clicksColumn || 'D',
                    pair.moneyColumn || 'E'
                );

                results.push({
                    ...pair,
                    success: true,
                    result: mappingResult,
                    processedAt: new Date().toISOString()
                });

            } catch (error) {
                console.error(`Error processing pair ${pair.name}:`, error);
                results.push({
                    ...pair,
                    success: false,
                    error: error.message,
                    processedAt: new Date().toISOString()
                });
            }
        }

        return results;
    }

    /**
     * Process multiple groups for ads data mapping  
     * Each group has one destination and multiple sources
     */
    async processGroupMappings(mappingGroups, globalColumns) {
        const results = [];

        for (const group of mappingGroups) {
            try {
                console.log(`Processing mapping group: ${group.name}`);

                // Read and combine ads data from all sources in this group
                let combinedAdsData = [];
                const sourceResults = [];

                for (const sourceInfo of group.sourceUrls) {
                    try {
                        const adsData = await this.readAdsReportData(sourceInfo.url);
                        combinedAdsData = combinedAdsData.concat(adsData);
                        sourceResults.push({
                            url: sourceInfo.url,
                            success: true,
                            recordCount: adsData.length
                        });
                    } catch (error) {
                        console.warn(`Failed to read from source ${sourceInfo.url}: ${error.message}`);
                        sourceResults.push({
                            url: sourceInfo.url,
                            success: false,
                            error: error.message
                        });
                    }
                }

                if (combinedAdsData.length === 0) {
                    results.push({
                        ...group,
                        success: false,
                        error: 'No data found in any source sheets',
                        sourceResults,
                        processedAt: new Date().toISOString()
                    });
                    continue;
                }

                // Map combined data to destination
                const mappingResult = await this.mapDataToDestination(
                    combinedAdsData,
                    group.destinationUrl,
                    globalColumns.storeColumn,
                    globalColumns.clicksColumn,
                    globalColumns.moneyColumn
                );

                results.push({
                    ...group,
                    success: true,
                    result: mappingResult,
                    sourceResults,
                    totalSourceRecords: combinedAdsData.length,
                    processedAt: new Date().toISOString()
                });

            } catch (error) {
                console.error(`Error processing group ${group.name}:`, error);
                results.push({
                    ...group,
                    success: false,
                    error: error.message,
                    processedAt: new Date().toISOString()
                });
            }
        }

        return results;
    }

    /**
     * Preview mapping without actually updating data
     */
    async previewMapping(sourceUrl, destinationUrl) {
        try {
            const adsData = await this.readAdsReportData(sourceUrl);

            // Read destination data for preview
            const destSheetId = this.googleSheetsService.extractSheetId(destinationUrl);
            await this.googleSheetsService.initAuth();

            const destResponse = await this.googleSheetsService.sheets.spreadsheets.values.get({
                spreadsheetId: destSheetId,
                range: 'A:E',
            });

            const destinationRows = destResponse.data.values || [];
            const startIndex = this.hasHeader(destinationRows) ? 1 : 0;

            const preview = [];
            const adsDataMap = new Map();

            // Create ads data map
            adsData.forEach(item => {
                const normalizedStoreName = this.normalizeStoreName(item.storeName);
                if (!adsDataMap.has(normalizedStoreName)) {
                    adsDataMap.set(normalizedStoreName, { clicks: 0, impressions: 0 });
                }
                const existing = adsDataMap.get(normalizedStoreName);
                existing.clicks += item.clicks;
                existing.impressions += item.impressions;
            });

            // Find matches for preview
            for (let i = startIndex; i < destinationRows.length; i++) {
                const row = destinationRows[i];
                if (row.length > 0) {
                    const destinationStoreName = row[0]?.toString().trim();
                    const normalizedDestName = this.normalizeStoreName(destinationStoreName);

                    if (adsDataMap.has(normalizedDestName)) {
                        const adsInfo = adsDataMap.get(normalizedDestName);
                        preview.push({
                            rowNumber: i + 1,
                            storeName: destinationStoreName,
                            currentClicks: row[3] || 0,
                            newClicks: adsInfo.clicks,
                            currentMoney: row[4] || 0,
                            newMoney: adsInfo.clicks * 1000
                        });
                    }
                }
            }

            return {
                sourceDataCount: adsData.length,
                matchingStores: preview.length,
                preview: preview.slice(0, 10), // Limit preview to 10 items
                totalPreview: preview.length
            };

        } catch (error) {
            console.error('Error creating preview:', error);
            throw new Error(`Failed to create preview: ${error.message}`);
        }
    }

    /**
     * Preview mapping with pre-loaded data (for group previews)
     */
    async previewMappingWithData(adsData, destinationUrl, storeNameColumn = 'A', clicksColumn = 'D', moneyColumn = 'E') {
        try {
            console.log(`Creating preview for destination: ${destinationUrl}`);

            const destSheetId = this.googleSheetsService.extractSheetId(destinationUrl);
            await this.googleSheetsService.initAuth();

            const destResponse = await this.googleSheetsService.sheets.spreadsheets.values.get({
                spreadsheetId: destSheetId,
                range: `${storeNameColumn}:${moneyColumn}`,
            });

            const destinationRows = destResponse.data.values || [];
            const startIndex = this.hasHeader(destinationRows) ? 1 : 0;

            const preview = [];
            const adsDataMap = new Map();

            // Create ads data map
            adsData.forEach(item => {
                const normalizedStoreName = this.normalizeStoreName(item.storeName);
                if (!adsDataMap.has(normalizedStoreName)) {
                    adsDataMap.set(normalizedStoreName, { clicks: 0, impressions: 0 });
                }
                const existing = adsDataMap.get(normalizedStoreName);
                existing.clicks += item.clicks;
                existing.impressions += item.impressions;
            });

            // Find matches for preview
            for (let i = startIndex; i < destinationRows.length; i++) {
                const row = destinationRows[i];
                if (row.length > 0) {
                    const destinationStoreName = row[0]?.toString().trim();
                    const normalizedDestName = this.normalizeStoreName(destinationStoreName);

                    if (adsDataMap.has(normalizedDestName)) {
                        const adsInfo = adsDataMap.get(normalizedDestName);
                        preview.push({
                            rowNumber: i + 1,
                            storeName: destinationStoreName,
                            currentClicks: this.getColumnValue(row, storeNameColumn, clicksColumn) || 0,
                            newClicks: adsInfo.clicks,
                            currentMoney: this.getColumnValue(row, storeNameColumn, moneyColumn) || 0,
                            newMoney: adsInfo.clicks * 1000
                        });
                    }
                }
            }

            return {
                sourceDataCount: adsData.length,
                matchingStores: preview.length,
                preview: preview.slice(0, 10), // Limit preview to 10 items
                totalPreview: preview.length
            };

        } catch (error) {
            console.error('Error creating preview with data:', error);
            throw new Error(`Failed to create preview: ${error.message}`);
        }
    }

    /**
     * Helper to get column value based on column letter
     */
    getColumnValue(row, baseColumn, targetColumn) {
        const baseIndex = this.columnLetterToIndex(baseColumn);
        const targetIndex = this.columnLetterToIndex(targetColumn);
        const offset = targetIndex - baseIndex;

        if (offset >= 0 && offset < row.length) {
            return row[offset];
        }
        return null;
    }

    /**
     * Convert column letter to index (A=0, B=1, etc.)
     */
    columnLetterToIndex(letter) {
        return letter.toUpperCase().charCodeAt(0) - 65;
    }

    /**
     * Helper method to detect if first row is header
     */
    hasHeader(rows) {
        if (!rows || rows.length === 0) return false;

        const firstRow = rows[0];
        // Check if first row contains typical header terms
        const headerTerms = ['campaign', 'name', 'impression', 'click', 'id'];
        const firstRowText = firstRow.join(' ').toLowerCase();

        return headerTerms.some(term => firstRowText.includes(term));
    }

    /**
     * Helper method to parse number values
     */
    parseNumber(value) {
        if (!value) return 0;
        const parsed = parseFloat(value.toString().replace(/[,\s]/g, ''));
        return isNaN(parsed) ? 0 : parsed;
    }

    /**
     * Normalize store name for matching (remove extra spaces, convert to lowercase)
     */
    normalizeStoreName(storeName) {
        if (!storeName) return '';
        return storeName.toString().toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /**
     * Process mapping groups using email-based configuration
     */
    async processGroupMappingsWithEmails(groups, globalConfig) {
        const results = [];

        for (const group of groups) {
            console.log(`Processing group: ${group.name}`);

            try {
                const groupResult = {
                    groupName: group.name,
                    destinationUrl: group.destinationUrl,
                    sourceResults: [],
                    totalMatched: 0,
                    totalUpdated: 0
                };

                // Get source URLs from emails
                const sourceUrls = await this.emailRegistrationService.getMultipleSourceUrls(group.sourceEmails);

                for (const email of group.sourceEmails) {
                    const sourceUrl = sourceUrls[email];
                    if (!sourceUrl) {
                        console.warn(`No source URL found for email: ${email}`);
                        groupResult.sourceResults.push({
                            email: email,
                            error: 'Không tìm thấy source URL cho email này'
                        });
                        continue;
                    }

                    try {
                        // Read source data
                        const sourceData = await this.readAdsReportData(sourceUrl);

                        // Map to destination
                        const mappingResult = await this.mapDataToDestination(
                            sourceData,
                            group.destinationUrl,
                            globalConfig
                        );

                        groupResult.sourceResults.push({
                            email: email,
                            sourceUrl: sourceUrl,
                            ...mappingResult
                        });

                        groupResult.totalMatched += mappingResult.matchedRows;
                        groupResult.totalUpdated += mappingResult.updatedCells;

                    } catch (sourceError) {
                        console.error(`Error processing source ${email}:`, sourceError);
                        groupResult.sourceResults.push({
                            email: email,
                            sourceUrl: sourceUrl,
                            error: sourceError.message
                        });
                    }
                }

                results.push(groupResult);

            } catch (groupError) {
                console.error(`Error processing group ${group.name}:`, groupError);
                results.push({
                    groupName: group.name,
                    error: groupError.message
                });
            }
        }

        return results;
    }

    /**
     * Preview mapping with email-based configuration
     */
    async previewMappingWithEmails(groups, globalConfig) {
        const preview = [];

        for (const group of groups) {
            const groupPreview = {
                groupName: group.name,
                destinationUrl: group.destinationUrl,
                sources: [],
                previewData: []
            };

            // Get source URLs from emails
            const sourceUrls = await this.emailRegistrationService.getMultipleSourceUrls(group.sourceEmails);

            for (const email of group.sourceEmails) {
                const sourceUrl = sourceUrls[email];
                if (!sourceUrl) {
                    groupPreview.sources.push({
                        email: email,
                        error: 'Không tìm thấy source URL cho email này'
                    });
                    continue;
                }

                try {
                    // Read first 5 rows for preview
                    const sourceData = await this.readAdsReportData(sourceUrl);
                    const previewRows = sourceData.slice(0, 6); // Header + 5 data rows

                    groupPreview.sources.push({
                        email: email,
                        sourceUrl: sourceUrl,
                        rowCount: sourceData.length - 1,
                        previewData: previewRows
                    });

                } catch (error) {
                    groupPreview.sources.push({
                        email: email,
                        sourceUrl: sourceUrl,
                        error: error.message
                    });
                }
            }

            preview.push(groupPreview);
        }

        return preview;
    }

    /**
     * Test group configuration with emails
     */
    async testGroupConfigurationWithEmails(group, globalConfig) {
        const testResult = {
            groupName: group.name,
            destinationUrl: group.destinationUrl,
            sourceTests: [],
            isValid: true,
            errors: []
        };

        // Get source URLs from emails
        const sourceUrls = await this.emailRegistrationService.getMultipleSourceUrls(group.sourceEmails);

        for (const email of group.sourceEmails) {
            const sourceUrl = sourceUrls[email];
            const sourceTest = {
                email: email,
                sourceUrl: sourceUrl,
                isValid: false,
                rowCount: 0,
                error: null
            };

            if (!sourceUrl) {
                sourceTest.error = 'Không tìm thấy source URL cho email này';
                testResult.isValid = false;
                testResult.errors.push(`Email ${email}: ${sourceTest.error}`);
            } else {
                try {
                    const sourceData = await this.readAdsReportData(sourceUrl);
                    sourceTest.isValid = true;
                    sourceTest.rowCount = sourceData.length - 1;
                } catch (error) {
                    sourceTest.error = error.message;
                    testResult.isValid = false;
                    testResult.errors.push(`Email ${email}: ${sourceTest.error}`);
                }
            }

            testResult.sourceTests.push(sourceTest);
        }

        // Test destination
        try {
            await this.googleSheetsService.getSheetData(group.destinationUrl);
        } catch (error) {
            testResult.isValid = false;
            testResult.errors.push(`Destination: ${error.message}`);
        }

        return testResult;
    }
}

module.exports = AdsMappingService;
