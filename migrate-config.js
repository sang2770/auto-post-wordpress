const fs = require('fs').promises;
const path = require('path');

async function migrateConfig() {
  const configPath = path.join(__dirname, 'data', 'config.json');
  
  try {
    // Read existing config
    const configData = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configData);
    
    // Check if config already has urlPairs
    if (config.urlPairs) {
      console.log('Configuration already migrated. No changes needed.');
      return;
    }
    
    // If old format with dataUrl and reportUrl exists, migrate to new format
    if (config.dataUrl && config.reportUrl) {
      const newConfig = {
        ...config,
        urlPairs: [
          {
            dataUrl: config.dataUrl,
            reportUrl: config.reportUrl,
            dataSheetId: config.dataSheetId,
            reportSheetId: config.reportSheetId,
          }
        ],
        // Keep these fields for backward compatibility
        dataUrl: config.dataUrl,
        reportUrl: config.reportUrl,
        dataSheetId: config.dataSheetId,
        reportSheetId: config.reportSheetId,
        lastMigrated: new Date().toISOString(),
      };
      
      // Save the new config
      await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));
      console.log('Configuration successfully migrated to support multiple URL pairs.');
    } else {
      console.log('No existing configuration to migrate.');
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing configuration file found.');
    } else {
      console.error('Error migrating configuration:', error);
    }
  }
}

// Run the migration
migrateConfig();
