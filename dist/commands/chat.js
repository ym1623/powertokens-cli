import { chatCompletion } from "../client.js";
import { getApiKey, getBaseUrl } from "../config.js";
import chalk from "chalk";
export async function chatCmd(prompt, options) {
    const key = getApiKey();
    if (!key) {
        console.log(chalk.red("❌ Not logged in. Run: pt login"));
        return;
    }
    // Read from stdin if no prompt arg
    if (!prompt) {
        const chunks = [];
        for await (const chunk of process.stdin) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        prompt = Buffer.concat(chunks).toString("utf8").trim();
        if (!prompt) {
            console.log(chalk.red("❌ No prompt provided. Usage: pt chat 'your message' or echo 'msg' | pt chat"));
            return;
        }
    }
    const model = options?.model || "glm-4.7-flash";
    const maxTokens = parseInt(options?.maxTokens || "1024", 10);
    console.log(chalk.dim(`\n🤖 ${model}`));
    console.log("");
    try {
        const result = await chatCompletion({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: maxTokens,
            system: options?.system,
        });
        const content = result.choices?.[0]?.message?.content ?? JSON.stringify(result);
        console.log(content);
        if (result.usage) {
            console.log("");
            console.log(chalk.dim(`📊 ${result.usage.total_tokens} tokens (in: ${result.usage.prompt_tokens} / out: ${result.usage.completion_tokens})`));
        }
    }
    catch (err) {
        // undici 把网络错误包成 "fetch failed"，真正原因在 err.cause（如 ETIMEDOUT/ECONNRESET/socket hang up）
        const cause = err?.cause ? ` → ${err.cause.code || err.cause.message || err.cause}` : "";
        console.error(chalk.red(`❌ ${err.message}${cause}`));
        console.error(chalk.dim(`   端点: ${getBaseUrl()}/v1/chat/completions  模型: ${model}`));
        console.error(chalk.dim(`   若模型名不存在或上游不可用，会以 "fetch failed" 形式表现。运行 pt models 确认可用模型。`));
        process.exit(1);
    }
}
