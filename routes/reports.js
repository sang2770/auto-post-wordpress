const express = require("express");
const router = express.Router();
const GoogleSheetsService = require("../services/googleSheetsService");
const StorageService = require("../services/storageService");

const googleSheetsService = new GoogleSheetsService();
const storageService = new StorageService();

// Get current report configuration
router.get("/config", async (req, res) => {
  try {
    const config = await storageService.getConfig();

    res.json({
      success: true,
      dataUrl: config?.dataUrl || "",
      reportUrl: config?.reportUrl || "",
      configured: !!(config?.dataUrl && config?.reportUrl),
    });
  } catch (error) {
    console.error("Error getting report config:", error);
    res.status(500).json({ error: error.message });
  }
});

// Configure report URLs
router.post("/config", async (req, res) => {
  try {
    const { dataUrl, reportUrl } = req.body;

    if (!dataUrl || !reportUrl) {
      return res
        .status(400)
        .json({ error: "Both data URL and report URL are required" });
    }

    // Validate URLs can extract sheet IDs
    const dataSheetId = googleSheetsService.extractSheetId(dataUrl);
    const reportSheetId = googleSheetsService.extractSheetId(reportUrl);

    if (!dataSheetId || !reportSheetId) {
      return res.status(400).json({ error: "Invalid Google Sheets URLs" });
    }

    // Get existing config and update with report URLs
    const existingConfig = (await storageService.getConfig()) || {};
    const updatedConfig = {
      ...existingConfig,
      dataUrl,
      reportUrl,
      dataSheetId,
      reportSheetId,
      reportConfiguredAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    await storageService.saveConfig(updatedConfig);

    console.log(
      `Report configuration saved: ${JSON.stringify(
        { dataUrl, reportUrl },
        null,
        2
      )}`
    );

    res.json({
      success: true,
      message: "Report configuration saved successfully",
      dataSheetId,
      reportSheetId,
    });
  } catch (error) {
    console.error("Report configuration error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test connection to data sheet
router.post("/test-data-connection", async (req, res) => {
  try {
    const config = await storageService.getConfig();
    if (!config?.dataUrl) {
      return res.status(400).json({ error: "No data URL configured" });
    }

    const data = await googleSheetsService.fetchReportData(config.dataUrl);

    res.json({
      success: true,
      totalRows: data.length,
      sampleData: data.slice(0, 5), // Return first 5 rows as sample
      columns: data.length > 0 ? Object.keys(data[0]) : [],
    });
  } catch (error) {
    console.error("Test data connection error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generate report by date (today by default)
router.post("/generate", async (req, res) => {
  try {
    const { date } = req.body;
    const targetDate = date || new Date().toISOString().split("T")[0]; // Today in YYYY-MM-DD format

    const config = await storageService.getConfig();
    if (!config?.dataUrl || !config?.reportUrl) {
      return res.status(400).json({
        error:
          "Report URLs not configured. Please configure data and report URLs first.",
      });
    }

    console.log(`Generating report for date: ${targetDate}`);

    // Fetch data from the data sheet
    const rawData = await googleSheetsService.fetchReportData(config.dataUrl);

    // Filter data by date and process by store
    const reportData = processDataByStore(rawData, targetDate);

    // Write report to the report sheet
    await writeReportToSheet(config.reportUrl, reportData, targetDate);

    res.json({
      success: true,
      message: `Report generated successfully for ${targetDate}`,
      date: targetDate,
      storesProcessed: Object.keys(reportData).length,
      totalRecords: Object.values(reportData).reduce(
        (sum, store) => sum + store.records.length,
        0
      ),
    });
  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get available stores from data
router.get("/stores", async (req, res) => {
  try {
    const config = await storageService.getConfig();
    if (!config?.dataUrl) {
      return res.status(400).json({ error: "No data URL configured" });
    }

    const data = await googleSheetsService.fetchReportData(config.dataUrl);
    const stores = [...new Set(data.map((row) => row[3]).filter(Boolean))];

    res.json({
      success: true,
      stores: stores.sort(),
      totalStores: stores.length,
    });
  } catch (error) {
    console.error("Error getting stores:", error);
    res.status(500).json({ error: error.message });
  }
});

function parseDataNumber(data) {
    try {
        if (typeof data === "string") {
            // Remove dots, commas, spaces, currency symbols (like "đ", "$")
            const formatData = data
            .replaceAll(/[.\sđ$]/g, "")
            .replaceAll(",", ".");
            return parseFloat(formatData) || 0;
        }
        return parseFloat(data) || 0;
    } catch (error) {
        console.error("Error parsing data number:", error);
        return 0;
    }
}
// Process data by store for a specific date
function processDataByStore(rawData) {
  const storeData = {};
  rawData.forEach((row, index) => {
    // Get store name (try different possible column names)
    const storeName = row[3];
    if (!storeName || index <=1) {
      return;
    }
    const spend = parseDataNumber(row[14] || '0');
    const clicks = parseDataNumber(row[15] || '0');
    const commission = parseDataNumber(row[16] || '0');
    const benefit = parseDataNumber(row[17] || '0');
    if (!storeData[storeName]) {
      storeData[storeName] = {
        records: [],
        totalSpend: 0,
        totalClicks: 0,
        totalCommission: 0,
        totalBenefit: 0,
      };
    }
    storeData[storeName].records.push({
      ...row,
      spend,
      clicks,
      commission,
    });

    storeData[storeName].totalSpend += spend;
    storeData[storeName].totalClicks += clicks;
    storeData[storeName].totalCommission += commission;
    storeData[storeName].totalBenefit += benefit;
  });

  return storeData;
}

// Write report data to Google Sheets
async function writeReportToSheet(reportUrl, reportData, targetDate) {
  try {
    const spreadsheetId = googleSheetsService.extractSheetId(reportUrl);
    const gid = googleSheetsService.extractGid(reportUrl);
    
    if (!spreadsheetId) {
      throw new Error('Invalid report sheet URL');
    }
    const spreadsheet = await googleSheetsService.getInfoSheetsFromUrl(reportUrl);

    // Get sheet name from GID
    const sheetName = spreadsheet.sheets?.find(sheet => sheet.properties?.sheetId == gid)?.properties?.title || 'Sheet1';

    console.log("Report data structure:");
    console.log("Date:", targetDate);
    console.log("Stores:", Object.keys(reportData));

    // Read existing data to find the next available column set
    const existingData = await googleSheetsService.readSheetValues(spreadsheetId, `${sheetName}!A:Z`);
    // Get store existed from A3 -> bottom
    const existingStores = existingData.slice(2).map(row => row[0]).filter(Boolean);

    // Find the next available column (looking for groups of 3 columns: B-D, E-G, H-J, etc.)
    let nextColumnStart = 'B'; // Start from column B
    let colIndex = 1; // B = index 1
    
    if (existingData.length > 0) {
      // Find the first empty group of 3 columns
      while (colIndex < 26) { // Limit to column Z
        const col1 = String.fromCharCode(65 + colIndex);
        
        // Check if all 3 columns are empty in row 1
        const row1 = existingData[0] || [];
        if (!row1[colIndex] && !row1[colIndex + 1] && !row1[colIndex + 2]) {
          nextColumnStart = col1;
          break;
        }
        colIndex += 4;
      }
    }

    // Prepare the data structure
    const stores = [...existingStores, ...Object.keys(reportData).filter(store => !existingStores.includes(store))];
    // Prepare the data to write
    const dataToWrite = [];
    
    // Row 1: Date (merged across 4 columns) - we'll put the date in the first column
    dataToWrite.push([targetDate, '', '', '']);
    
    // Row 2: Headers
    dataToWrite.push(['Số Tiền Chạy(VNĐ)', 'Click', 'CĐ', 'Tiền Hoa Hồng ($)']);
    
    // Rows 3+: Store data
    stores.forEach(storeName => {
      const storeData = reportData[storeName];
      if (!storeData) {
        dataToWrite.push(['', '', '', '']);
      } else {
        dataToWrite.push([
          storeData.totalSpend,
          storeData.totalClicks,
          storeData.totalCommission,
          storeData.totalBenefit,
        ]);
      }
    });

    // If this is the first report (starting at column B), add store names in column A
    if (nextColumnStart === 'B') {
      const storeNamesData = [];
      storeNamesData.push(['']); // A1 empty
      storeNamesData.push(['']); // A2 empty  
      stores.forEach(storeName => {
        storeNamesData.push([storeName]);
      });
      
      // Write store names in column A
      const storeNamesRange = `${sheetName}!A1:A${storeNamesData.length}`;
      console.log(`Writing store names to range: ${storeNamesRange}`);

      await googleSheetsService.writeSheetValues(spreadsheetId, storeNamesRange, storeNamesData);
    }

    // Write the report data starting from the determined column
    const endCol = String.fromCharCode(nextColumnStart.charCodeAt(0) + 3);
    const dataRange = `${sheetName}!${nextColumnStart}1:${endCol}${dataToWrite.length}`;
    
    await googleSheetsService.writeSheetValues(spreadsheetId, dataRange, dataToWrite);

    console.log(`Successfully wrote report data to sheet starting at column ${nextColumnStart}`);
    return {
      success: true,
      startColumn: nextColumnStart,
      endColumn: endCol,
      stores: stores.length,
      date: targetDate
    };

  } catch (error) {
    console.error('Error writing to Google Sheets:', error);
    throw new Error(`Failed to write report to sheet: ${error.message}`);
  }
}

module.exports = router;
