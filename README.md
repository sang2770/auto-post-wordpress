# WordPress Store Auto-Creator

This application automatically creates stores on your WordPress website using data from Google Sheets.

## Features

- Web interface for configuring Google Sheets data source
- **No API key required** - uses Google Sheets "Publish to web" functionality
- Automatic polling every 5 minutes for changes
- WordPress API integration
- Support for store fields: links, name, guide, about, Q&A
- **NEW: Support for multiple data and report URL pairs**

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with your configuration:

```
WORDPRESS_URL=https://coponeer.com
WORDPRESS_USERNAME=your_username
WORDPRESS_PASSWORD=your_password
PORT=3000
```

3. **Setup your Google Sheet** (No API key needed!):

   - Open your Google Sheet
   - Go to File → Share → Publish to web
   - Choose "Entire Document" and "CSV"
   - Check "Automatically republish when changes are made"
   - Click "Publish"
   - Make sure sharing is set to "Anyone with the link can view"

## Upgrading from Previous Version

If you're upgrading from a version that only supported a single pair of data and report URLs:

1. Run the migration script to update your configuration:

```bash
npm run migrate
```

2. After migration, you can add multiple URL pairs through the web interface.

## Report Generation

The application now supports generating reports from multiple data sources:

1. Configure multiple pairs of data and report URLs in the Reports tab
2. Each pair consists of a source data URL and a destination report URL
3. When generating reports, data will be processed for each URL pair

4. Run the application:

```bash
npm start
```

5. Open your browser and go to `http://localhost:3000`

## Usage

1. Paste your Google Sheets URL in the web interface
2. The application will automatically check for changes every 5 minutes
3. New stores will be created in WordPress when data changes

## Google Sheets Format

Your Google Sheets should have the following columns:

- Column A: Store Name
- Column B: Links
- Column C: Guide
- Column D: About
- Column E: Q&A


URL get AUth: https://console.cloud.google.com/iam-admin/serviceaccounts/details/111784935198263856971;edit=true/keys?project=ggsheet-469714