const fs = require('fs').promises;
const path = require('path');

class StorageService {
    constructor() {
        this.dataDir = path.join(__dirname, '..', 'data');
        this.configFile = path.join(this.dataDir, 'config.json');
        this.lastDataFile = path.join(this.dataDir, 'lastData.json');
        this.lastRunFile = path.join(this.dataDir, 'lastRun.json');
        this.lastReportFile = path.join(this.dataDir, 'lastReport.json');

        this.ensureDataDirectory();
    }

    async ensureDataDirectory() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
        } catch (error) {
            console.error('Error creating data directory:', error);
        }
    }

    async saveConfig(config) {
        try {
            await fs.writeFile(this.configFile, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error('Error saving config:', error);
            throw error;
        }
    }

    async getConfig() {
        try {
            const data = await fs.readFile(this.configFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {}
        }
    }

    async saveLastData(data) {
        try {
            await fs.writeFile(this.lastDataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving last data:', error);
            throw error;
        }
    }

    async getLastData() {
        try {
            const data = await fs.readFile(this.lastDataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null; // File doesn't exist
            }
            console.error('Error reading last data:', error);
            throw error;
        }
    }

    async saveLastRun(runInfo) {
        try {
            await fs.writeFile(this.lastRunFile, JSON.stringify(runInfo, null, 2));
        } catch (error) {
            console.error('Error saving last run info:', error);
            throw error;
        }
    }

    async getLastRun() {
        try {
            const data = await fs.readFile(this.lastRunFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null; // File doesn't exist
            }
            console.error('Error reading last run info:', error);
            throw error;
        }
    }

    async clearAllData() {
        try {
            await Promise.all([
                fs.unlink(this.configFile).catch(() => { }),
                fs.unlink(this.lastDataFile).catch(() => { }),
                fs.unlink(this.lastRunFile).catch(() => { }),
                fs.unlink(this.lastReportFile).catch(() => { })
            ]);
        } catch (error) {
            console.error('Error clearing data:', error);
            throw error;
        }
    }

    async saveLastReport(reportData) {
        try {
            const reportInfo = {
                timestamp: new Date().toISOString(),
                data: reportData
            };
            await fs.writeFile(this.lastReportFile, JSON.stringify(reportInfo, null, 2));
        } catch (error) {
            console.error('Error saving last report:', error);
            throw error;
        }
    }

    async getLastReport() {
        try {
            const data = await fs.readFile(this.lastReportFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null; // File doesn't exist
            }
            console.error('Error reading last report:', error);
            throw error;
        }
    }

    async getStats() {
        try {
            const config = await this.getConfig();
            const lastRun = await this.getLastRun();
            const lastData = await this.getLastData();

            return {
                configured: !!config,
                lastRunTime: lastRun?.timestamp,
                totalRows: lastData?.length || 0,
                lastStoresCreated: lastRun?.storesCreated || 0
            };
        } catch (error) {
            console.error('Error getting stats:', error);
            return {
                configured: false,
                lastRunTime: null,
                totalRows: 0,
                lastStoresCreated: 0
            };
        }
    }
}

module.exports = StorageService;
