import { saveConfig, getConfig, getApiKey } from "../config.js";
import { listModels } from "../client.js";
import chalk from "chalk";
export async function loginCmd(key) {
    if (!key) {
        const { default: inquirer } = await import("inquirer");
        const answers = await inquirer.prompt([
            {
                type: "password",
                name: "key",
                message: "Enter your PowerTokens API Key:",
                validate: (v) => v.length > 0 || "Key cannot be empty",
            },
        ]);
        key = answers.key;
    }
    saveConfig({ apiKey: key });
    console.log(chalk.green("✅ API Key saved to ~/.powertokens/config.json"));
    console.log(chalk.dim("  Run 'pt whoami' to verify."));
}
export async function logoutCmd() {
    saveConfig({ apiKey: undefined });
    console.log(chalk.green("✅ API Key removed."));
}
export async function whoamiCmd() {
    const key = getApiKey();
    if (!key) {
        console.log(chalk.red("❌ Not logged in. Run: pt login"));
        return;
    }
    console.log(chalk.green("✅ Logged in"));
    console.log(`   Key: ${key.slice(0, 10)}...${key.slice(-4)}`);
    console.log(`   Base: ${getConfig().baseUrl || "https://api.powertokens.ai (default)"}`);
    console.log(`   Models: ${(await listModels()).length} available`);
}
