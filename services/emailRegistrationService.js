const fs = require('fs').promises;
const path = require('path');

class EmailRegistrationService {
    constructor() {
        this.registrationsFile = path.join(__dirname, '../data/emailRegistrations.json');
        this.ensureDataDir();
    }

    async ensureDataDir() {
        try {
            const dataDir = path.dirname(this.registrationsFile);
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            console.error('Error creating data directory:', error);
        }
    }

    async loadRegistrations() {
        try {
            const data = await fs.readFile(this.registrationsFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return []; // File doesn't exist, return empty array
            }
            throw error;
        }
    }

    async saveRegistrations(registrations) {
        await fs.writeFile(this.registrationsFile, JSON.stringify(registrations, null, 2));
    }

    async registerEmail(email, sourceUrl, description = '') {
        const registrations = await this.loadRegistrations();

        // Check if email already exists
        const existingIndex = registrations.findIndex(r => r.email === email);

        const registration = {
            email: email,
            sourceUrl: sourceUrl,
            description: description,
            registeredAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        if (existingIndex >= 0) {
            // Update existing registration
            registrations[existingIndex] = registration;
        } else {
            // Add new registration
            registrations.push(registration);
        }

        await this.saveRegistrations(registrations);
        return registration;
    }

    async getRegistrations() {
        return await this.loadRegistrations();
    }

    async getRegistrationByEmail(email) {
        const registrations = await this.loadRegistrations();
        return registrations.find(r => r.email === email);
    }

    async deleteRegistration(email) {
        const registrations = await this.loadRegistrations();
        const filteredRegistrations = registrations.filter(r => r.email !== email);

        if (filteredRegistrations.length === registrations.length) {
            throw new Error('Email không tìm thấy');
        }

        await this.saveRegistrations(filteredRegistrations);
    }

    async updateRegistration(email, sourceUrl, description = '') {
        const registrations = await this.loadRegistrations();
        const index = registrations.findIndex(r => r.email === email);

        if (index === -1) {
            throw new Error('Email không tìm thấy');
        }

        registrations[index].sourceUrl = sourceUrl;
        registrations[index].description = description;
        registrations[index].lastUpdated = new Date().toISOString();

        await this.saveRegistrations(registrations);
        return registrations[index];
    }

    async getSourceUrlByEmail(email) {
        const registration = await this.getRegistrationByEmail(email);
        return registration ? registration.sourceUrl : null;
    }

    async getMultipleSourceUrls(emails) {
        const registrations = await this.loadRegistrations();
        const result = {};

        emails.forEach(email => {
            const registration = registrations.find(r => r.email === email);
            if (registration) {
                result[email] = registration.sourceUrl;
            }
        });

        return result;
    }
}

module.exports = EmailRegistrationService;
