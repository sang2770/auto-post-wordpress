function main() {
    var masterSheetUrl = "https://docs.google.com/spreadsheets/d/1tcEJcndxBGIDHCnUTI1Z7BfeLPDmX11SaYxabm2riIk/edit?usp=sharing";
    var ss = SpreadsheetApp.openByUrl(masterSheetUrl);
    var account = AdsApp.currentAccount();
    var accountId = account.getCustomerId();
    var accountName = account.getName();
    // Tạo sheet chung
    var sheetName = accountName + "-" + accountId;
    var target = ss.getSheetByName(sheetName);
    if (!target) {
        target = ss.insertSheet(sheetName);
    }
    target.clearContents();
    target.clearFormats();
    target.appendRow([
        "Date",
        "Campaign ID",
        "Campaign Name",
        "Clicks",
        "Cost",
        "Currency"
    ]);
    // Gọi API đăng ký
    var sheetUrl = masterSheetUrl + "#gid=" + target.getSheetId();
    var success = registerAccount(accountName, accountId, sheetUrl);
    if (!success) {
        Logger.log("⛔ Registration API failed for account " + accountName + " (" + accountId + ")");
        return;
    }
    try {
        // Nếu MCC thì duyệt account con
        var accountIterator = MccApp.accounts().get();
        if (accountIterator.hasNext()) {
            while (accountIterator.hasNext()) {
                var account = accountIterator.next();
                MccApp.select(account);
                processSingleAccount(account, target, masterSheetUrl);
            }
            return;
        }
    } catch (e) {
        Logger.log("Not MCC → running normal account");
    }

    // Nếu account thường

    processSingleAccount(account, target, masterSheetUrl);
}

function processSingleAccount(account, target, masterSheetUrl) {
    var accountId = account.getCustomerId();
    var accountName = account.getName();
    Logger.log("▶ Processing account " + accountName + " (" + accountId + ")");



    try {
        exportCampaignsToSheet(accountId, accountName, target);
        Logger.log("✅ Exported campaigns for account " + accountName + " (" + accountId + ")");
    } catch (err) {
        Logger.log("❌ Export failed: " + err.message);
    }
}

function registerAccount(accountName, accountId, sheetUrl) {
    var apiUrl = "http://148.230.93.96:3000/api/email-registration/register";
    var payload = {
        email: accountName,
        description: accountId,
        sourceUrl: sheetUrl
    };

    try {
        var response = UrlFetchApp.fetch(apiUrl, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });
        Logger.log("API response: " + response.getContentText());
        return true;
    } catch (e) {
        Logger.log("API call failed: " + e.message);
        return false;
    }
}

function exportCampaignsToSheet(accountId, accountName, target) {
    var query =
        "SELECT campaign.id, campaign.name, metrics.clicks, metrics.cost_micros, customer.currency_code " +
        "FROM campaign " +
        "WHERE segments.date DURING YESTERDAY AND metrics.clicks > 0";

    var report = AdsApp.report(query);
    var rows = report.rows();
    var yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");

    var count = 0;
    while (rows.hasNext()) {
        var row = rows.next();
        var campaignId = row['campaign.id'];
        var campaignName = row['campaign.name'];
        var clicks = row['metrics.clicks'];
        var cost = parseInt(row['metrics.cost_micros']) / 1000000;
        var currency = row['customer.currency_code'];

        target.appendRow([yesterday, campaignId, campaignName, clicks, cost, currency]);
        count++;
    }

    Logger.log("Exported " + count + " campaigns for account " + accountName);
}
