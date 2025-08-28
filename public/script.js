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

        document.getElementById('export-excel').addEventListener('click', () => {
            this.exportExcel();
        });
    }

    async saveConfiguration() {
        const storeSheetsUrl = document.getElementById('store-sheets-url').value.trim();
        const storeDetailSheetsUrl = document.getElementById('storedetail-sheets-url').value.trim();

        if (!storeSheetsUrl || !storeDetailSheetsUrl) {
            this.showMessage('Vui lòng nhập cả hai URL Google Sheets', 'error');
            return;
        }

        if (!this.isValidGoogleSheetsUrl(storeSheetsUrl) || !this.isValidGoogleSheetsUrl(storeDetailSheetsUrl)) {
            this.showMessage('Vui lòng nhập URL Google Sheets hợp lệ', 'error');
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
                this.showMessage('Cấu hình đã được lưu thành công!', 'success');
                this.addLogEntry('Cập nhật cấu hình', 'success');
                this.loadStatus();

                // Show preview if data was fetched
                if (result.rowCount > 0) {
                    this.testConnection();
                }
            } else {
                this.showMessage(result.error || 'Không thể lưu cấu hình', 'error');
            }
        } catch (error) {
            console.error('Configuration error:', error);
            this.showMessage('Không thể lưu cấu hình. Vui lòng thử lại.', 'error');
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
                const message = `Kết nối thành công! Tìm thấy ${result.totalRows} tổng dòng (${result.storeWithCouponsRows} dòng cửa hàng+coupon, ${result.storeInfoRows} thông tin cửa hàng). Đã xử lý ${result.processedStores} cửa hàng với ${result.totalCoupons} coupon.`;
                this.showMessage(message, 'success');
                this.addLogEntry(`Kiểm tra kết nối thành công - ${result.processedStores} cửa hàng với ${result.totalCoupons} coupon được xử lý từ ${result.totalRows} dòng`, 'success');
            } else {
                this.showMessage(result.error || 'Kiểm tra kết nối thất bại', 'error');
                this.addLogEntry('Kiểm tra kết nối thất bại', 'error');
            }
        } catch (error) {
            console.error('Connection test error:', error);
            this.showMessage('Kiểm tra kết nối thất bại. Vui lòng kiểm tra cấu hình của bạn.', 'error');
            this.addLogEntry('Kiểm tra kết nối thất bại', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async createStoresNow() {
        // Confirm action with user
        if (!confirm('Điều này sẽ tạo tất cả cửa hàng từ dữ liệu Google Sheets của bạn ngay bây giờ. Tiếp tục?')) {
            return;
        }

        this.showLoading(true);
        this.showMessage('Đang tạo cửa hàng... Có thể mất vài phút.', 'info');

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
                let message = `Quá trình hoàn thành! Đã tạo ${results.storesCreated} cửa hàng`;

                if (results.storesUpdated > 0) {
                    message += `, cập nhật ${results.storesUpdated} cửa hàng`;
                }

                if (results.storesSkipped > 0) {
                    message += `, bỏ qua ${results.storesSkipped} trùng lặp`;
                }

                if (results.errors && results.errors.length > 0) {
                    message += `, ${results.errors.length} lỗi xảy ra`;
                }

                this.showMessage(message, 'success');
                this.addLogEntry(`Tạo thủ công: ${results.storesCreated} đã tạo, ${results.storesUpdated || 0} đã cập nhật, ${results.storesSkipped} đã bỏ qua`, 'success');

                // Show detailed results
                this.showCreateResults(results);

                // Refresh status
                this.loadStatus();
            } else {
                this.showMessage(result.error || 'Không thể tạo cửa hàng', 'error');
                this.addLogEntry('Tạo cửa hàng thủ công thất bại', 'error');
            }
        } catch (error) {
            console.error('Create stores error:', error);
            this.showMessage('Không thể tạo cửa hàng. Vui lòng thử lại.', 'error');
            this.addLogEntry('Tạo cửa hàng thủ công thất bại', 'error');
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
                status.configured ? 'Đã cấu hình ✓' : 'Chưa cấu hình';

            document.getElementById('last-run').textContent =
                status.lastRun ? this.formatDateTime(status.lastRun.timestamp) : 'Chưa có';

            document.getElementById('polling-interval').textContent =
                `${status.pollingInterval} phút`;

            // Load and populate configuration form if configured
            if (status.configured && status.sheetId) {
                await this.loadConfiguration();
                this.addLogEntry('Trạng thái đã được tải thành công', 'success');
            }

            // Enable/disable test button based on configuration
            document.getElementById('test-connection').disabled = !status.configured;

        } catch (error) {
            console.error('Status loading error:', error);
            this.addLogEntry('Không thể tải trạng thái', 'error');
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
                    this.addLogEntry('Cấu hình được điền tự động từ dữ liệu đã lưu', 'success');
                    console.log('Auto-filled Google Sheets URL from existing configuration');
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
                this.addLogEntry(`Đã xem cửa hàng: ${storesResult.totalCount} tổng, hiển thị ${storesResult.stores.length} gần đây`, 'success');
                this.showStoreList(storesResult.stores, storesResult.count);
            } else {
                this.showMessage(storesResult.error || 'Không thể lấy danh sách cửa hàng', 'error');
                this.addLogEntry('Không thể lấy danh sách cửa hàng', 'error');
            }
        } catch (error) {
            console.error('View stores error:', error);
            this.showMessage('Không thể lấy danh sách cửa hàng. Vui lòng kiểm tra kết nối WordPress.', 'error');
            this.addLogEntry('Không thể lấy danh sách cửa hàng', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    showStoreList(stores, totalCount) {
        const storesSection = document.getElementById('stores-section');
        const storesContainer = document.getElementById('stores-container');

        const html = `
            <div class="store-list">
                <h3>Cửa Hàng WordPress (${totalCount} tổng, hiển thị ${stores.length} gần đây)</h3>
                <table class="preview-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Tiêu Đề</th>
                            <th>Trạng Thái</th>
                            <th>Ngày</th>
                            <th>Hành Động</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stores.map(store => `
                            <tr>
                                <td>${store.id}</td>
                                <td>${store.title}</td>
                                <td><span class="status-badge ${store.status}">${store.status}</span></td>
                                <td>${new Date(store.date).toLocaleDateString('vi-VN')}</td>
                                <td>
                                    <a href="${store.link}" target="_blank" class="btn-link">
                                        <i class="fas fa-external-link-alt"></i> Xem
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
                <h3>Kết Quả Tạo Cửa Hàng</h3>
                <div class="stats-grid">
                    <div class="stat-item success">
                        <strong>Cửa Hàng Đã Tạo:</strong> ${results.storesCreated}
                    </div>
                    <div class="stat-item success">
                        <strong>Cửa Hàng Đã Cập Nhật:</strong> ${results.storesUpdated || 0}
                    </div>
                    <div class="stat-item success">
                        <strong>Coupon Đã Tạo:</strong> ${results.couponsCreated || 0}
                    </div>
                    <div class="stat-item success">
                        <strong>Hình Ảnh Đã Xử Lý:</strong> ${results.imagesProcessed || 0}
                    </div>
                    <div class="stat-item warning">
                        <strong>Hình Ảnh Bỏ Qua:</strong> ${results.imagesSkipped || 0}
                    </div>
                    <div class="stat-item warning">
                        <strong>Trùng Lặp Bỏ Qua:</strong> ${results.storesSkipped}
                    </div>
                    <div class="stat-item">
                        <strong>Tổng Từ Sheets:</strong> ${results.totalFromSheet}
                    </div>
                    <div class="stat-item">
                        <strong>Có Sẵn Trong WordPress:</strong> ${results.existingInWordPress}
                    </div>
                    <div class="stat-item">
                        <strong>Dòng Cửa Hàng+Coupon:</strong> ${results.storeWithCouponsRows || 0}
                    </div>
                </div>
                ${results.errors && results.errors.length > 0 ? `
                    <div class="errors-section">
                        <h4>Lỗi (${results.errors.length}):</h4>
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
                    Quá trình tạo cửa hàng hoàn thành thành công!
                    ${results.couponsCreated > 0 ? `<br><small>Đã tạo ${results.couponsCreated} coupon trên tất cả cửa hàng</small>` : ''}
                    ${results.imagesProcessed > 0 ? `<br><small>Đã xử lý ${results.imagesProcessed} hình ảnh nổi bật</small>` : ''}
                </div>
            </div>
        `;

        storesContainer.innerHTML = html;
        storesSection.style.display = 'block';
    }

    async exportExcel() {
        this.showLoading(true);
        this.showMessage('Đang chuẩn bị xuất Excel... Có thể mất vài phút.', 'info');

        try {
            const response = await fetch('/api/export-excel', {
                method: 'GET'
            });

            if (response.ok) {
                // Create a blob from the response
                const blob = await response.blob();

                // Create download link
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;

                // Get filename from response header or create default
                const contentDisposition = response.headers.get('Content-Disposition');
                let filename = 'stores_export.xlsx';
                if (contentDisposition) {
                    const matches = contentDisposition.match(/filename="(.+)"/);
                    if (matches) {
                        filename = matches[1];
                    }
                }

                a.download = filename;
                document.body.appendChild(a);
                a.click();

                // Cleanup
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);

                this.showMessage('Tệp Excel đã được tải xuống thành công!', 'success');
                this.addLogEntry(`Xuất Excel hoàn thành - ${filename}`, 'success');
            } else {
                const result = await response.json();
                this.showMessage(result.error || 'Xuất thất bại', 'error');
                this.addLogEntry('Xuất Excel thất bại', 'error');
            }
        } catch (error) {
            console.error('Export error:', error);
            this.showMessage('Xuất thất bại. Vui lòng thử lại.', 'error');
            this.addLogEntry('Xuất Excel thất bại', 'error');
        } finally {
            this.showLoading(false);
        }
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
