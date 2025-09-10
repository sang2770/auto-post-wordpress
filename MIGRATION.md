# Migration Guide: Multiple URL Pairs Support

This document explains how to migrate from the single URL pair version to the new version that supports multiple URL pairs for report generation.

## Changes in This Update

1. The application now supports multiple pairs of data and report URLs
2. Each pair consists of a source data URL and a destination report URL
3. When generating reports, all URL pairs will be processed sequentially

## Migration Process

When you upgrade to the new version, you need to run a migration script to convert your existing configuration to the new format:

```bash
npm run migrate
```

This script will:
1. Read your existing configuration from `data/config.json`
2. Convert the single pair of `dataUrl` and `reportUrl` to an array of URL pairs
3. Save the updated configuration back to the same file

## Configuration Format Changes

### Old Format (Before):
```json
{
  "dataUrl": "https://docs.google.com/spreadsheets/d/abc123/edit",
  "reportUrl": "https://docs.google.com/spreadsheets/d/xyz789/edit",
  "dataSheetId": "abc123",
  "reportSheetId": "xyz789",
  "reportConfiguredAt": "2025-08-29T02:40:09.480Z",
  "lastUpdated": "2025-08-29T02:40:09.480Z"
}
```

### New Format (After):
```json
{
  "urlPairs": [
    {
      "dataUrl": "https://docs.google.com/spreadsheets/d/abc123/edit",
      "reportUrl": "https://docs.google.com/spreadsheets/d/xyz789/edit",
      "dataSheetId": "abc123",
      "reportSheetId": "xyz789"
    }
  ],
  "dataUrl": "https://docs.google.com/spreadsheets/d/abc123/edit",
  "reportUrl": "https://docs.google.com/spreadsheets/d/xyz789/edit",
  "dataSheetId": "abc123",
  "reportSheetId": "xyz789",
  "reportConfiguredAt": "2025-08-29T02:40:09.480Z",
  "lastUpdated": "2025-08-29T02:40:09.480Z",
  "lastMigrated": "2025-09-10T10:00:00.000Z"
}
```

Note that the old fields are kept for backward compatibility, but the application will now primarily use the `urlPairs` array.

## Using the New Multiple URL Pairs Feature

After migration, you can add, edit, or remove URL pairs through the web interface:

1. Go to the Reports tab in the web interface
2. You'll see your existing URL pair already configured
3. Use the "Add URL Pair" button to add additional pairs
4. Each pair can have different source data and destination report URLs
5. Save your configuration before generating reports

## Troubleshooting

If you encounter issues after migration:

1. Check the browser console for error messages
2. Verify your `data/config.json` file has the correct format
3. If needed, manually add the `urlPairs` array to your configuration file
4. Restart the application after fixing any configuration issues

For further assistance, please open an issue on the GitHub repository.
