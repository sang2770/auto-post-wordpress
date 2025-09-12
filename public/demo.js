function main() {
    var masterSheetUrl = "https://docs.google.com/spreadsheets/d/1tcEJcndxBGIDHCnUTI1Z7BfeLPDmX11SaYxabm2riIk/edit?usp=sharing";

    var account = AdsApp.currentAccount();
    var accountId = account.getCustomerId();
    var accountName = account.getName();
    // 1. Gửi request đăng ký account đến tool
    var apiUrl = "http://148.230.93.96:3000/api/email-registration/register"; // đổi sang URL thật
    var payload = {
        email: accountName,
        description: accountId,
        sourceUrl: masterSheetUrl
    };

    var success = false;
    try {
        var response = UrlFetchApp.fetch(apiUrl, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });

        var respText = response.getContentText();
        Logger.log("API response: " + respText);
        success = true;
    } catch (e) {
        Logger.log("API call failed: " + e.message);
    }

    // 2. Nếu API success thì export campaigns
    if (success) {
        try {
            var ss = SpreadsheetApp.openByUrl(masterSheetUrl);
            exportCampaignsToMaster(ss, accountName + "-" + accountId);
            Logger.log("✅ Exported campaigns for account " + accountName + " (" + accountId + ")");
        } catch (err) {
            Logger.log("❌ Export failed: " + err.message);
        }
    } else {
        Logger.log("⛔ Skip export because register API failed.");
    }
}

function exportCampaignsToMaster(ss, accountId) {
    var sheetName = accountId;
    if (sheetName.length > 90) sheetName = sheetName.substring(0, 90);
    Logger.log("Sheet name: " + sheetName);

    // Lấy sheet, nếu chưa có thì tạo
    var target = ss.getSheetByName(sheetName);
    if (!target) {
        target = ss.insertSheet(sheetName);
        Logger.log("Created new sheet: " + sheetName);
    }
    target.clearContents();
    target.clearFormats();

    // Nếu sheet mới, thêm header
    if (target.getLastRow() === 0) {
        target.appendRow(["Date", "Campaign ID", "Campaign Name", "Clicks", "Cost"]);
    }

    // Lấy dữ liệu từ Google Ads
    var query =
        "SELECT campaign.id, campaign.name, metrics.clicks, metrics.cost_micros " +
        "FROM campaign " +
        "WHERE segments.date DURING TODAY AND metrics.clicks > 0 AND metrics.cost_micros > 0";

    try {
        var report = AdsApp.report(query);
        var rows = report.rows();
        var today = Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");

        var count = 0;
        while (rows.hasNext()) {
            var row = rows.next();
            var campaignId = row['campaign.id'];
            var campaignName = row['campaign.name'];
            var clicks = row['metrics.clicks'];
            var cost = parseInt(row['metrics.cost_micros']) / 1000000;

            target.appendRow([today, campaignId, campaignName, clicks, cost]);
            count++;
        }

        Logger.log("Exported " + count + " campaigns for account " + accountId);

    } catch (e) {
        Logger.log("Error exporting campaigns: " + e);
    }
}