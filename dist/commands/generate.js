import { generateImage, generateVideo, textToSpeech, classifyModel, isMultimodalModel, listModels } from "../client.js";
import { getApiKey } from "../config.js";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
export async function generateCmd(options) {
    const key = getApiKey();
    if (!key) {
        console.log(chalk.red("❌ Not logged in. Run: pt login"));
        return;
    }
    const model = options.model || "seedream-5-0-260128";
    const prompt = options.prompt || "";
    // 优先从模型列表缓存取 supported_endpoint_types 精准分类；离线/未知模型回退到 id 模式推断
    const models = await listModels();
    const info = models.find((m) => m.id.toLowerCase() === model.toLowerCase());
    let modelType = classifyModel(model, info?.endpointTypes ?? []);
    // 多模态模型（如 kling-v3）按参数分流：传了视频专属参数则按视频处理
    if (isMultimodalModel(model)) {
        const videoIntent = options.duration || options.resolution || options.sound || options.refVideo || options.refAudio || options.lastFrame;
        if (videoIntent)
            modelType = "video";
    }
    // 解析 --params JSON 透传（提前解析，用于判断是否完全透传）
    let extra;
    if (options.params) {
        try {
            extra = JSON.parse(options.params);
        }
        catch {
            console.error(chalk.red(`❌ --params 不是合法 JSON: ${options.params}`));
            process.exit(1);
        }
    }
    // 完全透传：--params 含 content / media 数组时，作为完整请求体，无需 -p；
    // 多模态参考生视频（带 --ref-video / --ref-audio）时 prompt 也可选。
    const isRawBody = modelType === "video" && !!(extra && (extra.content || extra.media));
    const canOmitPrompt = (modelType === "video" && (options.refVideo || options.refAudio)) || isRawBody;
    if (!prompt && !canOmitPrompt) {
        console.log(chalk.red("❌ No prompt. Use: pt generate -m seedream-5-0-260128 -p 'a cat' -o cat.png"));
        return;
    }
    const spinner = (await import("ora")).default;
    let spin = spinner("Generating...").start();
    try {
        if (modelType === "image") {
            const result = await generateImage({
                model,
                prompt,
                size: options.size, // 各供应商内部处理默认值（Seedream 2048x2048，Kling 1k/2k/4k）
                resolution: options.resolution, // Kling 图片也接受 -r（2K/4K）作为分辨率兜底
                refImage: options.ref,
                negativePrompt: options.negativePrompt,
                seed: options.seed !== undefined ? parseInt(options.seed, 10) : undefined,
                numImages: options.num !== undefined ? parseInt(options.num, 10) : undefined,
                watermark: options.watermark,
                extra,
            });
            const url = result.url || result.outputs?.[0] || result.data?.[0]?.url;
            spin.succeed("Done");
            if (url) {
                if (options.output) {
                    await downloadFile(url, options.output);
                    console.log(chalk.green(`✅ Saved to ${options.output}`));
                }
                else {
                    console.log(chalk.green(`✅ ${url}`));
                }
            }
            else {
                console.log(JSON.stringify(result, null, 2));
            }
        }
        else if (modelType === "video") {
            spin.text = "Generating video (may take 1-15 minutes)...";
            const result = await generateVideo({
                model,
                prompt,
                resolution: options.resolution || "720p",
                duration: options.duration ? parseInt(options.duration, 10) : undefined,
                ref: options.ref,
                lastFrame: options.lastFrame,
                refVideo: options.refVideo,
                refAudio: options.refAudio,
                negativePrompt: options.negativePrompt,
                aspectRatio: options.aspectRatio,
                seed: options.seed !== undefined ? parseInt(options.seed, 10) : undefined,
                sound: typeof options.sound === "boolean" ? (options.sound ? "on" : "off") : options.sound,
                generateAudio: options.generateAudio,
                watermark: options.watermark,
                ratio: options.ratio,
                characterOrientation: options.characterOrientation,
                assetGroupId: options.assetGroupId,
                extra,
            });
            const url = result.url || result.outputs?.[0];
            spin.succeed(`Done${result.elapsed_ms ? ` (${(result.elapsed_ms / 1000).toFixed(1)}s)` : ""}`);
            if (url) {
                if (options.output) {
                    await downloadFile(url, options.output);
                    console.log(chalk.green(`✅ Saved to ${options.output}`));
                }
                else {
                    console.log(chalk.green(`✅ ${url}`));
                }
            }
        }
        else if (modelType === "audio") {
            const result = await textToSpeech({ model, text: prompt, voice: options.voice, extra });
            const url = result.url || result.outputs?.[0] || result.data?.[0]?.url;
            spin.succeed("Done");
            if (url) {
                if (options.output) {
                    await downloadFile(url, options.output);
                    console.log(chalk.green(`✅ Saved to ${options.output}`));
                }
                else {
                    console.log(chalk.green(`✅ ${url}`));
                }
            }
        }
        else {
            spin.fail(`Unknown model: ${model}`);
            console.log(chalk.dim("Chat models: pt chat -m MODEL 'prompt'"));
            process.exit(1);
        }
    }
    catch (err) {
        spin.fail(err.message);
        process.exit(1);
    }
}
async function downloadFile(url, filepath) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Download failed: ${res.status}`);
    const dir = path.dirname(filepath);
    if (dir && !fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filepath, buf);
}
