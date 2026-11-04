// Android: lets a brief keep running when the user switches apps (foreground service of type "dataSync",
// required on Android 14+, with a "Passfair agents are working" notification while it runs).
const { withAndroidManifest } = require("@expo/config-plugins");

const SERVICE = "com.asterinet.react.bgactions.RNBackgroundActionsTask";
const PERMISSIONS = ["android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_DATA_SYNC"];

module.exports = function withBackgroundRun(config) {
  return withAndroidManifest(config, (c) => {
    const m = c.modResults.manifest;
    m["uses-permission"] = m["uses-permission"] || [];
    for (const name of PERMISSIONS)
      if (!m["uses-permission"].some((p) => p.$["android:name"] === name))
        m["uses-permission"].push({ $: { "android:name": name } });
    const app = m.application[0];
    app.service = (app.service || []).filter((s) => s.$["android:name"] !== SERVICE);
    app.service.push({
      $: { "android:name": SERVICE, "android:foregroundServiceType": "dataSync", "android:exported": "false" },
    });
    return c;
  });
};
