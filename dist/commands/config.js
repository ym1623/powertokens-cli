import { getConfig, saveConfig } from "../config.js";
import chalk from "chalk";
export async function configCmd(options) {
    if (options.baseUrl) {
        saveConfig({ baseUrl: options.baseUrl });
        console.log(chalk.green(`✅ Base URL set to ${options.baseUrl}`));
    }
    else if (options.assetBaseUrl) {
        saveConfig({ assetBaseUrl: options.assetBaseUrl });
        console.log(chalk.green(`✅ Asset base URL set to ${options.assetBaseUrl}`));
    }
    else if (options.reset) {
        saveConfig({ baseUrl: undefined, assetBaseUrl: undefined });
        console.log(chalk.green("✅ Base URL and asset base URL reset to default"));
    }
    const config = getConfig();
    console.log("");
    console.log(chalk.bold("PowerTokens CLI Configuration"));
    console.log(`  API Key:  ${config.apiKey ? chalk.green(config.apiKey.slice(0, 10) + "..." + config.apiKey.slice(-4)) : chalk.red("not set")}`);
    console.log(`  Base URL: ${chalk.cyan(config.baseUrl || "https://api.powertokens.ai (default)")}`);
    console.log(`  Asset Base URL: ${chalk.cyan(config.assetBaseUrl || "(auto-derived from base URL)")}`);
    console.log("");
    console.log(chalk.dim("Config file: ~/.powertokens/config.json"));
}
