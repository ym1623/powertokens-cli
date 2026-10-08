import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const CONFIG_DIR = path.join(os.homedir(), ".powertokens");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export function getConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
        }
    }
    catch { }
    return {};
}
export function saveConfig(updates) {
    const config = { ...getConfig(), ...updates };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
    return config;
}
export function getApiKey() {
    return process.env.POWERTOKENS_API_KEY || getConfig().apiKey || "";
}
export function getBaseUrl() {
    return process.env.POWERTOKENS_BASE_URL || getConfig().baseUrl || "https://api.powertokens.ai";
}
export function getAssetBaseUrl() {
    return process.env.POWERTOKENS_ASSET_BASE_URL || getConfig().assetBaseUrl || "";
}
export { CONFIG_DIR, CONFIG_FILE };
