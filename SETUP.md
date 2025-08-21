# Auto Store Creator - Complete Setup Guide

## Overview

This application automatically creates WordPress stores using data from Google Sheets. It polls the Google Sheets every 5 minutes (configurable) and creates new stores when data changes.

## Features

- ✅ Web-based configuration interface
- ✅ Google Sheets integration
- ✅ WordPress API integration
- ✅ Automatic polling every 5 minutes
- ✅ Support for store fields: links, name, guide, about, Q&A
- ✅ Real-time status monitoring
- ✅ Error handling and logging
- ✅ Docker support

## Prerequisites

1. **WordPress Site**: Your WordPress site must have:

   - REST API enabled (default in modern WordPress)
   - User account with permissions to create posts/custom post types
   - Optional: Custom post type "store" (the app will use regular posts if not available)

2. **Google Sheets API**:

   - Google Cloud Console account
   - Google Sheets API enabled
   - API key with Google Sheets API access

3. **Google Sheets Format**: Your sheet should have columns:
   - Column A: Store Name
   - Column B: Links
   - Column C: Guide
   - Column D: About
   - Column E: Q&A

## Quick Setup

### Option 1: Guided Setup

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Run guided setup**:

   ```bash
   npm run setup
   ```

3. **Test your configuration**:

   ```bash
   npm run test-setup
   ```

4. **Start the application**:

   ```bash
   npm start
   ```

5. **Open your browser**:
   ```
   http://localhost:3000
   ```

### Option 2: Manual Setup

1. **Clone and install**:

   ```bash
   cd auto-post
   npm install
   ```

2. **Copy environment file**:

   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` file** with your credentials:

   ```env
   WORDPRESS_URL=https://coponeer.com
   WORDPRESS_USERNAME=your_username
   WORDPRESS_PASSWORD=your_password
   GOOGLE_SHEETS_API_KEY=your_google_api_key
   PORT=3000
   POLLING_INTERVAL=5
   ```

4. **Start the application**:
   ```bash
   npm start
   ```

## Google Sheets API Setup

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Create a new project** or select existing one
3. **Enable Google Sheets API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"
4. **Create API Key**:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy the API key
5. **Restrict API Key** (recommended):
   - Click on your API key
   - Under "API restrictions", select "Restrict key"
   - Choose "Google Sheets API"
   - Save

## WordPress Configuration

### For WordPress.com hosted sites:

- Use Application Passwords instead of regular password
- Go to WordPress.com > Profile > Security > Application Passwords
- Create new application password for this app

### For self-hosted WordPress:

- Ensure REST API is enabled (usually default)
- Create a user account with appropriate permissions
- Consider using Application Passwords plugin for better security

## Using the Application

1. **Configure Google Sheets**:

   - Open the web interface (http://localhost:3000)
   - Paste your Google Sheets URL
   - Click "Save Configuration"

2. **Test Connection**:

   - Click "Test Connection" to verify everything works
   - Check the data preview to ensure correct formatting

3. **Monitor Status**:
   - The application automatically polls every 5 minutes
   - Check the "Status" section for last run information
   - View "Recent Activity" for logs

## Google Sheets Setup

1. **Create your Google Sheet** with the following structure:

   | Store Name    | Links               | Guide            | About           | Q&A              |
   | ------------- | ------------------- | ---------------- | --------------- | ---------------- |
   | Example Store | https://example.com | Setup guide here | About the store | Common questions |

2. **Make the sheet publicly readable**:

   - Click "Share" in your Google Sheet
   - Change to "Anyone with the link can view"
   - Copy the URL

3. **Use the provided example sheet** for testing:
   ```
   https://docs.google.com/spreadsheets/d/19kAaWAEJNhr0q4-1CmOjOL7TaqIO4oIoXEo9HL5nPsw/edit?gid=1145445809#gid=1145445809
   ```

## Docker Deployment

### Using Docker Compose (Recommended)

1. **Create `.env` file** with your configuration
2. **Run with Docker Compose**:
   ```bash
   docker-compose up -d
   ```

### Using Docker directly

1. **Build the image**:

   ```bash
   docker build -t auto-store-creator .
   ```

2. **Run the container**:
   ```bash
   docker run -d \
     --name auto-store-creator \
     -p 3000:3000 \
     --env-file .env \
     -v $(pwd)/data:/app/data \
     auto-store-creator
   ```

## Troubleshooting

### Common Issues

1. **"Invalid Google Sheets URL"**:

   - Ensure the URL is in the correct format
   - Make sure the sheet is publicly readable

2. **"WordPress API Error"**:

   - Check your WordPress credentials
   - Verify the WordPress URL is correct
   - Ensure REST API is enabled

3. **"Google Sheets API Error"**:

   - Verify your API key is correct
   - Check that Google Sheets API is enabled
   - Ensure API key has proper restrictions

4. **"No changes detected"**:
   - This is normal - it means the sheet hasn't changed
   - Modify your Google Sheet to trigger an update

### Logs and Monitoring

- **Application logs**: Check the terminal where you started the app
- **Web interface logs**: Check the "Recent Activity" section
- **File-based logs**: Check the `data/` directory for state files

### Testing

```bash
# Test your setup
npm run test-setup

# Test with sample data
curl -X POST http://localhost:3000/api/test-connection

# Check status
curl http://localhost:3000/api/status
```

## API Endpoints

- `GET /` - Web interface
- `POST /api/configure` - Save Google Sheets configuration
- `GET /api/status` - Get application status
- `POST /api/test-connection` - Test Google Sheets connection

## File Structure

```
auto-post/
├── server.js              # Main server file
├── package.json           # Dependencies and scripts
├── .env                   # Environment configuration
├── README.md              # This file
├── Dockerfile             # Docker configuration
├── docker-compose.yml     # Docker Compose setup
├── setup.js               # Guided setup script
├── test-setup.js          # Setup verification script
├── services/              # Service modules
│   ├── googleSheetsService.js
│   ├── wordpressService.js
│   └── storageService.js
├── public/                # Web interface files
│   ├── index.html
│   ├── styles.css
│   └── script.js
└── data/                  # Application data (auto-created)
    ├── config.json        # Current configuration
    ├── lastData.json      # Last fetched sheet data
    └── lastRun.json       # Last polling run info
```

## Security Considerations

1. **API Keys**: Keep your Google Sheets API key secure
2. **WordPress Credentials**: Use application passwords when possible
3. **HTTPS**: Use HTTPS in production
4. **Firewall**: Limit access to your server
5. **Regular Updates**: Keep dependencies updated

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues and questions:

1. Check this documentation
2. Review the troubleshooting section
3. Check application logs
4. Test your configuration with `npm run test-setup`

## License

MIT License - feel free to modify and distribute as needed.
