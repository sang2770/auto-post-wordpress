const GoogleSheetsService = require('./googleSheetsService');
const EmailRegistrationService = require('./emailRegistrationService');
const StorageService = require('../services/storageService');
class AdsMappingService {
    defaultStoreNameColumn = 'D';
    defaultClicksColumn = 'P';
    defaultMoneyColumn = 'O';
    constructor() {
        this.googleSheetsService = new GoogleSheetsService();
        this.emailRegistrationService = new EmailRegistrationService();
        this.storageService = new StorageService();
    }

    /**
     * Read Google Ads report data from source sheet
     */
    async readAdsReportData(sourceSheetUrl, sourceRange = 'A:F') {
        try {
            console.log(`Reading ads report data from: ${sourceSheetUrl}`);

            const sheetId = this.googleSheetsService.extractSheetId(sourceSheetUrl);
            const gid = this.googleSheetsService.extractGid(sourceSheetUrl);
            if (!sheetId) {
                throw new Error('Invalid source sheet URL');
            }
            let rangeToRead = sourceRange;
            if (gid && gid !== "0") {
                // Get sheet info to find the sheet name by GID
                await this.googleSheetsService.initAuth();
                const spreadsheet = await this.googleSheetsService.sheets.spreadsheets.get({ spreadsheetId: sheetId });
                const sheetInfo = spreadsheet.data.sheets.find(s => s.properties.sheetId.toString() === gid);
                if (sheetInfo) {
                    rangeToRead = `${sheetInfo.properties.title}!${sourceRange}`;
                }
            }

            // Use GoogleSheetsService method instead of direct API call
            const rows = await this.googleSheetsService.readSheetValues(sheetId, rangeToRead);

            if (!rows || rows.length === 0) {
                throw new Error('No data found in source sheet');
            }
            console.log(`Total rows fetched: ${rows.length}`);

            const data = [];

            // Skip header row if exists
            const startIndex = 1;

            for (let i = startIndex; i < rows.length; i++) {
                const row = rows[i];

                if (row.length >= 5) {
                    const campaignId = row[1]?.toString().trim();
                    const storeName = row[2]?.toString().trim()
                        .replace(/\s*-\s*[\d.]+$/, '')  // Remove existing pattern like " - 12.8"
                        .replace(/\s+[\d.]+$/, '');     // Remove pattern like " 12.8"
                    const money = this.parseNumber(row[4].replace(/,/g, '.'));
                    const clicks = this.parseNumber(row[3]);
                    const unitMoney = row[5]?.toString().trim().toLowerCase();

                    if (storeName && (clicks > 0 || money > 0)) {
                        data.push({
                            campaignId,
                            storeName,
                            money,
                            clicks,
                            unitMoney,
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
    async mapDataToDestination(adsData, destinationSheetUrl, storeNameColumn = this.defaultStoreNameColumn, clicksColumn = this.defaultClicksColumn, moneyColumn = this.defaultMoneyColumn) {
        try {
            console.log(`Mapping data to destination: ${destinationSheetUrl}`);
            const config = await this.storageService.getConfig();
            const dollarPrice = config?.dollarPrice || 1;
            const sheetId = this.googleSheetsService.extractSheetId(destinationSheetUrl);
            const gid = this.googleSheetsService.extractGid(destinationSheetUrl);
            if (!sheetId) {
                throw new Error('Invalid destination sheet URL');
            }
            const sourceRange = `${storeNameColumn}:${moneyColumn}`;
            let rangeToRead = sourceRange;
            let destinationSheetName = '';
            if (gid && gid !== "0") {
                // Get sheet info to find the sheet name by GID
                await this.googleSheetsService.initAuth();
                const spreadsheet = await this.googleSheetsService.getInfoSheetsFromUrl(destinationSheetUrl);
                const sheetInfo = spreadsheet.sheets.find(s => s.properties.sheetId.toString() === gid);
                if (sheetInfo) {
                    destinationSheetName = sheetInfo.properties.title;
                    rangeToRead = `${destinationSheetName}!${sourceRange}`;
                }
            }

            await this.googleSheetsService.initAuth();

            // First, read the destination sheet to find matching stores using GoogleSheetsService method

            const destinationRows = await this.googleSheetsService.readSheetValues(sheetId, rangeToRead);

            if (!destinationRows || destinationRows.length === 0) {
                throw new Error('No data found in destination sheet');
            }
            const updates = [];
            const startIndex = 1;

            // Create a map of store names to ads data for quick lookup
            const adsDataMap = new Map();
            adsData.forEach(item => {
                const normalizedStoreName = this.normalizeStoreName(item.storeName);
                if (!adsDataMap.has(normalizedStoreName)) {
                    adsDataMap.set(normalizedStoreName, { clicks: 0, money: 0, unitMoney: item.unitMoney });
                }
                const existing = adsDataMap.get(normalizedStoreName);
                existing.clicks += item.clicks;
                existing.money += item.money;
                console.log(`Mapping store: ${normalizedStoreName}, clicks: ${existing.clicks}, money: ${existing.money}`);

            });

            // Find matching rows and prepare updates
            for (let i = startIndex; i < destinationRows.length; i++) {
                const row = destinationRows[i];
                if (!row.length) continue;
                const destinationStoreName = row[0]?.toString().trim();
                const normalizedDestName = this.normalizeStoreName(destinationStoreName);

                if (adsDataMap.has(normalizedDestName)) {
                    const adsInfo = adsDataMap.get(normalizedDestName);
                    const rowNumber = i + 1;
                    // Add update for clicks column
                    updates.push({
                        range: `${destinationSheetName}!${clicksColumn}${rowNumber}`,
                        values: [[adsInfo.clicks]]
                    });
                    let money = adsInfo.money;
                    if (adsInfo.unitMoney && adsInfo.unitMoney.toLowerCase() === 'usd') {
                        console.log(`Converting USD to local currency for store: ${normalizedDestName}, original money: ${money}, rate: ${dollarPrice}`);
                        money = adsInfo.money * dollarPrice;
                    }
                    updates.push({
                        range: `${destinationSheetName}!${moneyColumn}${rowNumber}`,
                        values: [[money]]
                    });
                    adsDataMap.set(normalizedDestName, { clicks: "", money: "" });
                }
            }

            if (updates.length === 0) {
                return {
                    success: true,
                    message: 'No matching stores found to update',
                    updatedRows: 0
                };
            }

            // Batch update the destination sheet using GoogleSheetsService method
            await this.googleSheetsService.batchUpdateSheetValues(sheetId, updates);

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
                    pair.destinationUrl
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
    async processGroupMappings(mappingGroups) {
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
                    // globalColumns.storeColumn,
                    // globalColumns.clicksColumn,
                    // globalColumns.moneyColumn
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
    async processGroupMappingsWithEmails(groups) {
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
                            group.destinationUrl
                        );

                        groupResult.sourceResults.push({
                            email: email,
                            sourceUrl: sourceUrl,
                            ...mappingResult
                        });

                        groupResult.totalMatched += mappingResult.matchedRows;
                        groupResult.totalUpdated += mappingResult.updatedCells;
                        groupResult.success = true;

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

        // Test destination sheet accessibility
        try {
            const sheetId = this.googleSheetsService.extractSheetId(group.destinationUrl);
            if (!sheetId) {
                throw new Error('Invalid destination sheet URL');
            }
            await this.googleSheetsService.readSheetValues(sheetId, 'A1:A1');
        } catch (error) {
            testResult.isValid = false;
            testResult.errors.push(`Destination: ${error.message}`);
        }

        return testResult;
    }
}

module.exports = AdsMappingService;
