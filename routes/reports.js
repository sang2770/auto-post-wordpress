const express = require("express");
const router = express.Router();
const GoogleSheetsService = require("../services/googleSheetsService");
const StorageService = require("../services/storageService");

const googleSheetsService = new GoogleSheetsService();
const storageService = new StorageService();

// Function to get current USD to VND exchange rate
async function getCurrentExchangeRate() {
  try {
    const response = await fetch(
      "https://api.exchangerate-api.com/v4/latest/USD"
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    const exchangeRate = data.rates.VND;

    if (!exchangeRate || exchangeRate <= 0) {
      throw new Error("Invalid exchange rate received");
    }

    console.log(`Current USD to VND exchange rate: ${exchangeRate}`);
    return exchangeRate;
  } catch (error) {
    console.warn(
      "Failed to fetch exchange rate, using fallback value 26000:",
      error.message
    );
    return 26000; // Fallback value
  }
}

// Get current report configuration
router.get("/config", async (req, res) => {
  try {
    const config = await storageService.getConfig();

    res.json({
      success: true,
      urlPairs: config?.urlPairs || [],
      summaryReportUrl: config?.summaryReportUrl || "",
      configured: !!(config?.urlPairs && config?.urlPairs.length > 0),
    });
  } catch (error) {
    console.error("Error getting report config:", error);
    res.status(500).json({ error: error.message });
  }
});

// Configure report URLs
router.post("/config", async (req, res) => {
  try {
    const { urlPairs, summaryReportUrl } = req.body;

    if (!urlPairs || !Array.isArray(urlPairs) || urlPairs.length === 0) {
      return res.status(400).json({
        error: "At least one pair of data URL and report URL is required",
      });
    }

    // Validate all URL pairs
    const validatedPairs = [];
    for (const pair of urlPairs) {
      const { dataUrl, reportUrl } = pair;

      if (!dataUrl || !reportUrl) {
        return res.status(400).json({
          error: "Both data URL and report URL are required for each pair",
        });
      }

      // Validate URLs can extract sheet IDs
      const dataSheetId = googleSheetsService.extractSheetId(dataUrl);
      const reportSheetId = googleSheetsService.extractSheetId(reportUrl);

      if (!dataSheetId || !reportSheetId) {
        return res.status(400).json({ error: "Invalid Google Sheets URLs" });
      }

      validatedPairs.push({
        dataUrl,
        reportUrl,
        dataSheetId,
        reportSheetId,
      });
    }

    // Validate summary report URL if provided
    let summarySheetId = null;
    if (summaryReportUrl) {
      summarySheetId = googleSheetsService.extractSheetId(summaryReportUrl);
      if (!summarySheetId) {
        return res
          .status(400)
          .json({ error: "Invalid summary report Google Sheets URL" });
      }
    }

    // Get existing config and update with report URLs
    const existingConfig = (await storageService.getConfig()) || {};
    const updatedConfig = {
      ...existingConfig,
      urlPairs: validatedPairs,
      summaryReportUrl: summaryReportUrl || null,
      summarySheetId: summarySheetId,
      reportConfiguredAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    await storageService.saveConfig(updatedConfig);

    console.log(
      `Report configuration saved: ${JSON.stringify(
        {
          urlPairsCount: validatedPairs.length,
          hasSummaryReport: !!summaryReportUrl,
        },
        null,
        2
      )}`
    );

    res.json({
      success: true,
      message: "Report configuration saved successfully",
      urlPairsCount: validatedPairs.length,
      hasSummaryReport: !!summaryReportUrl,
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
    if (!config?.urlPairs || config.urlPairs.length === 0) {
      return res.status(400).json({ error: "No data URLs configured" });
    }

    // Test all data URLs
    const results = [];
    let totalRows = 0;

    for (const [index, pair] of config.urlPairs.entries()) {
      console.log(
        `Testing data connection for pair ${index + 1}/${config.urlPairs.length
        }`
      );

      try {
        const data = await googleSheetsService.fetchReportData(pair.dataUrl);

        results.push({
          pairIndex: index,
          dataUrl: pair.dataUrl,
          reportUrl: pair.reportUrl,
          success: true,
          totalRows: data.length,
          columns: data.length > 0 ? Object.keys(data[0]) : [],
          sampleData: data.slice(0, 5), // Return first 5 rows as sample
        });

        totalRows += data.length;
      } catch (pairError) {
        console.error(`Error testing pair ${index + 1}:`, pairError);
        results.push({
          pairIndex: index,
          dataUrl: pair.dataUrl,
          reportUrl: pair.reportUrl,
          success: false,
          error: pairError.message,
        });
      }
    }

    // Check if at least one connection was successful
    const anySuccess = results.some((result) => result.success);

    if (!anySuccess) {
      return res.status(500).json({
        error: "Failed to connect to any data sources",
        results,
      });
    }

    res.json({
      success: true,
      totalPairs: config.urlPairs.length,
      successfulPairs: results.filter((r) => r.success).length,
      failedPairs: results.filter((r) => !r.success).length,
      totalRows,
      results,
      // Include sample data from the first successful connection
      sampleData:
        results.find((r) => r.success && r.sampleData?.length > 0)
          ?.sampleData || [],
      columns:
        results.find((r) => r.success && r.columns?.length > 0)?.columns || [],
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
    if (!config?.urlPairs || config.urlPairs.length === 0) {
      return res.status(400).json({
        error:
          "Report URLs not configured. Please configure data and report URLs first.",
      });
    }

    console.log(`Generating report for date: ${targetDate}`);

    // Process each URL pair
    const results = [];
    const summaryData = [];
    const allReportData = {}; // Collect all report data for saving

    for (const [index, pair] of config.urlPairs.entries()) {
      console.log(`Processing URL pair ${index + 1}/${config.urlPairs.length}`);

      // Fetch data from the data sheet
      const rawData = await googleSheetsService.fetchReportData(pair.dataUrl);

      // Filter data by date and process by store
      const reportData = processDataByStore(rawData, targetDate);

      // Store this pair's report data for later saving
      allReportData[`pair_${index}`] = {
        pairIndex: index,
        dataUrl: pair.dataUrl,
        reportUrl: pair.reportUrl,
        reportData: reportData,
      };

      // Write report to the report sheet to get change information
      const result = await writeReportToSheet(
        pair.reportUrl,
        reportData,
        targetDate,
        index
      );

      // Calculate totals for this pair only from stores with changes (changeIndicator != "")
      const pairTotals = {
        totalSpend: 0,
        totalClicks: 0,
        totalCommission: 0,
        totalBenefit: 0,
      };

      // Sum only from stores that have change indicators
      if (result.changedStoresData && result.changedStoresData.length > 0) {
        result.changedStoresData.forEach((storeData) => {
          pairTotals.totalSpend += storeData.totalSpend;
          pairTotals.totalClicks += storeData.totalClicks;
          pairTotals.totalCommission += storeData.totalCommission;
          pairTotals.totalBenefit += storeData.totalBenefit;
        });
      }

      results.push({
        pairIndex: index,
        dataUrl: pair.dataUrl,
        reportUrl: pair.reportUrl,
        storesProcessed: Object.keys(reportData).length,
        changedStores: result.changedStoresData
          ? result.changedStoresData.length
          : 0,
        totalRecords: Object.values(reportData).reduce(
          (sum, store) => sum + store.records.length,
          0
        ),
        ...pairTotals,
        ...result,
      });

      let sheetName = "Sheet1"; // Default fallback
      try {
        const dataSpreadsheet = await googleSheetsService.getInfoSheetsFromUrl(
          pair.dataUrl
        );
        const dataGid = googleSheetsService.extractGid(pair.dataUrl);
        const dataSheet = dataSpreadsheet.sheets?.find(
          (sheet) => sheet.properties?.sheetId == dataGid
        );
        if (dataSheet?.properties?.title) {
          sheetName = dataSheet.properties.title;
        }
      } catch (sheetError) {
        console.warn(
          `Warning: Could not get sheet name for pair ${index + 1
          }, using default`
        );
      }

      // Add to summary data
      summaryData.push({
        pairIndex: index,
        reportUrl: pair.reportUrl,
        dataUrl: pair.dataUrl,
        sheetName: sheetName,
        ...pairTotals,
      });
    }

    // Generate summary report if configured
    if (config.summaryReportUrl) {
      try {
        await writeSummaryReport(
          config.summaryReportUrl,
          summaryData,
          targetDate
        );
        console.log("Summary report generated successfully");
      } catch (summaryError) {
        console.error("Error generating summary report:", summaryError);
        // Don't fail the entire operation if summary fails
      }
    }

    // Save all report data for future comparison
    try {
      await storageService.saveLastReport(allReportData);
      console.log(
        "Successfully saved all pairs report data for future comparison"
      );
    } catch (saveError) {
      console.warn(`Warning: Could not save report data: ${saveError.message}`);
    }

    res.json({
      success: true,
      message: `Report generated successfully for ${targetDate}`,
      date: targetDate,
      results,
      totalPairsProcessed: results.length,
      totalStoresProcessed: results.reduce(
        (sum, r) => sum + r.storesProcessed,
        0
      ),
      totalRecords: results.reduce((sum, r) => sum + r.totalRecords, 0),
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
    if (!config?.urlPairs || config.urlPairs.length === 0) {
      return res.status(400).json({ error: "No data URLs configured" });
    }

    // Get stores from the first data URL
    const firstPair = config.urlPairs[0];
    const data = await googleSheetsService.fetchReportData(firstPair.dataUrl);
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
const fnumber = (val) => {
  if (typeof val === "string") {
    const formatVal = val.replaceAll(/[.\sđ$]/g, "").replaceAll(",", ".");
    return parseFloat(formatVal) || 0;
  }
  return parseFloat(val) || 0;
};

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

// Helper function to format numbers with thousands separators
function formatNumber(number) {
  if (typeof number !== "number" || isNaN(number)) {
    return 0; // Return numeric 0 instead of string "0"
  }
  return Math.round(number); // Return numeric value instead of formatted string
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
function processDataByStore(rawData, targetDate) {
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
    const runner = row[12] || "";
    if (!storeData[storeName]) {
      storeData[storeName] = {
        records: [],
        totalSpend: 0,
        totalClicks: 0,
        totalCommission: 0,
        totalBenefit: 0,
        runner: "",
      };
    }
    storeData[storeName].records.push({
      ...row,
      spend,
      clicks,
      commission,
      benefit,
      runner,
    });
    storeData[storeName].totalSpend += spend;
    storeData[storeName].totalClicks += clicks;
    storeData[storeName].totalCommission += commission;
    storeData[storeName].totalBenefit += benefit;
    if (!storeData[storeName].runner && runner) {
      storeData[storeName].runner = runner;
    }
  });

  Object.keys(storeData).forEach((storeName) => {
    const s = storeData[storeName];
    if (
      s.totalSpend === 0 &&
      s.totalClicks === 0 &&
      s.totalCommission === 0 &&
      s.totalBenefit === 0
    ) {
      delete storeData[storeName];
    }
  });

  return storeData;
}

// Write report data to Google Sheets
async function writeReportToSheet(
  reportUrl,
  reportData,
  targetDate,
  pairIndex = 0
) {
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

    // Ensure we have a valid numeric sheet ID
    const numericSheetId = gid ? parseInt(gid, 10) : 0;

    console.log("Report data structure:");
    console.log("Date:", targetDate);
    console.log("Stores:", Object.keys(reportData).length);

    // Get previous report data for comparison
    const previousReport = await storageService.getLastReport();
    const allPreviousData = previousReport?.data || {};

    // Extract previous data for this specific pair
    const previousPairData = allPreviousData[`pair_${pairIndex}`];
    const previousData = previousPairData?.reportData || {};

    // Read existing data to find the next available column set
    let existingData = [];
    try {
      existingData = await googleSheetsService.readSheetValues(
        spreadsheetId,
        `${sheetName}`
      );
    } catch (readError) {
      console.warn(
        `Warning: Could not read existing data, starting fresh: ${readError.message}`
      );
      existingData = [];
    }
    existingData = existingData.slice(2);
    let dataTotalStoreWrites = new Map();
    if (existingData.length > 0) {
      existingData.slice(1).forEach((row) => {
        const dataTotalStore = {
          totalSpend: 0,
          totalClicks: 0,
          totalCommission: 0,
          totalBenefit: 0,
        };
        let index = 5;
        while (index < row.length) {
          dataTotalStore.totalSpend += fnumber(row[index] || "0");
          dataTotalStore.totalClicks += fnumber(row[index + 1] || "0");
          dataTotalStore.totalCommission += fnumber(row[index + 2] || "0");
          dataTotalStore.totalBenefit += fnumber(row[index + 3] || "0");
          index += 6;
        }
        dataTotalStoreWrites.set(row[0], {
          totalSpend: dataTotalStore.totalSpend,
          totalClicks: dataTotalStore.totalClicks,
          totalCommission: dataTotalStore.totalCommission,
          totalBenefit: dataTotalStore.totalBenefit,
        });
      });
    }
    const startWriteRow = 0;

    // Get store existed from A3 -> bottom, excluding any existing "TỔNG" entries
    const existingStores = existingData
      .map((row) => row[0])
      .filter(Boolean)
      .filter((storeName) => storeName !== "TỔNG" && storeName !== "TỔNG CỘNG");

    // Find the next available column (looking for groups of 6 columns: B-G, H-M, N-S, etc.)
    let nextColumnStart = "F"; // Start from column F
    let colIndex = 5; // F = index 5

    if (existingData.length > 0) {
      while (true) {
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
        colIndex += 6; // Move to next group of 6 columns
      }
    }

    console.log("Next available column for writing:", nextColumnStart);

    // Prepare the data structure
    const stores = [
      ...existingStores,
      ...Object.keys(reportData).filter(
        (store) => !existingStores.includes(store)
      ),
    ];
    console.log("xxxx", ...existingStores, Object.keys(reportData).filter(
      (store) => !existingStores.includes(store)
    ));


    // Calculate required dimensions
    const requiredRows = Math.max(stores.length + 3, 10); // +3 for header rows + summary row, minimum 10
    const requiredColumns = getColumnIndex(nextColumnStart) + 12; // 6 columns for this report

    console.log(
      `Required dimensions: ${requiredRows} rows, ${requiredColumns} columns`
    );

    // Ensure sheet has enough space
    try {
      await googleSheetsService.ensureSheetSize(
        spreadsheetId,
        numericSheetId,
        requiredRows,
        requiredColumns
      );
      console.log("Sheet size verified/expanded successfully");
    } catch (sizeError) {
      console.warn(
        `Warning: Could not ensure sheet size: ${sizeError.message}`
      );
      // Continue execution but log the warning
    }
    // Prepare the data to write
    const dataToWrite = [];

    // Row 1: Date (merged across 6 columns) - we'll put the date in the first column
    dataToWrite.push([targetDate, "", "", "", "", ""]);

    // Row 2: Headers
    dataToWrite.push([
      "Số Tiền Chạy(VNĐ)",
      "Click",
      "CĐ",
      "Tiền Hoa Hồng ($)",
      "Trạng thái",
      "Người chạy",
    ]);

    // Calculate totals first
    let totalSpend = 0;
    let totalClicks = 0;
    let totalCommission = 0;
    let totalBenefit = 0;

    // Track stores with changes for summary
    const changedStoresData = [];

    // Calculate totals from all stores
    stores.forEach((storeName) => {
      const storeData = reportData[storeName];
      if (storeData) {
        totalSpend += storeData.totalSpend;
        totalClicks += storeData.totalClicks;
        totalCommission += storeData.totalCommission;
        totalBenefit += storeData.totalBenefit;
      }
    });

    // Row 3: Add summary row with totals at the top
    dataToWrite.push([
      totalSpend,
      totalClicks,
      totalCommission,
      totalBenefit,
      "",
      "",
    ]);

    // Rows 4+: Store data with change calculation
    stores.forEach((storeName) => {
      const storeData = reportData[storeName];
      const previousStoreData = previousData[storeName];

      if (!storeData) {
        dataToWrite.push(["", "", "", "", "", ""]);
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

        // Track stores with change indicators (not empty)
        if (changeIndicator !== "") {
          changedStoresData.push({
            storeName,
            totalSpend: storeData.totalSpend,
            totalClicks: storeData.totalClicks,
            totalCommission: storeData.totalCommission,
            totalBenefit: storeData.totalBenefit,
            changeIndicator,
            runner: storeData.runner,
          });
        }

        dataToWrite.push([
          storeData.totalSpend,
          storeData.totalClicks,
          storeData.totalCommission,
          storeData.totalBenefit,
          changeIndicator,
          storeData.runner,
        ]);
        const summaryStore = dataTotalStoreWrites.get(storeName);
        if (summaryStore) {
          summaryStore.totalSpend += storeData.totalSpend;
          summaryStore.totalClicks += storeData.totalClicks;
          summaryStore.totalCommission += storeData.totalCommission;
          summaryStore.totalBenefit += storeData.totalBenefit;
        } else {
          dataTotalStoreWrites.set(storeName, {
            totalSpend: storeData.totalSpend,
            totalClicks: storeData.totalClicks,
            totalCommission: storeData.totalCommission,
            totalBenefit: storeData.totalBenefit,
            runner: storeData.runner,
          });
        }
      }
    });

    const storeNamesData = [];
    storeNamesData.push([""]); // A1 empty
    storeNamesData.push([""]); // A2 empty
    // Add summary row label at the top
    storeNamesData.push(["TỔNG"]);
    stores.forEach((storeName) => {
      storeNamesData.push([storeName]);
    });

    // Write store names in column A
    const storeNamesRange = `${sheetName}!A1:A${storeNamesData.length}`;

    await googleSheetsService.writeSheetValues(
      spreadsheetId,
      storeNamesRange,
      storeNamesData
    );

    // Write the report data starting from the determined column
    const endCol = getColumnLetter(getColumnIndex(nextColumnStart) + 5); // 6 columns total (0-5)
    const dataRange = `${sheetName}!${nextColumnStart}${startWriteRow + 1
      }:${endCol}${startWriteRow + 1 + dataToWrite.length}`;
    const dataTotalStoreWritesList = [
      ["Tổng", "", "", ""],
      ["Số Tiền Chạy(VNĐ)", "Click", "CĐ", "Tiền Hoa Hồng ($)"],
    ];
    const dataTotalStoreWritesSummary = {
      totalSpend: 0,
      totalClicks: 0,
      totalCommission: 0,
      totalBenefit: 0,
    }
    dataTotalStoreWrites.forEach((value, key) => {
      dataTotalStoreWritesList.push([value.totalSpend, value.totalClicks, value.totalCommission, value.totalBenefit]);
      dataTotalStoreWritesSummary.totalSpend += value.totalSpend;
      dataTotalStoreWritesSummary.totalClicks += value.totalClicks;
      dataTotalStoreWritesSummary.totalCommission += value.totalCommission;
      dataTotalStoreWritesSummary.totalBenefit += value.totalBenefit;
    });
    dataTotalStoreWritesList.splice(2, 0, [dataTotalStoreWritesSummary.totalSpend, dataTotalStoreWritesSummary.totalClicks, dataTotalStoreWritesSummary.totalCommission, dataTotalStoreWritesSummary.totalBenefit]);
    await googleSheetsService.writeSheetValues(
      spreadsheetId,
      `${sheetName}!B1:E${dataTotalStoreWritesList.length + 1}`,
      dataTotalStoreWritesList
    );

    console.log(`Writing data to range: ${dataRange}`);
    await googleSheetsService.writeSheetValues(
      spreadsheetId,
      dataRange,
      dataToWrite
    );

    // Merge the date header cells (row 1, columns across 6 columns)
    const startColIndex = getColumnIndex(nextColumnStart); // Convert column letter to index (A=0, B=1, etc.)
    const endColIndex = startColIndex + 6; // Merge 6 columns

    try {
      // Add debug information to help diagnose the issue
      console.log(
        `Attempting to merge cells: Sheet ID: ${numericSheetId}, Row range: 0-1, Column range: ${startColIndex}-${endColIndex}`
      );

      // Apply borders to all data cells (headers + data rows)
      const borderFormat = {
        numberFormat: {
          type: "NUMBER",
          pattern: "#,##0",
        },
        borders: {
          top: {
            style: "SOLID",
            width: 1,
            color: { red: 0, green: 0, blue: 0 },
          },
          bottom: {
            style: "SOLID",
            width: 1,
            color: { red: 0, green: 0, blue: 0 },
          },
          left: {
            style: "SOLID",
            width: 1,
            color: { red: 0, green: 0, blue: 0 },
          },
          right: {
            style: "SOLID",
            width: 1,
            color: { red: 0, green: 0, blue: 0 },
          },
        },
      };
      // Apply borders to data columns (from row 2 onwards, all data rows)
      await googleSheetsService.formatCells(
        spreadsheetId,
        numericSheetId,
        startWriteRow, // Start from row 2 (headers)
        startWriteRow + dataToWrite.length, // End at the last data row
        startColIndex, // Start column index
        endColIndex, // End column index (exclusive)
        borderFormat
      );

      await googleSheetsService.formatCells(
        spreadsheetId,
        numericSheetId,
        0,
        storeNamesData.length, // All rows with store names
        0, // Start column index
        endColIndex, // End column index (exclusive)
        borderFormat
      );

      await googleSheetsService.mergeCells(
        spreadsheetId,
        numericSheetId, // Use validated numeric sheet ID
        startWriteRow, // Start row index (row 1 = index 0)
        startWriteRow + 1, // End row index (row 2 = index 1, exclusive)
        startColIndex, // Start column index
        endColIndex, // End column index (exclusive)
        "MERGE_ALL"
      );

      await googleSheetsService.mergeCells(
        spreadsheetId,
        numericSheetId, // Use validated numeric sheet ID
        0, // Start row index (row 1 = index 0)
        1, // End row index (row 2 = index 1, exclusive)
        1, // Start column index
        5, // End column index (exclusive)
        "MERGE_ALL"
      );
      console.log(
        `Successfully merged date header cells from column ${nextColumnStart} to ${getColumnLetter(
          endColIndex - 1
        )} with complete formatting`
      );

      // Apply center alignment to header row (row 2)
      const headerFormat = {
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        textFormat: {
          bold: true,
          fontSize: 11,
        },
        numberFormat: {
          type: "NUMBER",
          pattern: "#,##0",
        },
        ...borderFormat,
      };

      await googleSheetsService.formatCells(
        spreadsheetId,
        numericSheetId,
        startWriteRow, // Row 2 (headers)
        startWriteRow + 3, // End at row 2 (exclusive)
        1, // Start column index
        endColIndex, // End column index (exclusive)
        headerFormat
      );

      // Apply special formatting to summary row (bold and background color)
      const summaryRowIndex = startWriteRow + 2; // Summary row is now the 3rd row (index 2)
      const summaryFormat = {
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        textFormat: {
          bold: true,
          fontSize: 11,
        },
        backgroundColor: {
          red: 0.9,
          green: 0.9,
          blue: 0.9,
        },
        numberFormat: {
          type: "NUMBER",
          pattern: "#,##0",
        },
        borders: {
          top: {
            style: "SOLID",
            width: 2,
            color: { red: 0, green: 0, blue: 0 },
          },
          bottom: {
            style: "SOLID",
            width: 2,
            color: { red: 0, green: 0, blue: 0 },
          },
          left: {
            style: "SOLID",
            width: 1,
            color: { red: 0, green: 0, blue: 0 },
          },
          right: {
            style: "SOLID",
            width: 1,
            color: { red: 0, green: 0, blue: 0 },
          },
        },
      };

      // Apply summary formatting to both data columns and store name column
      await googleSheetsService.formatCells(
        spreadsheetId,
        numericSheetId,
        summaryRowIndex, // Summary row
        summaryRowIndex + 1, // End at summary row (exclusive)
        1, // Start column index
        endColIndex, // End column index (exclusive)
        summaryFormat
      );

      console.log(
        `Successfully applied borders and center formatting to all columns`
      );

      // Auto-fit columns to content
      try {
        await googleSheetsService.autoFitColumns(
          spreadsheetId,
          numericSheetId,
          0, // Start from column A
          endColIndex // End at the last column used
        );
        console.log(
          `Successfully auto-fitted columns A to ${getColumnLetter(
            endColIndex - 1
          )}`
        );
      } catch (autoFitError) {
        console.warn(
          `Warning: Could not auto-fit columns: ${autoFitError.message}`
        );
      }
    } catch (mergeError) {
      console.warn(
        `Warning: Could not merge cells for date header: ${mergeError.message}`
      );
      console.warn(
        `Merge details: Sheet: ${numericSheetId}, Row: 0-1, Columns: ${startColIndex}-${endColIndex}`
      );
      // Continue execution even if merge fails
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
      changedStoresData: changedStoresData,
    };
  } catch (error) {
    console.error("Error writing to Google Sheets:", error);
    throw new Error(`Failed to write report to sheet: ${error.message}`);
  }
}

// Write summary report data to Google Sheets
async function writeSummaryReport(summaryReportUrl, summaryData, targetDate) {
  try {
    const spreadsheetId = googleSheetsService.extractSheetId(summaryReportUrl);
    const gid = googleSheetsService.extractGid(summaryReportUrl);

    if (!spreadsheetId) {
      throw new Error("Invalid summary report sheet URL");
    }

    const spreadsheet = await googleSheetsService.getInfoSheetsFromUrl(
      summaryReportUrl
    );
    // Get sheet name from GID
    const sheetName =
      spreadsheet.sheets?.find((sheet) => sheet.properties?.sheetId == gid)
        ?.properties?.title || "Sheet1";

    console.log("Writing summary report for date:", targetDate);

    // Get current exchange rate
    const exchangeRate = await getCurrentExchangeRate();
    console.log(`Using exchange rate for profit calculations: ${exchangeRate}`);

    // Read existing data to find where to insert new data
    let existingData = [];
    try {
      existingData = await googleSheetsService.readSheetValues(
        spreadsheetId,
        `${sheetName}!A:G`
      );
    } catch (readError) {
      console.warn(
        `Warning: Could not read existing summary data: ${readError.message}`
      );
      existingData = [];
    }

    // Calculate overall totals for current date
    const overallTotals = summaryData.reduce(
      (totals, pair) => ({
        totalSpend: totals.totalSpend + pair.totalSpend,
        totalClicks: totals.totalClicks + pair.totalClicks,
        totalCommission: totals.totalCommission + pair.totalCommission,
        totalBenefit: totals.totalBenefit + pair.totalBenefit,
      }),
      { totalSpend: 0, totalClicks: 0, totalCommission: 0, totalBenefit: 0 }
    );

    // Calculate grand totals including all existing data
    let grandTotals = { ...overallTotals };
    let grandTotalRowExists = false;
    let grandTotalRowIndex = -1;

    if (existingData.length > 1) {
      // Check if grand total row already exists and find existing totals
      for (let i = 1; i < existingData.length; i++) {
        const row = existingData[i];
        if (row[1] === "TỔNG TẤT CẢ") {
          grandTotalRowExists = true;
          grandTotalRowIndex = i;
          // Don't include the existing grand total in calculations to avoid double counting
          continue;
        }
        if (row[1] === "TỔNG" && row[0]) {
          grandTotals.totalSpend += fnumber(row[2]);
          grandTotals.totalClicks += fnumber(row[3]);
          grandTotals.totalCommission += fnumber(row[4]);
          grandTotals.totalBenefit += fnumber(row[5]);
          // console.log(
          //   `Including existing totals from row ${i + 1} in grand totals`,
          //   row
          // );
        }
      }
    }

    // Calculate profit for totals (commission * exchange_rate - spend)
    const overallProfit =
      overallTotals.totalBenefit * exchangeRate - overallTotals.totalSpend;
    const grandProfit =
      grandTotals.totalBenefit * exchangeRate - grandTotals.totalSpend;

    // Prepare data structure
    const dataToWrite = [];

    // If this is the first time writing, add headers
    if (existingData.length === 0) {
      // Row 1: Headers
      dataToWrite.push([
        "Ngày",
        "Tên Sheet",
        "Số tiền chạy (VNĐ)",
        "Tổng Click",
        "Tổng CĐ",
        "Tổng hoa hồng ($)",
        `Lợi nhuận (VNĐ) - Tỷ giá: ${exchangeRate} VNĐ`,
      ]);
    }

    // Find the next row to write
    let nextRow = existingData.length;

    // Check if this date already exists and find where to insert
    const existingDates = existingData
      .slice(1)
      .map((row) => row[0])
      .filter(Boolean);
    const dateExists = existingDates.includes(targetDate);

    if (dateExists) {
      console.log(
        `Date ${targetDate} already exists in summary report, will append new data`
      );
      // Just append to the end for now - in a production system you might want to update in place
    }

    // Handle grand total row - update existing or create new
    if (grandTotalRowExists) {
      console.log(
        `Updating existing grand total row at index ${grandTotalRowIndex}`
      );
      // Update the existing grand total row
      const grandTotalUpdateRange = `${sheetName}!A${grandTotalRowIndex + 1}:G${grandTotalRowIndex + 1
        }`;
      const grandTotalUpdateData = [
        [
          "",
          "TỔNG TẤT CẢ",
          grandTotals.totalSpend,
          grandTotals.totalClicks,
          grandTotals.totalCommission,
          grandTotals.totalBenefit,
          grandProfit,
        ],
      ];

      await googleSheetsService.writeSheetValues(
        spreadsheetId,
        grandTotalUpdateRange,
        grandTotalUpdateData
      );

      console.log(`Updated grand total row: ${grandTotalUpdateRange}`);
    } else {
      // Add grand total row at the top (for all days combined) - only if it doesn't exist
      dataToWrite.push([
        "",
        "TỔNG TẤT CẢ",
        grandTotals.totalSpend,
        grandTotals.totalClicks,
        grandTotals.totalCommission,
        grandTotals.totalBenefit,
        grandProfit,
      ]);
    }

    // Track the first row where we add date data for later creating row groupings
    const dateRowStart = dataToWrite.length + nextRow;

    // Row for date with overall totals
    dataToWrite.push([
      targetDate,
      "TỔNG",
      overallTotals.totalSpend,
      overallTotals.totalClicks,
      overallTotals.totalCommission,
      overallTotals.totalBenefit,
      overallProfit,
    ]);

    // Rows for each pair
    summaryData.forEach((pair, index) => {
      const pairProfit = pair.totalBenefit * exchangeRate - pair.totalSpend;
      dataToWrite.push([
        "", // Empty date for sub-rows
        pair.sheetName || `Sheet ${index + 1}`,
        pair.totalSpend,
        pair.totalClicks,
        pair.totalCommission,
        pair.totalBenefit,
        pairProfit,
      ]);
    });

    // Calculate the range to write
    const startRow = existingData.length === 0 ? 1 : nextRow + 1;
    const endRow = startRow + dataToWrite.length - 1;
    const range = `${sheetName}!A${startRow}:G${endRow}`;

    console.log(`Writing summary data to range: ${range}`);
    await googleSheetsService.writeSheetValues(
      spreadsheetId,
      range,
      dataToWrite
    );

    const headerFormat = {
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
      textFormat: {
        bold: true,
        fontSize: 12,
      },
      backgroundColor: {
        red: 223 / 255,
        green: 228 / 255,
        blue: 236 / 255,
      },
      borders: {
        top: {
          style: "SOLID",
          width: 1,
          color: { red: 0, green: 0, blue: 0 },
        },
        bottom: {
          style: "SOLID",
          width: 1,
          color: { red: 0, green: 0, blue: 0 },
        },
        left: {
          style: "SOLID",
          width: 1,
          color: { red: 0, green: 0, blue: 0 },
        },
        right: {
          style: "SOLID",
          width: 1,
          color: { red: 0, green: 0, blue: 0 },
        },
      },
      numberFormat: {
        type: "NUMBER",
        pattern: "#,##0",
      },
    };

    const totalFormat = {
      ...headerFormat,
      textFormat: {
        bold: true,
        fontSize: 10,
      },
      numberFormat: {
        type: "NUMBER",
        pattern: "#,##0",
      },
    };

    const borderFormat = {
      borders: {
        top: {
          style: "SOLID",
          width: 1,
          color: { red: 0, green: 0, blue: 0 },
        },
        bottom: {
          style: "SOLID",
          width: 1,
          color: { red: 0, green: 0, blue: 0 },
        },
        left: {
          style: "SOLID",
          width: 1,
          color: { red: 0, green: 0, blue: 0 },
        },
        right: {
          style: "SOLID",
          width: 1,
          color: { red: 0, green: 0, blue: 0 },
        },
      },
      numberFormat: {
        type: "NUMBER",
        pattern: "#,##0",
      },
    };

    // Apply formatting
    try {
      // Format headers if this is the first write
      if (existingData.length === 0) {
        await googleSheetsService.formatCells(
          spreadsheetId,
          gid || 0,
          0, // Header row
          1, // End at header row (exclusive)
          0, // Start column A
          7, // End column G (exclusive)
          headerFormat
        );

        await googleSheetsService.formatCells(
          spreadsheetId,
          gid || 0,
          1, // Header row
          2, // End at header row (exclusive)
          0, // Start column A
          7, // End column G (exclusive)
          totalFormat
        );
      }

      // Apply borders to pair data rows (after the total rows)
      const pairRowsStartIndex = existingData.length === 0 ? 2 : startRow - 1; // Start from pair rows (after total row)
      const pairRowsEndIndex = pairRowsStartIndex + summaryData.length + 1;

      if (summaryData.length > 0) {
        console.log(
          `Applying borders to pair rows from index ${pairRowsStartIndex} to ${pairRowsEndIndex}`
        );

        await googleSheetsService.formatCells(
          spreadsheetId,
          gid || 0,
          pairRowsStartIndex, // Start from pair rows (after total row)
          pairRowsEndIndex, // End at last pair row (exclusive, so we get all rows)
          0, // Start column A
          7, // End column G (exclusive)
          borderFormat
        );
      }

      // Create row grouping for the current date section
      if (summaryData.length > 0) {
        try {
          // Get the index of the date total row and the last detail row for this date
          const dateRowIndex = dateRowStart;
          const lastDetailRowIndex = dateRowStart + summaryData.length;

          // Only add row grouping if we have detail rows
          if (lastDetailRowIndex > dateRowIndex) {
            // Add row grouping
            await googleSheetsService.addRowGrouping(
              spreadsheetId,
              gid || 0,
              dateRowIndex, // The date total row (parent row)
              dateRowIndex + 1, // First detail row
              lastDetailRowIndex + 1 // Last detail row
            );

            console.log(
              `Created row grouping for date ${targetDate} from rows ${dateRowIndex + 1
              } to ${lastDetailRowIndex}`
            );
          }
        } catch (groupingError) {
          console.warn(
            `Warning: Could not create row grouping: ${groupingError.message}`
          );
        }
      }

      // Auto-fit columns
      await googleSheetsService.autoFitColumns(
        spreadsheetId,
        gid || 0,
        0, // Start from column A
        7 // End at column G
      );

      console.log("Successfully applied formatting to summary report");
    } catch (formatError) {
      console.warn(
        `Warning: Could not format summary report: ${formatError.message}`
      );
    }

    console.log("Successfully wrote summary report data");
    return {
      success: true,
      date: targetDate,
      totalPairs: summaryData.length,
      overallTotals,
    };
  } catch (error) {
    console.error("Error writing summary report:", error);
    throw new Error(`Failed to write summary report: ${error.message}`);
  }
}

module.exports = router;
module.exports.writeReportToSheet = writeReportToSheet;
module.exports.processDataByStore = processDataByStore;
module.exports.writeSummaryReport = writeSummaryReport;
