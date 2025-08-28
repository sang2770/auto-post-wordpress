class ReportsManager {
    constructor() {
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadReportConfig();
        
        // Set today's date as default
        document.getElementById('report-date').value = new Date().toISOString().split('T')[0];
    }

    bindEvents() {
        // Report functionality
        document.getElementById('save-report-config').addEventListener('click', () => {
            this.saveReportConfig();
        });

        document.getElementById('test-data-connection').addEventListener('click', () => {
            this.testDataConnection();
        });

        document.getElementById('generate-report').addEventListener('click', () => {
            this.generateReport();
        });

        document.getElementById('view-stores-list').addEventListener('click', () => {
            this.viewStoresList();
        });
    }

    // Report functionality methods
    async saveReportConfig() {
        const dataUrl = document.getElementById('data-url').value.trim();
        const reportUrl = document.getElementById('report-url').value.trim();

        if (!dataUrl || !reportUrl) {
            this.showMessage('Vui lòng nhập cả URL dữ liệu và URL báo cáo', 'error');
            return;
        }

        if (!this.isValidGoogleSheetsUrl(dataUrl) || !this.isValidGoogleSheetsUrl(reportUrl)) {
            this.showMessage('Vui lòng nhập URL Google Sheets hợp lệ', 'error');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch('/api/reports/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    dataUrl,
                    reportUrl
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showMessage('Cấu hình báo cáo đã được lưu thành công!', 'success');
                this.addLogEntry('Cập nhật cấu hình báo cáo', 'success');
                this.updateReportStatus('Cấu hình báo cáo đã được lưu');
            } else {
                this.showMessage(result.error || 'Không thể lưu cấu hình báo cáo', 'error');
            }
        } catch (error) {
            console.error('Report configuration error:', error);
            this.showMessage('Không thể lưu cấu hình báo cáo. Vui lòng thử lại.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async testDataConnection() {
        this.showLoading(true);

        try {
            const response = await fetch('/api/reports/test-data-connection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();

            if (response.ok) {
                this.showMessage(`Kết nối dữ liệu thành công! Tìm thấy ${result.totalRows} dòng với ${result.columns.length} cột`, 'success');
                this.addLogEntry(`Kiểm tra dữ liệu thành công: ${result.totalRows} dòng`, 'success');
                this.updateReportStatus(`Kết nối dữ liệu OK: ${result.totalRows} dòng có sẵn`);
            } else {
                this.showMessage(result.error || 'Không thể kiểm tra kết nối dữ liệu', 'error');
                this.addLogEntry('Kiểm tra kết nối dữ liệu thất bại', 'error');
            }
        } catch (error) {
            console.error('Data connection test error:', error);
            this.showMessage('Không thể kiểm tra kết nối dữ liệu. Vui lòng thử lại.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async generateReport() {
        const reportDate = document.getElementById('report-date').value;

        if (!reportDate) {
            this.showMessage('Vui lòng chọn ngày báo cáo', 'error');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch('/api/reports/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    date: reportDate
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showMessage(`Báo cáo đã được tạo thành công cho ngày ${result.date}! Đã xử lý ${result.storesProcessed} cửa hàng với ${result.totalRecords} bản ghi.`, 'success');
                this.addLogEntry(`Tạo báo cáo: ${result.date} - ${result.storesProcessed} cửa hàng`, 'success');
                this.updateReportStatus(`Báo cáo cuối: ${result.date} (${result.storesProcessed} cửa hàng)`);
                this.loadReportHistory();
            } else {
                this.showMessage(result.error || 'Không thể tạo báo cáo', 'error');
                this.addLogEntry('Tạo báo cáo thất bại', 'error');
            }
        } catch (error) {
            console.error('Report generation error:', error);
            this.showMessage('Không thể tạo báo cáo. Vui lòng thử lại.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async viewStoresList() {
        this.showLoading(true);

        try {
            const response = await fetch('/api/reports/stores');
            const result = await response.json();

            if (response.ok) {
                this.showStoresList(result.stores);
                this.addLogEntry(`Tìm thấy ${result.totalStores} cửa hàng trong nguồn dữ liệu`, 'success');
            } else {
                this.showMessage(result.error || 'Không thể lấy danh sách cửa hàng', 'error');
            }
        } catch (error) {
            console.error('Stores list error:', error);
            this.showMessage('Không thể lấy danh sách cửa hàng. Vui lòng thử lại.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async loadReportConfig() {
        try {
            const response = await fetch('/api/reports/config');
            const result = await response.json();

            if (response.ok && result.configured) {
                document.getElementById('data-url').value = result.dataUrl || '';
                document.getElementById('report-url').value = result.reportUrl || '';
                this.updateReportStatus('Cấu hình báo cáo đã được tải');
            } else {
                this.updateReportStatus('Chưa cấu hình báo cáo');
            }
        } catch (error) {
            console.error('Error loading report configuration:', error);
            this.updateReportStatus('Lỗi tải cấu hình báo cáo');
        }
    }

    async loadReportHistory() {
        // Placeholder for loading report history
        // This could fetch from a database or file storage
        const historyContainer = document.getElementById('report-history-container');
        const currentDate = new Date().toLocaleDateString('vi-VN');
        
        historyContainer.innerHTML = `
            <div class="report-history-item">
                <i class="fas fa-file-alt"></i>
                <div>
                    <strong>Báo cáo ${currentDate}</strong>
                    <span>Vừa được tạo</span>
                </div>
            </div>
        `;
    }

    showStoresList(stores) {
        const storesListSection = document.getElementById('stores-list-section');
        const storesListContainer = document.getElementById('stores-list-container');

        if (stores.length === 0) {
            storesListContainer.innerHTML = '<p>Không tìm thấy cửa hàng nào trong nguồn dữ liệu</p>';
        } else {
            const storesHtml = stores.map(store => 
                `<div class="store-item">${store}</div>`
            ).join('');
            
            storesListContainer.innerHTML = `
                <div class="stores-grid">
                    ${storesHtml}
                </div>
            `;
        }

        storesListSection.style.display = 'block';
    }

    updateReportStatus(statusText) {
        const statusContainer = document.querySelector('#report-status .status-text');
        if (statusContainer) {
            statusContainer.textContent = statusText;
        }
    }

    // Utility methods
    isValidGoogleSheetsUrl(url) {
        const patterns = [
            /docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/,
            /drive\.google\.com.*\/spreadsheets\/d\/[a-zA-Z0-9-_]+/
        ];
        return patterns.some(pattern => pattern.test(url));
    }

    showMessage(message, type = 'info') {
        const container = document.getElementById('message-container');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const icon = type === 'success' ? 'check-circle' : 
                    type === 'error' ? 'exclamation-circle' : 'info-circle';
        
        messageDiv.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(messageDiv);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
            }
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
        if (!isoString) return 'Chưa có';

        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Vừa xong';
        if (diffMins < 60) return `${diffMins} phút trước`;
        if (diffHours < 24) return `${diffHours} giờ trước`;
        if (diffDays < 7) return `${diffDays} ngày trước`;

        return date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN');
    }
}

// Initialize the reports application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ReportsManager();
});

// Add some global error handling
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});
