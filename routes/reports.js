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
      const formatData = data.replaceAll(/[.\sđ$]/g, "").replaceAll(",", ".");
      return parseFloat(formatData) || 0;
    }
    return parseFloat(data) || 0;
  } catch (error) {
    console.error("Error parsing data number:", error);
    return 0;
  }
}

// Helper function to convert column letter to index (A=0, B=1, etc.)
function getColumnIndex(columnLetter) {
  let result = 0;
  for (let i = 0; i < columnLetter.length; i++) {
    result = result * 26 + (columnLetter.charCodeAt(i) - 64);
  }
  return result - 1;
}

// Helper function to convert column index to letter (0=A, 1=B, etc.)
function getColumnLetter(columnIndex) {
  let result = "";
  while (columnIndex >= 0) {
    result = String.fromCharCode((columnIndex % 26) + 65) + result;
    columnIndex = Math.floor(columnIndex / 26) - 1;
  }
  return result;
}
// Process data by store for a specific date
function processDataByStore(rawData) {
  const storeData = {};
  rawData.forEach((row, index) => {
    // Get store name (try different possible column names)
    const storeName = row[3];
    if (!storeName || index <= 1) {
      return;
    }
    const spend = parseDataNumber(row[14] || "0");
    const clicks = parseDataNumber(row[15] || "0");
    const commission = parseDataNumber(row[16] || "0");
    const benefit = parseDataNumber(row[17] || "0");
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
      throw new Error("Invalid report sheet URL");
    }
    const spreadsheet = await googleSheetsService.getInfoSheetsFromUrl(
      reportUrl
    );

    // Get sheet name from GID
    const sheetName =
      spreadsheet.sheets?.find((sheet) => sheet.properties?.sheetId == gid)
        ?.properties?.title || "Sheet1";

    console.log("Report data structure:");
    console.log("Date:", targetDate);
    console.log("Stores:", Object.keys(reportData));

    // Get previous report data for comparison
    const previousReport = await storageService.getLastReport();
    const previousData = previousReport?.data || {};

    // Read existing data to find the next available column set
    const existingData = await googleSheetsService.readSheetValues(
      spreadsheetId,
      `${sheetName}!A:CV`
    ); // Read up to column CV (100 columns)
    // Get store existed from A3 -> bottom
    const existingStores = existingData
      .slice(2)
      .map((row) => row[0])
      .filter(Boolean);

    // Find the next available column (looking for groups of 5 columns: B-F, G-K, L-P, etc.)
    let nextColumnStart = "B"; // Start from column B
    let colIndex = 1; // B = index 1

    if (existingData.length > 0) {
      // Find the first empty group of 5 columns (4 data + 1 change column)
      const maxColumns = 100; // Allow up to column CV (100 columns should be enough)
      while (colIndex < maxColumns) {
        const col1 = getColumnLetter(colIndex);

        // Check if all 5 columns are empty in row 1
        const row1 = existingData[0] || [];
        if (
          !row1[colIndex] &&
          !row1[colIndex + 1] &&
          !row1[colIndex + 2] &&
          !row1[colIndex + 3] &&
          !row1[colIndex + 4]
        ) {
          nextColumnStart = col1;
          break;
        }
        colIndex += 5; // Move to next group of 5 columns
      }
    }

    // Prepare the data structure
    const stores = [
      ...existingStores,
      ...Object.keys(reportData).filter(
        (store) => !existingStores.includes(store)
      ),
    ];
    // Prepare the data to write
    const dataToWrite = [];

    // Row 1: Date (merged across 5 columns) - we'll put the date in the first column
    dataToWrite.push([targetDate, "", "", "", ""]);

    // Row 2: Headers
    dataToWrite.push([
      "Số Tiền Chạy(VNĐ)",
      "Click",
      "CĐ",
      "Tiền Hoa Hồng ($)",
      "Trạng thái",
    ]);

    // Rows 3+: Store data with change calculation
    stores.forEach((storeName) => {
      const storeData = reportData[storeName];
      const previousStoreData = previousData[storeName];

      if (!storeData) {
        dataToWrite.push(["", "", "", "", ""]);
      } else {
        // Calculate changes from previous report
        let changeIndicator = "Mới"; // Default for new stores

        if (
          previousStoreData &&
          (storeData.totalSpend != previousStoreData.totalSpend ||
            storeData.totalClicks != previousStoreData.totalClicks ||
            storeData.totalCommission != previousStoreData.totalCommission ||
            storeData.totalBenefit != previousStoreData.totalBenefit)
        ) {
          changeIndicator = "Thay Đổi";
        } else if (previousStoreData) {
          changeIndicator = "";
        }

        dataToWrite.push([
          storeData.totalSpend,
          storeData.totalClicks,
          storeData.totalCommission,
          storeData.totalBenefit,
          changeIndicator,
        ]);
      }
    });

    const storeNamesData = [];
    storeNamesData.push([""]); // A1 empty
    storeNamesData.push([""]); // A2 empty
    stores.forEach((storeName) => {
      storeNamesData.push([storeName]);
    });

    // Write store names in column A
    const storeNamesRange = `${sheetName}!A1:A${storeNamesData.length}`;
    console.log(`Writing store names to range: ${storeNamesRange}`);

    await googleSheetsService.writeSheetValues(
      spreadsheetId,
      storeNamesRange,
      storeNamesData
    );

    // Write the report data starting from the determined column
    const endCol = getColumnLetter(getColumnIndex(nextColumnStart) + 4); // 5 columns total (0-4)
    const dataRange = `${sheetName}!${nextColumnStart}1:${endCol}${dataToWrite.length}`;

    console.log(`Writing data to range: ${dataRange}`);
    await googleSheetsService.writeSheetValues(
      spreadsheetId,
      dataRange,
      dataToWrite
    );

    // Merge the date header cells (row 1, columns across 5 columns)
    const startColIndex = getColumnIndex(nextColumnStart); // Convert column letter to index (A=0, B=1, etc.)
    const endColIndex = startColIndex + 5; // Merge 5 columns

    try {
      await googleSheetsService.mergeCells(
        spreadsheetId,
        gid || 0, // Use GID if available, otherwise default sheet (0)
        0, // Start row index (row 1 = index 0)
        1, // End row index (row 1 = index 1, exclusive)
        startColIndex, // Start column index
        endColIndex, // End column index (exclusive)
        "MERGE_ALL"
      );
      console.log(
        `Successfully merged date header cells from column ${nextColumnStart} to ${getColumnLetter(
          endColIndex - 1
        )} with complete formatting`
      );

      // Apply borders to all data cells (headers + data rows)
      const borderFormat = {
        borders: {
          top: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          bottom: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          left: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          right: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } }
        }
      };

      // Apply borders to data columns (from row 2 onwards, all data rows)
      await googleSheetsService.formatCells(
        spreadsheetId,
        gid || 0,
        1, // Start from row 2 (headers)
        dataToWrite.length, // End at the last data row
        startColIndex, // Start column index
        endColIndex, // End column index (exclusive)
        borderFormat
      );

      // Apply center alignment to header row (row 2)
      const headerFormat = {
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
        textFormat: {
          bold: true,
          fontSize: 11
        },
        borders: {
          top: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          bottom: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          left: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          right: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } }
        }
      };

      await googleSheetsService.formatCells(
        spreadsheetId,
        gid || 0,
        1, // Row 2 (headers)
        2, // End at row 2 (exclusive)
        startColIndex, // Start column index
        endColIndex, // End column index (exclusive)
        headerFormat
      );

      // Also apply borders to store names column (column A) if this is the first report
      if (nextColumnStart === 'B') {
        await googleSheetsService.formatCells(
          spreadsheetId,
          gid || 0,
          1, // Start from row 2 (headers)
          dataToWrite.length, // End at the last data row
          0, // Column A (index 0)
          1, // Column A only (exclusive end)
          borderFormat
        );
      }
      console.log(`Successfully applied borders and center formatting to all columns`);
    } catch (mergeError) {
      console.warn(
        `Warning: Could not merge cells for date header: ${mergeError.message}`
      );
      // Continue execution even if merge fails
    }

    // Save current report data for future comparison
    try {
      await storageService.saveLastReport(reportData);
      console.log(
        "Successfully saved current report data for future comparison"
      );
    } catch (saveError) {
      console.warn(`Warning: Could not save report data: ${saveError.message}`);
    }

    console.log(
      `Successfully wrote report data to sheet starting at column ${nextColumnStart}`
    );
    return {
      success: true,
      startColumn: nextColumnStart,
      endColumn: endCol,
      stores: stores.length,
      date: targetDate,
      changesTracked: !!previousReport,
      previousReportDate: previousReport?.timestamp || null,
    };
  } catch (error) {
    console.error("Error writing to Google Sheets:", error);
    throw new Error(`Failed to write report to sheet: ${error.message}`);
  }
}

module.exports = router;
