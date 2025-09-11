// Helper functions for Google Ads integration

// Helper function to update sheet with ads data
async function updateSheetWithAdsData(sheetUrl, matchedData, googleSheetsService) {
    const spreadsheetInfo = googleSheetsService.getInfoSheetsFromUrl(sheetUrl);
    const spreadsheetId = spreadsheetInfo.spreadsheetId;
    const sheetName = spreadsheetInfo.sheetName;

    // Get current sheet data to find the right columns
    const currentData = await googleSheetsService.getDataFromSheet(sheetUrl);

    if (currentData.length === 0) {
        throw new Error('No data found in sheet');
    }

    // Find column indices for ads data
    const headers = Object.keys(currentData[0]);
    const clicksColumnIndex = findColumnIndex(headers, ['clicks', 'click', 'lượt click', 'số click']);
    const costColumnIndex = findColumnIndex(headers, ['cost', 'chi phí', 'tiền', 'money', 'spend']);
    const impressionsColumnIndex = findColumnIndex(headers, ['impressions', 'hiển thị', 'lượt hiển thị']);

    // Find the row for each matched store based on store name
    const updateRequests = [];

    matchedData.forEach((data) => {
        // Find the row index for this store in the sheet
        const storeRowIndex = findStoreRowIndex(currentData, data);

        if (storeRowIndex === -1) {
            console.warn(`Store not found in sheet: ${data['Chiến dịch'] || 'Unknown'}`);
            return;
        }

        const actualRowIndex = storeRowIndex + 1; // +1 because sheet rows are 1-indexed

        // Update clicks column
        if (clicksColumnIndex !== -1 && data.adsData.totalClicks !== undefined) {
            updateRequests.push({
                range: `${sheetName}!${getColumnLetter(clicksColumnIndex)}${actualRowIndex}`,
                values: [[data.adsData.totalClicks]]
            });
        }

        // Update cost column
        if (costColumnIndex !== -1 && data.adsData.totalCost !== undefined) {
            updateRequests.push({
                range: `${sheetName}!${getColumnLetter(costColumnIndex)}${actualRowIndex}`,
                values: [[Math.round(data.adsData.totalCost * 100) / 100]] // Round to 2 decimal places
            });
        }

        // Update impressions column
        if (impressionsColumnIndex !== -1 && data.adsData.totalImpressions !== undefined) {
            updateRequests.push({
                range: `${sheetName}!${getColumnLetter(impressionsColumnIndex)}${actualRowIndex}`,
                values: [[data.adsData.totalImpressions]]
            });
        }
    });

    // Execute batch update
    if (updateRequests.length > 0) {
        await googleSheetsService.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            resource: {
                valueInputOption: 'RAW',
                data: updateRequests
            }
        });
        console.log(`Updated ${updateRequests.length} cells in sheet: ${sheetUrl}`);
    } else {
        console.log(`No updates needed for sheet: ${sheetUrl}`);
    }
}

// Helper function to find the row index of a store in sheet data
function findStoreRowIndex(sheetData, storeData) {
    const storeName = (storeData['Chiến dịch'] || storeData['Campaign'] || '').toLowerCase().trim();

    return sheetData.findIndex(row => {
        const rowStoreName = (row['Chiến dịch'] || row['Campaign'] || '').toLowerCase().trim();
        return rowStoreName === storeName ||
            rowStoreName.includes(storeName) ||
            storeName.includes(rowStoreName);
    });
}

// Helper function to find column index by possible names
function findColumnIndex(headers, possibleNames) {
    for (const name of possibleNames) {
        const index = headers.findIndex(header =>
            header.toLowerCase().includes(name.toLowerCase())
        );
        if (index !== -1) return index;
    }
    return -1;
}

// Helper function to convert column index to letter
function getColumnLetter(index) {
    let letter = '';
    while (index >= 0) {
        letter = String.fromCharCode(65 + (index % 26)) + letter;
        index = Math.floor(index / 26) - 1;
    }
    return letter;
}

// Helper function to sync a single account (using service account)
async function syncSingleAccount(adsConfig, googleAdsService, googleSheetsService) {
    const campaigns = await googleAdsService.getAggregatedCampaignData(
        adsConfig.customerId,
        'LAST_30_DAYS'
    );

    const results = [];

    for (const sheetUrl of adsConfig.sheetUrls) {
        try {
            const sheetData = await googleSheetsService.getDataFromSheet(sheetUrl);
            const matchedData = await googleAdsService.matchCampaignWithStoreData(campaigns, sheetData);

            if (matchedData.length > 0) {
                await updateSheetWithAdsData(sheetUrl, matchedData, googleSheetsService);
            }

            results.push({
                sheetUrl,
                matchedRecords: matchedData.length,
                success: true
            });
        } catch (error) {
            results.push({
                sheetUrl,
                success: false,
                error: error.message
            });
        }
    }

    return {
        success: true,
        totalCampaigns: campaigns.length,
        sheetResults: results
    };
}

module.exports = {
    updateSheetWithAdsData,
    findColumnIndex,
    getColumnLetter,
    syncSingleAccount
};
