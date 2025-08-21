class AutoStoreCreator {
    constructor() {
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadStatus();
        this.startStatusPolling();
    }

    bindEvents() {
        // Configuration form
        document.getElementById('config-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveConfiguration();
        });

        // Action buttons
        document.getElementById('test-connection').addEventListener('click', () => {
            this.testConnection();
        });

        document.getElementById('refresh-status').addEventListener('click', () => {
            this.loadStatus();
        });

        // New action buttons
        document.getElementById('create-stores-now').addEventListener('click', () => {
            this.createStoresNow();
        });

        document.getElementById('view-stores').addEventListener('click', () => {
            this.viewStores();
        });
    }

    async saveConfiguration() {
        const storeSheetsUrl = document.getElementById('store-sheets-url').value.trim();
        const storeDetailSheetsUrl = document.getElementById('storedetail-sheets-url').value.trim();

        if (!storeSheetsUrl || !storeDetailSheetsUrl) {
            this.showMessage('Please enter both Google Sheets URLs', 'error');
            return;
        }

        if (!this.isValidGoogleSheetsUrl(storeSheetsUrl) || !this.isValidGoogleSheetsUrl(storeDetailSheetsUrl)) {
            this.showMessage('Please enter valid Google Sheets URLs', 'error');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch('/api/configure', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    storeSheetsUrl,
                    storeDetailSheetsUrl
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showMessage('Configuration saved successfully!', 'success');
                this.addLogEntry('Configuration updated', 'success');
                this.loadStatus();

                // Show preview if data was fetched
                if (result.rowCount > 0) {
                    this.testConnection();
                }
            } else {
                this.showMessage(result.error || 'Failed to save configuration', 'error');
            }
        } catch (error) {
            console.error('Configuration error:', error);
            this.showMessage('Failed to save configuration. Please try again.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async testConnection() {
        this.showLoading(true);

        try {
            const response = await fetch('/api/test-connection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();

            if (response.ok) {
                const message = `Connection successful! Found ${result.totalRows} total rows (${result.storeWithCouponsRows} store+coupon rows, ${result.storeInfoRows} store info). Processed ${result.processedStores} unique stores with ${result.totalCoupons} coupons.`;
                this.showMessage(message, 'success');
                this.addLogEntry(`Connection test successful - ${result.processedStores} stores with ${result.totalCoupons} coupons processed from ${result.totalRows} rows`, 'success');
            } else {
                this.showMessage(result.error || 'Connection test failed', 'error');
                this.addLogEntry('Connection test failed', 'error');
            }
        } catch (error) {
            console.error('Connection test error:', error);
            this.showMessage('Connection test failed. Please check your configuration.', 'error');
            this.addLogEntry('Connection test failed', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async createStoresNow() {
        // Confirm action with user
        if (!confirm('This will create all stores from your Google Sheets data right now. Continue?')) {
            return;
        }

        this.showLoading(true);
        this.showMessage('Creating stores... This may take a few minutes.', 'info');

        try {
            const response = await fetch('/api/create-stores-now', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();

            if (response.ok) {
                const { results } = result;
                let message = `Process completed! Created ${results.storesCreated} stores`;

                if (results.storesSkipped > 0) {
                    message += `, skipped ${results.storesSkipped} duplicates`;
                }

                if (results.errors && results.errors.length > 0) {
                    message += `, ${results.errors.length} errors occurred`;
                }

                this.showMessage(message, 'success');
                this.addLogEntry(`Manual creation: ${results.storesCreated} created, ${results.storesSkipped} skipped`, 'success');

                // Show detailed results
                this.showCreateResults(results);

                // Refresh status
                this.loadStatus();
            } else {
                this.showMessage(result.error || 'Failed to create stores', 'error');
                this.addLogEntry('Manual store creation failed', 'error');
            }
        } catch (error) {
            console.error('Create stores error:', error);
            this.showMessage('Failed to create stores. Please try again.', 'error');
            this.addLogEntry('Manual store creation failed', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async loadStatus() {
        try {
            const response = await fetch('/api/status');
            const status = await response.json();

            // Update status display
            document.getElementById('config-status').textContent =
                status.configured ? 'Configured ✓' : 'Not configured';

            document.getElementById('last-run').textContent =
                status.lastRun ? this.formatDateTime(status.lastRun.timestamp) : 'Never';

            document.getElementById('polling-interval').textContent =
                `${status.pollingInterval} minutes`;

            // Load and populate configuration form if configured
            if (status.configured && status.sheetId) {
                await this.loadConfiguration();
                this.addLogEntry('Status loaded successfully', 'success');
            }

            // Enable/disable test button based on configuration
            document.getElementById('test-connection').disabled = !status.configured;

        } catch (error) {
            console.error('Status loading error:', error);
            this.addLogEntry('Failed to load status', 'error');
        }
    }

    async loadConfiguration() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                const config = await response.json();

                // Populate the form with existing configuration
                const storeSheetsUrlInput = document.getElementById('store-sheets-url');
                const storeDetailSheetsUrlInput = document.getElementById('storedetail-sheets-url');

                if (config.storeSheetsUrl && config.storeSheetsUrl !== 'Not set') {
                    storeSheetsUrlInput.value = config.storeSheetsUrl;
                    storeSheetsUrlInput.style.borderColor = '#28a745';
                    storeSheetsUrlInput.style.backgroundColor = '#f8fff9';
                    storeSheetsUrlInput.placeholder = '✓ Auto-filled from saved configuration';
                }

                if (config.storeDetailSheetsUrl && config.storeDetailSheetsUrl !== 'Not set') {
                    storeDetailSheetsUrlInput.value = config.storeDetailSheetsUrl;
                    storeDetailSheetsUrlInput.style.borderColor = '#28a745';
                    storeDetailSheetsUrlInput.style.backgroundColor = '#f8fff9';
                    storeDetailSheetsUrlInput.placeholder = '✓ Auto-filled from saved configuration';
                }

                if ((config.storeSheetsUrl && config.storeSheetsUrl !== 'Not set') ||
                    (config.storeDetailSheetsUrl && config.storeDetailSheetsUrl !== 'Not set')) {
                    // Show success message
                    this.addLogEntry('Configuration auto-filled from saved data', 'success');
                    console.log('Auto-filled Google Sheets URL from existing configuration');

                    // Reset visual styling after a few seconds
                    setTimeout(() => {
                        sheetsUrlInput.style.borderColor = '';
                        sheetsUrlInput.style.backgroundColor = '';
                        if (!sheetsUrlInput.value) {
                            sheetsUrlInput.placeholder = originalPlaceholder;
                        }
                    }, 3000);
                }
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
        }
    }

    async viewStores() {
        this.showLoading(true);

        try {
            // Get recent stores
            const storesResponse = await fetch('/api/stores?limit=20');
            const storesResult = await storesResponse.json();
            if (storesResponse.ok) {
                this.addLogEntry(`Viewed stores: ${storesResult.totalCount} total, showing recent ${storesResult.stores.length}`, 'success');
                this.showStoreList(storesResult.stores, storesResult.count);
            } else {
                this.showMessage(storesResult.error || 'Failed to fetch stores', 'error');
                this.addLogEntry('Failed to fetch stores', 'error');
            }
        } catch (error) {
            console.error('View stores error:', error);
            this.showMessage('Failed to fetch stores. Please check your WordPress connection.', 'error');
            this.addLogEntry('Failed to fetch stores', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    showStoreList(stores, totalCount) {
        const storesSection = document.getElementById('stores-section');
        const storesContainer = document.getElementById('stores-container');

        const html = `
            <div class="store-list">
                <h3>WordPress Stores (${totalCount} total, showing recent ${stores.length})</h3>
                <table class="preview-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Title</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stores.map(store => `
                            <tr>
                                <td>${store.id}</td>
                                <td>${store.title}</td>
                                <td><span class="status-badge ${store.status}">${store.status}</span></td>
                                <td>${new Date(store.date).toLocaleDateString()}</td>
                                <td>
                                    <a href="${store.link}" target="_blank" class="btn-link">
                                        <i class="fas fa-external-link-alt"></i> View
                                    </a>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        storesContainer.innerHTML = html;
        storesSection.style.display = 'block';
    }

    showCreateResults(results) {
        const storesSection = document.getElementById('stores-section');
        const storesContainer = document.getElementById('stores-container');

        const html = `
            <div class="create-results">
                <h3>Store Creation Results</h3>
                <div class="stats-grid">
                    <div class="stat-item success">
                        <strong>Stores Created:</strong> ${results.storesCreated}
                    </div>
                    <div class="stat-item success">
                        <strong>Coupons Created:</strong> ${results.couponsCreated || 0}
                    </div>
                    <div class="stat-item warning">
                        <strong>Duplicates Skipped:</strong> ${results.storesSkipped}
                    </div>
                    <div class="stat-item">
                        <strong>Total from Sheets:</strong> ${results.totalFromSheet}
                    </div>
                    <div class="stat-item">
                        <strong>Existing in WordPress:</strong> ${results.existingInWordPress}
                    </div>
                    <div class="stat-item">
                        <strong>Store+Coupon Rows:</strong> ${results.storeWithCouponsRows || 0}
                    </div>
                </div>
                ${results.errors && results.errors.length > 0 ? `
                    <div class="errors-section">
                        <h4>Errors (${results.errors.length}):</h4>
                        <div class="error-list">
                            ${results.errors.map(error => `
                                <div class="error-item">
                                    <strong>${error.storeName}${error.couponName ? ` - ${error.couponName}` : ''}:</strong> ${error.error}
                                    <span class="error-type">[${error.type || 'store'}]</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                <div class="success-message">
                    <i class="fas fa-check-circle"></i>
                    Store creation process completed successfully!
                    ${results.couponsCreated > 0 ? `<br><small>Created ${results.couponsCreated} coupons across all stores</small>` : ''}
                </div>
            </div>
        `;

        storesContainer.innerHTML = html;
        storesSection.style.display = 'block';
    }

    startStatusPolling() {
        // Reload status every 30 seconds
        setInterval(() => {
            this.loadStatus();
        }, 30000);
    }

    isValidGoogleSheetsUrl(url) {
        const pattern = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/;
        return pattern.test(url);
    }

    showMessage(message, type = 'success') {
        // Remove existing messages
        const existingMessages = document.querySelectorAll('.message');
        existingMessages.forEach(msg => msg.remove());

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;

        document.getElementById('message-container').appendChild(messageDiv);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            messageDiv.remove();
        }, 5000);
    }

    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        overlay.style.display = show ? 'flex' : 'none';
    }

    addLogEntry(message, type = 'info') {
        const logsContainer = document.getElementById('logs-container');
        const noLogs = logsContainer.querySelector('.no-logs');

        if (noLogs) {
            noLogs.remove();
        }

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;

        const timeDiv = document.createElement('div');
        timeDiv.className = 'log-entry-time';
        timeDiv.textContent = this.formatDateTime(new Date().toISOString());

        const messageDiv = document.createElement('div');
        messageDiv.className = 'log-entry-message';
        messageDiv.textContent = message;

        logEntry.appendChild(timeDiv);
        logEntry.appendChild(messageDiv);

        // Insert at the top
        logsContainer.insertBefore(logEntry, logsContainer.firstChild);

        // Keep only last 10 entries
        const entries = logsContainer.querySelectorAll('.log-entry');
        if (entries.length > 10) {
            entries[entries.length - 1].remove();
        }
    }

    formatDateTime(isoString) {
        if (!isoString) return 'Never';

        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;

        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    // Utility method to extract sheet ID from URL (client-side validation)
    extractSheetId(url) {
        const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : null;
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AutoStoreCreator();
});

// Add some global error handling
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});
