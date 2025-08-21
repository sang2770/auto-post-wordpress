# WordPress Store Auto-Creator

This application automatically creates stores on your WordPress website using data from Google Sheets.

## Features

- Web interface for configuring Google Sheets data source
- **No API key required** - uses Google Sheets "Publish to web" functionality
- Automatic polling every 5 minutes for changes
- WordPress API integration
- Support for store fields: links, name, guide, about, Q&A

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
