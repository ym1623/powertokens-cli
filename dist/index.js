#!/usr/bin/env node
import { Command } from "commander";
import { loginCmd, logoutCmd, whoamiCmd } from "./commands/auth.js";
import { chatCmd } from "./commands/chat.js";
import { generateCmd } from "./commands/generate.js";
import { modelsCmd } from "./commands/models.js";
import { configCmd } from "./commands/config.js";
import { toolsUpscaleCmd, toolsBgRemoveCmd } from "./commands/tools.js";
const program = new Command();
program
    .name("pt")
    .description("PowerTokens CLI — terminal access to Chinese AI models")
    .version("1.0.48");
program
    .command("login")
    .description("Configure your PowerTokens API key")
    .argument("[key]", "API Key (if not provided, prompts interactively)")
    .action(loginCmd);
program
    .command("logout")
    .description("Remove stored API key")
    .action(logoutCmd);
program
    .command("whoami")
    .description("Show current user and usage info")
    .action(whoamiCmd);
program
    .command("chat")
    .description("Chat with an LLM model")
    .option("-m, --model <model>", "Model name", "glm-4.7-flash")
    .option("-s, --system <prompt>", "System prompt")
    .option("-t, --max-tokens <n>", "Max output tokens", "1024")
    .argument("[prompt]", "Your message (reads from stdin if not provided)")
    .action(chatCmd);
program
    .command("generate")
    .description("Generate image, video, or audio")
    .option("-m, --model <model>", "Model name", "seedream-5-0-260128")
    .option("-p, --prompt <prompt>", "Generation prompt")
    .option("-o, --output <path>", "Output file path")
    .option("-s, --size <size>", "Image size (e.g. 2048x2048)")
    .option("-r, --resolution <res>", "Video resolution (480p/720p/1080p)", "720p")
    .option("-d, --duration <seconds>", "Video duration in seconds")
    .option("--ref <path|id>", "Reference image / first frame (local path or asset id)")
    .option("--last-frame <path|id>", "Last frame for first-last-frame video")
    .option("--ref-video <path|id>", "Reference video (local path or asset id)")
    .option("--ref-audio <path|id>", "Reference audio (local path or asset id)")
    .option("--character-orientation <image|video>", "Kling motion control character orientation")
    .option("--asset-group-id <id>", "Asset group ID for Seedance asset upload")
    .option("--negative-prompt <text>", "Negative prompt")
    .option("--aspect-ratio <ratio>", "Aspect ratio (e.g. 16:9, 1:1)")
    .option("--seed <n>", "Random seed")
    .option("--num <n>", "Number of images to generate")
    .option("--watermark", "Enable watermark")
    .option("--sound [on|off]", "Video sound (Kling, default on when flag present)")
    .option("--generate-audio", "Video with audio (Seedance)")
    .option("--ratio <ratio>", "Seedance ratio (16:9/4:3/1:1/adaptive)")
    .option("--voice <voice>", "TTS voice name")
    .option("--params <json>", "Extra provider params as JSON (merged into request)")
    .action(generateCmd);
program
    .command("models")
    .description("List available models")
    .option("-t, --type <type>", "Filter: chat, image, video, audio, all", "all")
    .action(modelsCmd);
program
    .command("config")
    .description("Show or set configuration")
    .option("-b, --base-url <url>", "Set API base URL")
    .option("-a, --asset-base-url <url>", "Set asset library base URL")
    .option("--reset", "Reset base URL to default (api.powertokens.ai)")
    .action(configCmd);
const tools = program.command("tools").description("Free tools — image upscaler, bg remover, etc.");
tools
    .command("upscale")
    .description("Upscale image 2x/4x via POST /v1/tools/image-upscale")
    .option("-i, --input <path>", "Input image path (JPG/PNG/WebP, ≤10MB)")
    .option("--image-url <url>", "Image URL (alternative to -i)")
    .option("-s, --scale <n>", "Scale 2 or 4", "2")
    .option("-o, --output <path>", "Output file path")
    .option("--face-enhance", "Enable face enhancement (upscaler only)")
    .action(toolsUpscaleCmd);
tools
    .command("bg-remove")
    .description("Remove background via POST /v1/tools/image-bg-remover (output PNG transparent)")
    .option("-i, --input <path>", "Input image path (JPG/PNG/WebP, ≤10MB)")
    .option("--image-url <url>", "Image URL (alternative to -i)")
    .option("-o, --output <path>", "Output file path (PNG)")
    .action(toolsBgRemoveCmd);
program.parse();
