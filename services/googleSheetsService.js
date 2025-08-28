const axios = require("axios");
const { google } = require('googleapis');
const path = require('path');

class GoogleSheetsService {
  constructor() {
    // No API key needed anymore - using public CSV export
    this.auth = null;
    this.sheets = null;
  }

  // Initialize Google Sheets API with service account authentication
  async initAuth() {
    if (this.auth) {
      return this.auth;
    }

    try {
      const keyFilePath = path.join(__dirname, '..', 'keys', 'ggsheet-469714-97e5d118528a.json');
      
      this.auth = new google.auth.GoogleAuth({
        keyFile: keyFilePath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      
      console.log('Google Sheets API authentication initialized successfully');
      return this.auth;
    } catch (error) {
      console.error('Error initializing Google Sheets authentication:', error);
      throw new Error(`Failed to initialize Google Sheets auth: ${error.message}`);
    }
  }

  async checkAvailability(url) {
    const spreadsheet = this.getInfoSheetsFromUrl(url);
    const title = spreadsheet.properties?.title || "";

    const includesTemp = title.toLowerCase().includes("temp");

    return {
      accessible: !includesTemp,
      title: title,
      includesTemp: includesTemp,
      sheetCount: spreadsheet.sheets?.length || 0,
      sheets:
        spreadsheet.sheets?.map((sheet) => ({
          title: sheet.properties?.title || "",
          sheetId: sheet.properties?.sheetId || 0,
        })) || [],
    };
  }

  async getInfoSheetsFromUrl(url) {
    try {
      await this.initAuth();
      
      const spreadsheetId = this.extractSheetId(url);
      if (!spreadsheetId) {
        throw new Error(
          "Invalid Google Sheets URL. Please provide a valid sheet ID or URL."
        );
      }

      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
      });

      if (!response.data) {
        throw new Error("Invalid response from Google Sheets API");
      }

      const spreadsheet = response.data;
      return spreadsheet;
    } catch (error) {
      console.error(`Error checking sheet availability:`, error);

      if (error.code === 403) {
        throw new Error(`Access denied to spreadsheet. Please ensure the service account (editor@ggsheet-469714.iam.gserviceaccount.com) has viewer or editor access to the sheet.`);
      }
      if (error.code === 404) {
        throw new Error(`Spreadsheet not found. Please check the URL and ensure the sheet exists.`);
      }
      
      throw new Error(`Failed to check sheet availability: ${error.message}`);
    }
  }

  extractSheetId(url) {
    // Extract sheet ID from Google Sheets URL - handles both regular and pubhtml formats

    // First try regular format: /spreadsheets/d/SHEET_ID
    let match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
      return match[1];
    }

    // Try pubhtml format: /d/e/2PACX-SHEET_ID/pubhtml
    match = url.match(/\/d\/e\/(2PACX-[a-zA-Z0-9-_]+)\/pubhtml/);
    if (match) {
      return match[1];
    }

    return null;
  }

  // Extract GID from URL if present
  extractGid(url) {
    const match = url.match(/[#&]gid=([0-9]+)/);
    return match ? match[1] : "0";
  }

  // Convert full Google Sheets URL to CSV export URL
  getCSVUrlFromFullUrl(url) {
    const sheetId = this.extractSheetId(url);
    const gid = this.extractGid(url);

    if (!sheetId) {
      throw new Error("Invalid Google Sheets URL");
    }

    // Check if this is a pubhtml format sheet ID (starts with 2PACX-)
    if (sheetId.startsWith("2PACX-")) {
      return `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=csv&gid=${gid}`;
    } else {
      // Regular format
      return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    }
  }

  // Convert Google Sheets URL to CSV export URL
  getCSVUrl(sheetId, gid = null) {
    // Check if this is a pubhtml format sheet ID (starts with 2PACX-)
    if (sheetId.startsWith("2PACX-")) {
      return `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=csv&gid=${gid}`;
    } else {
      // Regular format
      return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    }
  }

  // Extract GID from URL if present
  extractGid(url) {
    const match = url.match(/[#&]gid=([0-9]+)/);
    return match ? match[1] : "0";
  }

  async fetchSingleSheet(sheetId, gid) {
    try {
      const csvUrl = this.getCSVUrl(sheetId, gid);
      console.log(`Fetching data from CSV URL (GID ${gid}): ${csvUrl}`);

      const response = await axios.get(csvUrl, {
        timeout: 10000,
        headers: {
          "User-Agent": "Auto-Store-Creator/1.0",
        },
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Parse CSV data
      const csvData = response.data;
      const rows = this.parseCSV(csvData);

      if (!rows || rows.length === 0) {
        return [];
      }

      // Skip header row and return data
      console.log(
        `Successfully fetched ${rows.length - 1} rows from sheet GID ${gid}`
      );
      return rows.slice(1);
    } catch (error) {
      console.error(`Error fetching sheet GID ${gid}:`, error);

      if (error.response) {
        if (error.response.status === 403) {
          throw new Error(
            `Sheet GID ${gid} is not publicly accessible. Please publish the sheet to the web and make it viewable by anyone with the link.`
          );
        } else if (error.response.status === 404) {
          throw new Error(
            `Sheet GID ${gid} not found. Please check the sheet ID and make sure the sheet is published to the web.`
          );
        }
      }

      throw new Error(`Failed to fetch sheet GID ${gid}: ${error.message}`);
    }
  }

  // Simple CSV parser
  parseCSV(csvText) {
    const rows = [];
    let row = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];

      if (char === '"') {
        if (inQuotes && csvText[i + 1] === '"') {
          // Escaped quote ""
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        // Kết thúc field
        row.push(current);
        current = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (current !== "" || row.length > 0) {
          row.push(current);
          rows.push(row);
          row = [];
          current = "";
        }
        // Nếu là \r\n thì bỏ qua \n
        if (char === "\r" && csvText[i + 1] === "\n") {
          i++;
        }
      } else {
        current += char;
      }
    }

    // Thêm field cuối cùng
    if (current !== "" || row.length > 0) {
      row.push(current);
      rows.push(row);
    }

    return rows;
  }

  processSheetData(combinedData) {
    const stores = [];
    const { storeListWithCoupons, storeInfo } = combinedData;

    // Create a map of store info by name for quick lookup
    const storeInfoMap = new Map();
    storeInfo.forEach((row, index) => {
      if (index < 4) {
        return; // Skip first 5 rows (assumed to be headers or irrelevant)
      }
      if (row[2]) {
        // Check if name exists
        const name = row[2]?.trim()?.toLowerCase();
        storeInfoMap.set(name, {
          name: row[2]?.trim() || "",
          description: row[3] || "",
          about: row[8] || "",
          guide: row[7] || "",
          qa: (row[11] || "") + (row[15] || ""),
        });
      }
    });

    // Process sheet1 data to extract stores and their coupons
    // Expected columns: store_name, coupon_name, coupon_code, discount_bag, coupon_description
    const storeMap = new Map();
    const couponMap = new Map();

    storeListWithCoupons.forEach((row, i) => {
      if (i < 1) {
        return;
      }
      if (row[2] && row[2].trim()) {
        // Check if store name exists
        const storeName = row[2].trim();
        const normalizedStoreName = storeName.toLowerCase();
        const couponName = row[7] || "";
        const couponCode = row[5] || "";
        const discountBag = row[6] || "";
        const couponDescription = row[10] || "";
        const storeLink = row[4] || "";
        const storeImage = row[1] || ""; // Add store image from column 3 (index 2)

        // Add store to unique store list
        if (!storeMap.has(normalizedStoreName)) {
          storeMap.set(normalizedStoreName, {
            name: storeName,
            link: storeLink,
            image: storeImage,
          });
        }

        // Add coupon for this store if coupon data exists
        if (couponName.trim()) {
          // Determine if it's a deal (no code needed)
          const isDeal =
            !couponCode ||
            couponCode.toLowerCase().includes("no code needed") ||
            couponCode.toLowerCase().includes("no need code");

          const coupon = {
            coupon_name: couponName,
            coupon_code: isDeal ? "" : couponCode,
            discount_value: discountBag, // Using discount_bag as discount_value
            store_link: "", // Will be set later when we know the store post ID
            is_deal: isDeal,
            link: storeLink, // Default empty, can be updated later
            discount_bag: discountBag,
            is_verified: true, // Default to verified
            description: couponDescription,
            priority: i, // Add priority based on row index (earlier rows = lower numbers = higher priority)
          };

          // Initialize coupon array for store if it doesn't exist
          if (!couponMap.has(normalizedStoreName)) {
            couponMap.set(normalizedStoreName, []);
          }
          // Check for duplicate coupons within the same store
          couponMap.get(normalizedStoreName).push(coupon);
        }
      }
    });

    // Create final store objects with all data
    storeMap.forEach((storeData, normalizedName) => {
      // Get store info from sheet2
      const info = storeInfoMap.get(normalizedName) || {
        name: storeData.name,
        description: "",
        about: "",
        guide: "",
        qa: "",
        image: "",
      };

      // Get coupons for this store and sort by priority
      const coupons = couponMap.get(normalizedName) || [];
      coupons.sort((a, b) => a.priority - b.priority); // Sort by priority (lower number = higher priority)

      const store = {
        name: storeData.name,
        links: info.links || "", // Use from store info if available
        guide: info.guide,
        about: info.about,
        qa: info.qa,
        description: info.description,
        image: storeData.image || info.image, // Prefer image from storeListWithCoupons, fallback to storeInfo
        coupons: coupons,
      };

      stores.push(store);
    });

    console.log(
      `Processed ${stores.length} unique stores from ${storeListWithCoupons.length} rows with ${storeInfo.length} store info entries`
    );

    const totalCoupons = stores.reduce(
      (sum, store) => sum + store.coupons.length,
      0
    );
    console.log(`Total coupons found: ${totalCoupons}`);

    return stores;
  }

  async fetchSheetDataFromSeparateUrls(storeSheetUrl, storeDetailSheetUrl) {
    try {
      // Fetch data from separate sheets using their full URLs (including GIDs)
      const storeData = await this.fetchSingleSheetFromUrl(storeSheetUrl); // Store List with Coupons from first URL
      const storeDetailData = await this.fetchSingleSheetFromUrl(
        storeDetailSheetUrl
      ); // Store Info from second URL

      // Combine and return the data
      return {
        storeListWithCoupons: storeData, // Contains store and coupon data
        storeInfo: storeDetailData, // Contains store details
        totalRows: storeData.length + storeDetailData.length,
      };
    } catch (error) {
      console.error("Error fetching sheet data from separate URLs:", error);
      throw new Error(
        `Failed to fetch sheet data from separate URLs: ${error.message}`
      );
    }
  }

  async fetchSingleSheetFromUrl(url) {
    try {
      const csvUrl = this.getCSVUrlFromFullUrl(url);
      console.log(`Fetching data from CSV URL: ${csvUrl}`);

      const response = await axios.get(csvUrl, {
        timeout: 10000,
        headers: {
          "User-Agent": "Auto-Store-Creator/1.0",
        },
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Parse CSV data
      const csvData = response.data;

      const rows = this.parseCSV(csvData);

      console.log(`Successfully fetched ${rows.length} rows from URL`);
      return rows;
    } catch (error) {
      console.error(`Error fetching sheet from URL: ${url}`, error);
      throw new Error(`Failed to fetch data from URL: ${error.message}`);
    }
  }

  // Fetch report data from a Google Sheets URL
  async fetchReportData(url) {
    try {
      const csvUrl = this.getCSVUrlFromFullUrl(url);
      console.log(`Fetching report data from CSV URL: ${csvUrl}`);

      const response = await axios.get(csvUrl, {
        timeout: 15000,
        headers: {
          "User-Agent": "Auto-Store-Creator/1.0",
        },
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Parse CSV data
      const csvData = response.data;
      const rows = this.parseCSV(csvData);

      console.log(`Successfully fetched ${rows.length} rows of report data`);
      return rows;
    } catch (error) {
      console.error(`Error fetching report data from URL: ${url}`, error);
      throw new Error(`Failed to fetch report data: ${error.message}`);
    }
  }

  // Read existing data from a sheet to determine where to insert new columns
  async readSheetValues(spreadsheetId, range) {
    try {
      await this.initAuth();
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      return response.data.values || [];
    } catch (error) {
      console.error("Error reading sheet values:", error);
      if (error.code === 403) {
        throw new Error(`Access denied to spreadsheet. Please ensure the service account has editor access to the sheet.`);
      }
      throw new Error(`Failed to read sheet values: ${error.message}`);
    }
  }

  // Write data to a specific range in Google Sheets
  async writeSheetValues(spreadsheetId, range, values) {
    try {
      await this.initAuth();
      
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: values,
        },
      });

      console.log(`Successfully wrote ${values.length} rows to range ${range}`);
      return response.data;
    } catch (error) {
      console.error("Error writing sheet values:", error);
      if (error.code === 403) {
        throw new Error(`Access denied to spreadsheet. Please ensure the service account (editor@ggsheet-469714.iam.gserviceaccount.com) has editor access to the sheet.`);
      }
      if (error.code === 400) {
        throw new Error(`Invalid range or data format: ${error.message}`);
      }
      throw new Error(`Failed to write sheet values: ${error.message}`);
    }
  }

  // Append data to a sheet (insert new columns to the right)
  async appendSheetValues(spreadsheetId, range, values) {
    try {
      await this.initAuth();
      
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: values,
        },
      });

      console.log(`Successfully appended ${values.length} rows to range ${range}`);
      return response.data;
    } catch (error) {
      console.error("Error appending sheet values:", error);
      if (error.code === 403) {
        throw new Error(`Access denied to spreadsheet. Please ensure the service account (editor@ggsheet-469714.iam.gserviceaccount.com) has editor access to the sheet.`);
      }
      if (error.code === 400) {
        throw new Error(`Invalid range or data format: ${error.message}`);
      }
      throw new Error(`Failed to append sheet values: ${error.message}`);
    }
  }

  // Merge cells in a specific range
  async mergeCells(spreadsheetId, sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex, mergeType = 'MERGE_ALL') {
    try {
      await this.initAuth();
      
      const request = {
        spreadsheetId,
        requestBody: {
          requests: [
            {
              mergeCells: {
                range: {
                  sheetId: parseInt(sheetId),
                  startRowIndex: startRowIndex,
                  endRowIndex: endRowIndex,
                  startColumnIndex: startColumnIndex,
                  endColumnIndex: endColumnIndex,
                },
                mergeType: mergeType, // MERGE_ALL, MERGE_COLUMNS, or MERGE_ROWS
              },
            },
          ],
        },
      };

      const response = await this.sheets.spreadsheets.batchUpdate(request);
      console.log(`Successfully merged cells from row ${startRowIndex} to ${endRowIndex - 1}, column ${startColumnIndex} to ${endColumnIndex - 1}`);
      return response.data;
    } catch (error) {
      console.error("Error merging cells:", error);
      if (error.code === 403) {
        throw new Error(`Access denied to spreadsheet. Please ensure the service account has editor access to the sheet.`);
      }
      if (error.code === 400) {
        throw new Error(`Invalid merge request: ${error.message}`);
      }
      throw new Error(`Failed to merge cells: ${error.message}`);
    }
  }

  // Format cells (apply styling like center alignment, bold, etc.)
  async formatCells(spreadsheetId, sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex, format) {
    try {
      await this.initAuth();
      
      const request = {
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: parseInt(sheetId),
                  startRowIndex: startRowIndex,
                  endRowIndex: endRowIndex,
                  startColumnIndex: startColumnIndex,
                  endColumnIndex: endColumnIndex,
                },
                cell: {
                  userEnteredFormat: format,
                },
                fields: 'userEnteredFormat',
              },
            },
          ],
        },
      };

      const response = await this.sheets.spreadsheets.batchUpdate(request);
      console.log(`Successfully formatted cells from row ${startRowIndex} to ${endRowIndex - 1}, column ${startColumnIndex} to ${endColumnIndex - 1}`);
      return response.data;
    } catch (error) {
      console.error("Error formatting cells:", error);
      if (error.code === 403) {
        throw new Error(`Access denied to spreadsheet. Please ensure the service account has editor access to the sheet.`);
      }
      if (error.code === 400) {
        throw new Error(`Invalid format request: ${error.message}`);
      }
      throw new Error(`Failed to format cells: ${error.message}`);
    }
  }
}

module.exports = GoogleSheetsService;
