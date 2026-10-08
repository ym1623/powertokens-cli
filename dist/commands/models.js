import { listModels } from "../client.js";
import { getApiKey } from "../config.js";
import chalk from "chalk";
export async function modelsCmd(options) {
    const key = getApiKey();
    if (!key) {
        console.log(chalk.red("❌ Not logged in. Run: pt login"));
        return;
    }
    const type = options.type || "all";
    const models = await listModels();
    const filtered = type === "all" ? models : models.filter((m) => m.types.includes(type));
    const typeLabel = { chat: "💬 Chat", image: "🖼 Image", video: "🎬 Video", audio: "🔊 Audio", all: "📋 All" };
    console.log(chalk.bold(`\n${typeLabel[type] || type} Models (${filtered.length})\n`));
    for (const m of filtered) {
        const price = m.price ? chalk.dim(` ${m.price}`) : "";
        const free = m.price?.includes("FREE") ? chalk.green(" 🆓") : "";
        console.log(`  ${chalk.cyan(m.id)} ${chalk.dim(`[${m.provider}]`)}${free}${price}`);
    }
    console.log("");
    console.log(chalk.dim("Use: pt chat -m MODEL 'prompt' | pt generate -m MODEL -p 'prompt' -o output.ext"));
}
