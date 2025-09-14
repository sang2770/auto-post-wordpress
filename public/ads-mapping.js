let mappingGroupCount = 1;
let registeredEmails = [];

// Load existing configuration on page load
document.addEventListener('DOMContentLoaded', async function () {
    await loadRegisteredEmails();
    await loadMappingConfig();
});

// Email Registration Functions
async function registerEmail() {
    const email = document.getElementById('register-email').value;
    const sourceUrl = document.getElementById('register-source-url').value;
    const description = document.getElementById('register-description').value;

    if (!email || !sourceUrl) {
        alert('Vui lòng điền đầy đủ email và source URL');
        return;
    }

    try {
        const response = await fetch('/api/email-registration/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                sourceUrl: sourceUrl,
                description: description
            }),
        });

        const result = await response.json();

        if (response.ok) {
            alert('Đăng ký email thành công!');
            document.getElementById('register-email').value = '';
            document.getElementById('register-source-url').value = '';
            document.getElementById('register-description').value = '';
            loadRegisteredEmails();
        } else {
            alert('Lỗi: ' + result.error);
        }
    } catch (error) {
        console.error('Error registering email:', error);
        alert('Có lỗi xảy ra khi đăng ký email');
    }
}

async function loadRegisteredEmails() {
    try {
        const response = await fetch('/api/email-registration/list');
        const emails = await response.json();

        registeredEmails = emails;
        updateEmailsList();
        updateEmailDropdowns();
    } catch (error) {
        console.error('Error loading registered emails:', error);
        registeredEmails = []; // Ensure it's always an array
    }
}

function updateEmailsList() {
    const container = document.getElementById('registered-emails-list');

    if (registeredEmails.length === 0) {
        container.innerHTML = '<p class="text-muted">Chưa có email nào được đăng ký</p>';
        return;
    }

    container.innerHTML = registeredEmails.map(email => `
        <div class="email-item">
            <div class="email-info">
                <strong>${email.email}</strong>
                <small>${email.description || 'Không có mô tả'}</small>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    Đăng ký: ${new Date(email.registeredAt).toLocaleString('vi-VN')}
                </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="deleteEmail('${email.email}')">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
}

function updateEmailDropdowns() {
    // Update destination email dropdowns
    const destinationSelects = document.querySelectorAll('.destination-email');
    destinationSelects.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '<option value="">-- Chọn email đã đăng ký --</option>' +
            registeredEmails.map(email =>
                `<option value="${email.email}" ${currentValue === email.email ? 'selected' : ''}>${email.email} (${email.description || 'Không có mô tả'})</option>`
            ).join('');
    });

    // Update source email dropdowns
    const sourceSelects = document.querySelectorAll('.source-email');
    sourceSelects.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '<option value="">-- Chọn email nguồn --</option>' +
            registeredEmails.map(email =>
                `<option value="${email.email}" ${currentValue === email.email ? 'selected' : ''}>${email.email} (${email.description || 'Không có mô tả'})</option>`
            ).join('');
    });
}

async function deleteEmail(email) {
    if (!confirm(`Bạn có chắc muốn xóa email ${email}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/email-registration/${encodeURIComponent(email)}`, {
            method: 'DELETE',
        });

        if (response.ok) {
            alert('Xóa email thành công!');
            loadRegisteredEmails();
        } else {
            const result = await response.json();
            alert('Lỗi: ' + result.error);
        }
    } catch (error) {
        console.error('Error deleting email:', error);
        alert('Có lỗi xảy ra khi xóa email');
    }
}

function updateDestinationFromEmail(groupIndex) {
    const emailSelect = document.getElementById(`destination-email-${groupIndex}`);
    const urlInput = document.getElementById(`destination-url-${groupIndex}`);

    if (emailSelect.value) {
        const selectedEmail = registeredEmails.find(e => e.email === emailSelect.value);
        if (selectedEmail) {
            urlInput.value = selectedEmail.sourceUrl;
        }
    }
}

// Add new mapping group
function addMappingGroup() {
    const container = document.getElementById('mapping-groups-container');
    const newGroup = createMappingGroupElement(mappingGroupCount);
    container.appendChild(newGroup);
    mappingGroupCount++;
    updateRemoveButtons();
    // Ensure the new group's dropdowns are properly populated
    updateEmailDropdowns();
}

// Create mapping group element
function createMappingGroupElement(index) {
    const div = document.createElement('div');
    div.className = 'mapping-group';
    div.id = `mapping-group-${index}`;
    
    // Generate email options
    const emailOptions = registeredEmails.map(email =>
        `<option value="${email.email}">${email.email} (${email.description || 'Không có mô tả'})</option>`
    ).join('');
    
    div.innerHTML = `
        <div class="mapping-group-header">
            <h4>Group ${index + 1}</h4>
            <button type="button" class="btn btn-danger btn-sm remove-group" onclick="removeMappingGroup(this)">
                <i class="fas fa-trash"></i> Xóa Group
            </button>
        </div>
        
        <div class="form-group">
            <label for="group-name-${index}">Tên Group:</label>
            <input
                type="text"
                id="group-name-${index}"
                class="group-name"
                placeholder="Ví dụ: Main Store Group"
                required
            />
            <small>Tên để phân biệt các group mapping</small>
        </div>

        <div class="form-group">
            <label for="destination-url-${index}">URL Sheet Đích:</label>
            <input
                type="url"
                id="destination-url-${index}"
                class="destination-url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                required
            />
            <small>Sheet đích để fill dữ liệu cho group này</small>
        </div>

        <div class="source-emails-section">
            <h5><i class="fas fa-database"></i> Chọn Emails Nguồn:</h5>
            <div class="source-emails-container" id="source-emails-${index}">
                <div class="source-email-item">
                    <div class="form-row">
                        <div class="form-group" style="flex: 1">
                            <select class="source-email" required>
                                <option value="">-- Chọn email nguồn --</option>
                                ${emailOptions}
                            </select>
                            <small>Chọn email đã đăng ký từ Google Ads script</small>
                        </div>
                        <div class="form-group" style="flex: 0 0 auto">
                            <button
                                type="button"
                                class="btn btn-danger btn-sm remove-source"
                                onclick="removeSourceEmail(this)"
                                style="display: none; margin-top: 24px"
                            >
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <button
                style="margin-bottom: 10px;"
                type="button"
                class="btn btn-secondary btn-sm"
                onclick="addSourceEmail(${index})"
            >
                <i class="fas fa-plus"></i> Thêm Email Nguồn
            </button>
        </div>
        </div>

        <div class="form-actions">
            <button
                type="button"
                class="btn btn-secondary"
                onclick="testGroupConnection(${index})"
            >
                <i class="fas fa-plug"></i> Test Kết Nối
            </button>
        </div>
    `;
    return div;
}

// Add source URL to a group
function addSourceEmail(groupIndex) {
    const container = document.getElementById(`source-emails-${groupIndex}`);
    const sourceItem = document.createElement('div');
    sourceItem.className = 'source-email-item';
    sourceItem.innerHTML = `
        <div class="form-row">
            <div class="form-group" style="flex: 1;">
                <select class="source-email" required>
                    <option value="">-- Chọn email nguồn --</option>
                    ${registeredEmails.map(email =>
        `<option value="${email.email}">${email.email} (${email.description || 'Không có mô tả'})</option>`
    ).join('')}
                </select>
                <small>Chọn email đã đăng ký từ Google Ads script</small>
            </div>
            <div class="form-group" style="flex: 0 0 auto;">
                <button
                    type="button"
                    class="btn btn-danger btn-sm remove-source"
                    onclick="removeSourceEmail(this)"
                    style="margin-top: 24px;"
                >
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
    container.appendChild(sourceItem);
    updateSourceRemoveButtons(groupIndex);
}

// Remove source email
function removeSourceEmail(button) {
    const sourceItem = button.closest('.source-email-item');
    const container = sourceItem.parentElement;
    sourceItem.remove();

    // Update remove buttons visibility
    const groupElement = button.closest('.mapping-group');
    const groupIndex = Array.from(groupElement.parentElement.children).indexOf(groupElement);
    updateSourceRemoveButtons(groupIndex);
}

// Update source remove buttons visibility
function updateSourceRemoveButtons(groupIndex) {
    const container = document.getElementById(`source-emails-${groupIndex}`);
    const sourceItems = container.querySelectorAll('.source-email-item');
    const removeButtons = container.querySelectorAll('.remove-source');

    removeButtons.forEach(button => {
        button.style.display = sourceItems.length > 1 ? 'inline-block' : 'none';
    });
}

// Remove mapping group
function removeMappingGroup(button) {
    const group = button.closest('.mapping-group');
    group.remove();
    updateRemoveButtons();
    renumberGroups();
}

// Update remove button visibility
function updateRemoveButtons() {
    const groups = document.querySelectorAll('.mapping-group');
    const removeButtons = document.querySelectorAll('.remove-group');

    removeButtons.forEach(button => {
        button.style.display = groups.length > 1 ? 'inline-block' : 'none';
    });
}

// Renumber groups after removal
function renumberGroups() {
    const groups = document.querySelectorAll('.mapping-group');
    groups.forEach((group, index) => {
        const header = group.querySelector('h4');
        header.textContent = `Group ${index + 1}`;
    });
}// Load mapping configuration
async function loadMappingConfig() {
    try {
        showStatus('Đang tải cấu hình...', 'info');

        const response = await fetch('/api/ads-mapping/config');
        const data = await response.json();

        if (data.success && data.mappingGroups && data.mappingGroups.length > 0) {
            populateMappingGroups(data.mappingGroups);
            showStatus(`Đã tải ${data.mappingGroups.length} mapping groups`, 'success');
        } else {
            showStatus('Chưa có cấu hình nào', 'info');
        }

        // Load dollar price
        if (data.dollarPrice) {
            document.getElementById('global-dollar-price').value = data.dollarPrice;
        }

        // // Load global column config
        // if (data.globalColumns) {
        //     document.getElementById('global-store-column').value = data.globalColumns.storeColumn || 'A';
        //     document.getElementById('global-clicks-column').value = data.globalColumns.clicksColumn || 'D';
        //     document.getElementById('global-money-column').value = data.globalColumns.moneyColumn || 'E';
        // }
    } catch (error) {
        console.error('Error loading config:', error);
        showStatus('Lỗi khi tải cấu hình: ' + error.message, 'error');
    }
}

// Populate mapping groups from config
function populateMappingGroups(groups) {
    const container = document.getElementById('mapping-groups-container');
    container.innerHTML = '';

    groups.forEach((group, index) => {
        const groupElement = createMappingGroupElement(index);
        container.appendChild(groupElement);

        // Populate values
        document.getElementById(`group-name-${index}`).value = group.name || '';
        document.getElementById(`destination-url-${index}`).value = group.destinationUrl || '';

        // Populate source emails
        const sourceContainer = document.getElementById(`source-emails-${index}`);

        // Update email dropdowns for this specific group
        updateEmailDropdowns();

        if (group.sourceEmails && group.sourceEmails.length > 0) {
            group.sourceEmails.forEach((sourceEmail, sourceIndex) => {
                if (sourceIndex === 0) {
                    // Use the first item already created
                    const firstSelect = sourceContainer.querySelector('.source-email');
                    if (firstSelect) {
                        firstSelect.value = sourceEmail;
                    }
                } else {
                    // Add additional source emails
                    addSourceEmail(index);
                    const sourceSelects = sourceContainer.querySelectorAll('.source-email');
                    const lastSelect = sourceSelects[sourceSelects.length - 1];
                    if (lastSelect) {
                        lastSelect.value = sourceEmail;
                    }
                }
            });
        } else if (group.sourceUrls && group.sourceUrls.length > 0) {
            // Handle legacy config with sourceUrls - convert to emails if possible
            group.sourceUrls.forEach((sourceUrl, sourceIndex) => {
                const matchingEmail = registeredEmails.find(e => e.sourceUrl === sourceUrl);
                if (matchingEmail) {
                    if (sourceIndex === 0) {
                        const firstSelect = sourceContainer.querySelector('.source-email');
                        if (firstSelect) {
                            firstSelect.value = matchingEmail.email;
                        }
                    } else {
                        addSourceEmail(index);
                        const sourceSelects = sourceContainer.querySelectorAll('.source-email');
                        const lastSelect = sourceSelects[sourceSelects.length - 1];
                        if (lastSelect) {
                            lastSelect.value = matchingEmail.email;
                        }
                    }
                }
            });
        }

        updateSourceRemoveButtons(index);
    });

    mappingGroupCount = groups.length;
    updateRemoveButtons();
}

// Collect mapping groups from form
// Collect mapping groups from form
function collectMappingGroups() {
    const groups = [];
    const groupElements = document.querySelectorAll('.mapping-group');

    groupElements.forEach((element, index) => {
        const name = document.getElementById(`group-name-${index}`)?.value?.trim();
        const destinationUrl = document.getElementById(`destination-url-${index}`)?.value?.trim();

        const sourceContainer = document.getElementById(`source-emails-${index}`);
        const sourceSelects = sourceContainer.querySelectorAll('.source-email');
        const sourceEmails = [];

        sourceSelects.forEach(select => {
            const email = select.value?.trim();
            if (email) {
                sourceEmails.push(email);
            }
        });

        if (name && destinationUrl && sourceEmails.length > 0) {
            groups.push({
                name: name,
                destinationUrl: destinationUrl,
                sourceEmails: sourceEmails
            });
        }
    });

    return groups;
}

// Get global column configuration
function getGlobalColumns() {
    return {
        storeColumn: document.getElementById('global-store-column')?.value?.trim() || 'A',
        clicksColumn: document.getElementById('global-clicks-column')?.value?.trim() || 'D',
        moneyColumn: document.getElementById('global-money-column')?.value?.trim() || 'E'
    };
}

// Save mapping configuration
async function saveMappingConfig() {
    try {
        const dollarPrice = document.getElementById('global-dollar-price')?.value?.trim();
        if (!dollarPrice || isNaN(dollarPrice) || Number(dollarPrice) <= 0) {
            showStatus('Vui lòng nhập tỷ giá USD hợp lệ (số lớn hơn 0)', 'error');
            return;
        }
        const groups = collectMappingGroups();
        const globalColumns = getGlobalColumns();

        if (groups.length === 0) {
            showStatus('Vui lòng nhập ít nhất một mapping group', 'error');
            return;
        }

        showStatus('Đang lưu cấu hình...', 'info');

        const response = await fetch('/api/ads-mapping/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                mappingGroups: groups,
                globalColumns: globalColumns,
                dollarPrice: Number(dollarPrice)
            })
        });

        const data = await response.json();

        if (data.success) {
            showStatus(data.message, 'success');
        } else {
            showStatus('Lỗi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('Error saving config:', error);
        showStatus('Lỗi khi lưu cấu hình: ' + error.message, 'error');
    }
}

// Test connection to sheets for a group
async function testGroupConnection(index) {
    try {
        const destinationUrl = document.getElementById(`destination-url-${index}`)?.value?.trim();
        const groupContainer = document.getElementById(`mapping-group-${index}`);
        const sourceEmails = Array.from(groupContainer.querySelectorAll('.source-email'));
        const sourceUrls = sourceEmails
            .map(select => {
                const email = select.value?.trim();
                const registered = registeredEmails.find(e => e.email === email);
                return registered ? registered.sourceUrl : null;
            })
            .filter(url => url);

        if (!destinationUrl || sourceUrls.length === 0) {
            showStatus('Vui lòng nhập destination URL và ít nhất một source URL', 'error');
            return;
        }

        showStatus('Đang test kết nối...', 'info');

        const response = await fetch('/api/ads-mapping/test-group-connection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ destinationUrl, sourceUrls })
        });

        const data = await response.json();

        if (data.success) {
            const result = data.connectionTest;
            let message = 'Test kết nối:\n';
            message += `• Destination Sheet: ${result.destination.accessible ? '✅ OK' : '❌ ' + result.destination.error}\n`;

            result.sources.forEach((source, idx) => {
                message += `• Source ${idx + 1}: ${source.accessible ? '✅ OK' : '❌ ' + source.error}\n`;
            });

            const allAccessible = result.destination.accessible && result.sources.every(s => s.accessible);
            const status = allAccessible ? 'success' : 'warning';
            showStatus(message, status);
        } else {
            showStatus('Lỗi test kết nối: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('Error testing connection:', error);
        showStatus('Lỗi khi test kết nối: ' + error.message, 'error');
    }
}

// Execute all mappings
async function executeAllMappings() {
    try {
        if (!confirm('Bạn có chắc chắn muốn thực thi tất cả mappings? Dữ liệu sẽ được cập nhật vào các sheet đích.')) {
            return;
        }

        const executeBtn = document.getElementById('execute-all-btn');
        executeBtn.disabled = true;
        executeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang thực thi...';

        showStatus('Đang thực thi tất cả mappings...', 'info');

        const response = await fetch('/api/ads-mapping/execute', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        const data = await response.json();

        if (data.success) {
            displayResults(data.results, data.summary);
            showStatus(data.message, 'success');
        } else {
            showStatus('Lỗi thực thi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('Error executing mappings:', error);
        showStatus('Lỗi khi thực thi mappings: ' + error.message, 'error');
    } finally {
        const executeBtn = document.getElementById('execute-all-btn');
        executeBtn.disabled = false;
        executeBtn.innerHTML = '<i class="fas fa-play"></i> Thực Thi Tất Cả Groups';
    }
}

// Display execution results
function displayResults(results, summary) {
    const section = document.getElementById('results-section');
    const content = document.getElementById('results-content');

    let html = `
        <div class="results-summary">
            <h4>Tổng Kết:</h4>
            <ul>
                <li>Tổng: ${summary.total} mappings</li>
                <li>Thành công: ${summary.successful} mappings</li>
                <li>Thất bại: ${summary.failed} mappings</li>
                <li>Thời gian: ${new Date(summary.executedAt).toLocaleString('vi-VN')}</li>
            </ul>
        </div>
    `;

    html += '</div>';

    content.innerHTML = html;
    section.style.display = 'block';
}

// Load mapping history
async function loadMappingHistory() {
    try {
        showStatus('Đang tải lịch sử...', 'info');

        const response = await fetch('/api/ads-mapping/history');
        const data = await response.json();

        if (data.success) {
            displayHistory(data.history);
            showStatus('Đã tải lịch sử', 'success');
        } else {
            showStatus('Lỗi tải lịch sử: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('Error loading history:', error);
        showStatus('Lỗi khi tải lịch sử: ' + error.message, 'error');
    }
}

// Display history
function displayHistory(history) {
    const section = document.getElementById('results-section');
    const content = document.getElementById('results-content');

    let html = `
        <div class="history-summary">
            <h4>Lịch Sử Thực Thi:</h4>
            <ul>
                <li>Lần cuối: ${history.lastExecution ? new Date(history.lastExecution).toLocaleString('vi-VN') : 'Chưa thực thi'}</li>
                <li>Cấu hình lần cuối: ${history.configuredAt ? new Date(history.configuredAt).toLocaleString('vi-VN') : 'Chưa cấu hình'}</li>
                <li>Số mapping pairs: ${history.pairsCount}</li>
            </ul>
        </div>
    `;

    content.innerHTML = html;
    section.style.display = 'block';
}

// Show status message
function showStatus(message, type = 'info') {
    const section = document.getElementById('status-section');
    const content = document.getElementById('status-content');

    const iconMap = {
        'info': 'fa-info-circle',
        'success': 'fa-check-circle',
        'warning': 'fa-exclamation-triangle',
        'error': 'fa-times-circle'
    };

    const icon = iconMap[type] || iconMap.info;

    content.innerHTML = `
        <div class="status-message ${type}">
            <i class="fas ${icon}"></i>
            <span>${message}</span>
        </div>
    `;

    section.style.display = 'block';

    // Auto hide after 10 seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            section.style.display = 'none';
        }, 10000);
    }
}
