function main() {
    var masterSheetUrl = "https://docs.google.com/spreadsheets/d/1FPj7hBdSQDoLMdTV3Nq5Vx3qWf4cDGOR6SpQrO3teBQ/edit";

    var account = AdsApp.currentAccount();
    var accountId = account.getCustomerId();
    var accountName = account.getName();
    var accountIdNormalized = accountId.replace(/-/g, "");

    var userEmail = Session.getEffectiveUser().getEmail();

    // 1. Gửi request đăng ký account đến tool
    var apiUrl = "https://your-tool-domain.com/api/register"; // đổi sang URL thật
    var payload = {
        gmail: userEmail,
        id: accountId,
        sheetUrl: masterSheetUrl
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

        var respJson = {};
        try { respJson = JSON.parse(respText); } catch (e) { }
        if (respJson.status && respJson.status === "success") {
            success = true;
        }
    } catch (e) {
        Logger.log("API call failed: " + e.message);
    }

    // 2. Nếu API success thì export campaigns
    if (success) {
        try {
            var ss = SpreadsheetApp.openByUrl(masterSheetUrl);
            exportCampaignsToMaster(ss, accountId);
            Logger.log("✅ Exported campaigns for account " + accountName + " (" + accountId + ")");
        } catch (err) {
            Logger.log("❌ Export failed: " + err.message);
        }
    } else {
        Logger.log("⛔ Skip export because register API failed.");
    }
}

function exportCampaignsToMaster(ss, accountId) {
    var sheetName = "Account_" + accountId.replace(/-/g, "");
    if (sheetName.length > 90) sheetName = sheetName.substring(0, 90);

    var target = ss.getSheetByName(sheetName);
    if (!target) target = ss.insertSheet(sheetName);

    if (target.getName() === "signals") throw new Error("Cannot overwrite signals sheet");

    target.clearContents();
    target.clearFormats();

    var query = "SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks " +
        "FROM campaign WHERE segments.date DURING LAST_7_DAYS";

    var report = AdsApp.report(query);
    report.exportToSheet(target);
}
