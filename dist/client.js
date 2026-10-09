import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getApiKey, getBaseUrl, getAssetBaseUrl } from "./config.js";
function headers() {
    const key = getApiKey();
    if (!key)
        throw new Error("未配置 API Key。运行: pt login");
    return {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": "PowerTokens-CLI/1.0",
        Accept: "application/json",
    };
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
// 带重试的 fetch：仅对临时性失败重试 ——
// 网络错误（fetch failed，常见于连接被重置/keep-alive 陈旧 socket/DNS 抖动）、
// 单次请求超时、429、5xx；4xx 等明确业务错误不重试，直接返回 Response 交由调用方处理。
async function fetchWithRetry(url, options = {}, retries = 3, timeoutMs = 30000) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        if (i > 0) {
            // 重试前尊重 Retry-After，否则指数退避（1s/2s/4s…，上限 15s）
            await sleep(Math.min(1000 * 2 ** (i - 1), 15000));
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            if ((res.status === 429 || res.status >= 500) && i < retries) {
                const ra = parseInt(res.headers.get("retry-after") || "", 10);
                if (Number.isFinite(ra) && ra > 0)
                    await sleep(Math.min(ra * 1000, 15000));
                if (process.env.PT_DEBUG)
                    console.error(`[pt debug] GET ${url} => ${res.status}，第 ${i + 1} 次，重试中`);
                continue;
            }
            return res;
        }
        catch (e) {
            lastErr = e;
            if (process.env.PT_DEBUG) {
                const code = e?.cause?.code || e?.name || e?.message;
                console.error(`[pt debug] fetch ${url} 第 ${i + 1}/${retries + 1} 次失败: ${code}`);
            }
        }
        finally {
            clearTimeout(timer);
        }
    }
    if (lastErr?.name === "AbortError")
        throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s），连续 ${retries + 1} 次未成功`);
    const cause = lastErr?.cause ? ` (${lastErr.cause.code || lastErr.cause.message || lastErr.cause})` : "";
    throw new Error(`fetch failed${cause}`);
}
// 轮询专用 GET JSON：内部对网络抖动做有限重试；
// 重试用尽 / JSON 解析失败时返回 null（任务在服务端可能仍在生成甚至已成功，外层应继续轮询）；
// 401/403/404 等明确客户端错误立即抛出（继续重试无意义）。
async function pollFetchJson(url) {
    let res;
    try {
        res = await fetchWithRetry(url, { headers: headers() }, 2, 30000);
    }
    catch {
        return null;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new Error(`API ${res.status}: ${await res.text().catch(() => "")}`);
    }
    if (!res.ok)
        return null;
    try {
        return await res.json();
    }
    catch {
        return null;
    }
}
// 统一的轮询退避节奏
function pollDelay(attempts) {
    return Math.min(2000 * Math.pow(2, Math.min(attempts, 4)), 30000);
}
// 轮询整体超时的错误信息；若期间发生过网络抖动，提示任务可能已在服务端完成
function pollTimeoutMsg(taskId, timeoutMs, netErrors) {
    const base = `Task ${taskId} timeout after ${timeoutMs / 1000}s`;
    return netErrors > 0
        ? `${base} (polling hit ${netErrors} network error(s); the task may have completed server-side)`
        : base;
}
export async function chatCompletion(params) {
    const body = {
        model: params.model,
        messages: params.messages,
        max_tokens: params.max_tokens ?? 1024,
    };
    if (params.temperature !== undefined)
        body.temperature = params.temperature;
    if (params.system) {
        body.messages = [{ role: "system", content: params.system }, ...params.messages];
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    let res;
    try {
        res = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    }
    catch (e) {
        clearTimeout(timer);
        const cause = e?.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : "";
        if (e.name === "AbortError")
            throw new Error(`请求超时（120s）。模型 ${params.model} 可能未响应或上游不可用。`);
        throw new Error(`fetch failed${cause}`);
    }
    clearTimeout(timer);
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API ${res.status}: ${err}`);
    }
    return res.json();
}
function applyExtra(body, extra) {
    if (extra)
        Object.assign(body, extra);
}
export async function generateImage(params) {
    const provider = imageProvider(params.model);
    // Kling：独立端点 /kling/v1/images/generations，异步任务
    if (provider === "kling") {
        return generateKlingImage(params);
    }
    // Qwen / Wan：input.messages 结构
    if (provider === "qwen" || provider === "wan") {
        return generateAliImage(params);
    }
    // Seedream（默认）：顶层 prompt + size
    return generateSeedreamImage(params);
}
async function generateSeedreamImage(p) {
    const body = {
        model: p.model,
        prompt: p.prompt,
        size: p.size ?? "2048x2048",
        n: p.numImages ?? 1,
    };
    if (p.refImage)
        body.image = p.refImage;
    if (p.negativePrompt)
        body.negative_prompt = p.negativePrompt;
    if (p.seed !== undefined)
        body.seed = p.seed;
    if (p.watermark !== undefined)
        body.watermark = p.watermark;
    applyExtra(body, p.extra);
    const data = await postJson(`${getBaseUrl()}/v1/images/generations`, body);
    if (data.task_id)
        return pollTask(data.task_id, 120000);
    return data;
}
async function generateKlingImage(p) {
    const body = {
        model_name: p.model,
        prompt: p.prompt,
        n: p.numImages ?? 1,
        aspect_ratio: "16:9",
    };
    if (p.refImage) {
        body.image = imageInput(p.refImage, true); // Kling 纯 Base64
    }
    else if (p.size || p.resolution) {
        // resolution 支持 1k/2k/4k；--size 或 --resolution 传 2k/2K/2048 → 2k，4k/4K → 4k，否则 1k
        const s = (p.size ?? p.resolution ?? "").toLowerCase();
        body.resolution = /4k/.test(s) ? "4k" : (/2k|2048/.test(s) ? "2k" : "1k");
    }
    if (p.negativePrompt)
        body.negative_prompt = p.negativePrompt;
    applyExtra(body, p.extra);
    const data = await postJson(`${getBaseUrl()}/kling/v1/images/generations`, body);
    const taskId = data.data?.task_id ?? data.task_id;
    return taskId ? pollKlingImageTask(taskId, 180000) : data;
}
async function pollKlingImageTask(taskId, timeoutMs) {
    const start = Date.now();
    let attempts = 0;
    let netErrors = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        const data = await pollFetchJson(`${getBaseUrl()}/kling/v1/images/generations/${taskId}`);
        if (!data) {
            netErrors++;
            await sleep(pollDelay(attempts));
            continue;
        }
        const status = data.data?.task_status ?? data.task_status;
        if (status === "succeed") {
            const images = data.data?.task_result?.images ?? [];
            return { data: images.map((i) => ({ url: i.url })), elapsed_ms: Date.now() - start };
        }
        if (status === "failed")
            throw new Error(data.data?.task_status_msg || "Kling task failed");
        await sleep(pollDelay(attempts));
    }
    throw new Error(pollTimeoutMsg(taskId, timeoutMs, netErrors));
}
// Qwen / Wan：POST /v1/images/generations，提示词在 input.messages[0].content[0].text
async function generateAliImage(p) {
    const body = {
        model: p.model,
        response_format: "url",
        input: { messages: [{ role: "user", content: [{ text: p.prompt }] }] },
        n: p.numImages ?? 1,
    };
    if (p.size)
        body.size = p.size;
    if (p.negativePrompt)
        body.negative_prompt = p.negativePrompt;
    if (p.seed !== undefined)
        body.seed = p.seed;
    if (p.watermark !== undefined)
        body.watermark = p.watermark;
    applyExtra(body, p.extra);
    const data = await postJson(`${getBaseUrl()}/v1/images/generations`, body);
    if (data.task_id)
        return pollTask(data.task_id, 120000);
    return data;
}
export function imageProvider(model) {
    const m = model.toLowerCase();
    if (m.startsWith("kling"))
        return "kling";
    if (m.startsWith("qwen"))
        return "qwen";
    if (m.startsWith("wan"))
        return "wan";
    return "seedream";
}
export function videoProvider(model) {
    const m = model.toLowerCase();
    if (m.includes("seedance"))
        return "seedance";
    if (m.includes("h3") || m === "minimax-h3")
        return "minimax-h3";
    if (m.includes("hailuo"))
        return "hailuo";
    if (m.startsWith("kling"))
        return "kling";
    if (m.includes("happyhorse"))
        return "happyhorse";
    if (m.startsWith("vidu"))
        return "vidu";
    if (m.startsWith("wan"))
        return "wan";
    return "seedance";
}
function mimeFromExt(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".bmp": "image/bmp", ".gif": "image/gif",
        ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac",
    };
    return map[ext] || "image/jpeg";
}
function fileToDataUrl(filePath) {
    const data = fs.readFileSync(filePath);
    return `data:${mimeFromExt(filePath)};base64,${data.toString("base64")}`;
}
function fileToPlainBase64(filePath) {
    return fs.readFileSync(filePath).toString("base64");
}
// 解析图片输入：本地文件转 Base64（默认 data URL，Kling 用纯 Base64），URL/asset:// 原样返回
function imageInput(ref, plainBase64 = false) {
    if (!ref)
        return "";
    if (ref.startsWith("asset://") || /^https?:\/\//i.test(ref) || /^data:/.test(ref))
        return ref;
    if (fs.existsSync(ref)) {
        return plainBase64 ? fileToPlainBase64(ref) : fileToDataUrl(ref);
    }
    throw new Error(`文件不存在: ${ref}`);
}
function postJson(url, body) {
    if (process.env.PT_DEBUG)
        console.error(`[pt debug] POST ${url}\n[pt debug] ${JSON.stringify(body, null, 2)}`);
    // 网络错误时重试 2 次（极端情况下可能在服务端产生重复任务，但远好于任务已创建却报 fetch failed）
    return fetchWithRetry(url, { method: "POST", headers: headers(), body: JSON.stringify(body) }, 2, 60000).then(async (res) => {
        if (!res.ok)
            throw new Error(`API ${res.status}: ${await res.text()}`);
        return res.json();
    });
}
// MiniMax Hailuo（v1）：POST /minimax/v1/video_generation，顶层 prompt + first_frame_image + last_frame_image
async function generateHailuoVideo(p) {
    const body = {
        model: p.model,
        prompt: p.prompt,
        duration: p.duration ?? 6,
        resolution: (p.resolution ?? "").includes("1080") ? "1080P" : "768P",
    };
    if (p.ref)
        body.first_frame_image = imageInput(p.ref);
    if (p.lastFrame)
        body.last_frame_image = imageInput(p.lastFrame);
    if (p.watermark !== undefined)
        body.aigc_watermark = p.watermark;
    applyExtra(body, p.extra);
    const data = await postJson(`${getBaseUrl()}/minimax/v1/video_generation`, body);
    const taskId = data.task_id || data.id;
    return taskId ? pollMinimaxV1Task(taskId, 300000) : data;
}
async function pollMinimaxV1Task(taskId, timeoutMs) {
    const start = Date.now();
    let attempts = 0;
    let netErrors = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        const data = await pollFetchJson(`${getBaseUrl()}/minimax/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`);
        if (!data) {
            netErrors++;
            await sleep(pollDelay(attempts));
            continue;
        }
        const status = data.status ?? data.base_resp?.status_code;
        if (status === "Success" || status === "success" || status === 0) {
            const fileId = data.file_id;
            if (fileId) {
                // 通过 file_id 获取下载 URL
                const dl = await fetchWithRetry(`${getBaseUrl()}/minimax/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`, { headers: headers() }, 2, 30000);
                const dlData = await dl.json();
                const url = dlData.file?.download_url ?? dlData.download_url ?? dlData.url;
                return { url, file_id: fileId, elapsed_ms: Date.now() - start };
            }
            return { ...data, elapsed_ms: Date.now() - start };
        }
        if (status === "Failed" || status === "failed") {
            throw new Error(data.base_resp?.status_msg || data.status_msg || "MiniMax task failed");
        }
        await sleep(pollDelay(attempts));
    }
    throw new Error(pollTimeoutMsg(taskId, timeoutMs, netErrors));
}
// MiniMax H3（v2 官方透传）：POST /minimax/v2/video_generation，content 数组
async function generateMinimaxH3Video(p) {
    const content = [];
    if (p.prompt)
        content.push({ type: "text", text: p.prompt });
    if (p.ref)
        content.push({ type: "image_url", image_url: { url: imageInput(p.ref) }, role: "first_frame" });
    if (p.lastFrame)
        content.push({ type: "image_url", image_url: { url: imageInput(p.lastFrame) }, role: "last_frame" });
    if (p.refVideo)
        content.push({ type: "video_url", video_url: { url: imageInput(p.refVideo) }, role: "reference_video" });
    if (p.refAudio)
        content.push({ type: "audio_url", audio_url: { url: imageInput(p.refAudio) }, role: "reference_audio" });
    const body = {
        model: p.model,
        content,
        resolution: p.resolution ?? "2K",
        duration: p.duration ?? 5,
    };
    if (p.ratio)
        body.ratio = p.ratio;
    if (p.watermark !== undefined)
        body.aigc_watermark = p.watermark;
    applyExtra(body, p.extra);
    const data = await postJson(`${getBaseUrl()}/minimax/v2/video_generation`, body);
    const taskId = data.task_id || data.id;
    return taskId ? pollMinimaxH3Task(taskId, 300000) : data;
}
async function pollMinimaxH3Task(taskId, timeoutMs) {
    const start = Date.now();
    let attempts = 0;
    let netErrors = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        const data = await pollFetchJson(`${getBaseUrl()}/minimax/v2/query/video_generation/${taskId}`);
        if (!data) {
            netErrors++;
            await sleep(pollDelay(attempts));
            continue;
        }
        if (data.status === "succeeded") {
            return { url: data.content?.url, elapsed_ms: Date.now() - start };
        }
        if (data.status === "failed" || data.status === "cancelled") {
            throw new Error(data.message || data.error || "MiniMax H3 task failed");
        }
        await sleep(pollDelay(attempts));
    }
    throw new Error(pollTimeoutMsg(taskId, timeoutMs, netErrors));
}
// Kling：POST /kling/v1/videos/{text2video|image2video}，参数名 model_name，image 用纯 Base64
async function generateKlingVideo(p) {
    const extra = p.extra ?? {};
    // 运镜控制：--params 含 video_url / character_orientation，或 --ref + --ref-video 均路由到 motion-control
    if (("video_url" in extra) || ("character_orientation" in extra) || (p.ref && p.refVideo)) {
        return generateKlingMotionControl(p);
    }
    const hasImage = !!p.ref || !!p.lastFrame;
    const res = (p.resolution ?? "").toLowerCase();
    const mode = ["std", "pro", "4k"].includes(res) ? res : (res.includes("1080") ? "pro" : "std");
    const body = {
        model_name: p.model,
        prompt: p.prompt,
        duration: String(p.duration ?? 5),
        mode,
        sound: p.sound ?? "off",
    };
    if (p.negativePrompt)
        body.negative_prompt = p.negativePrompt;
    if (p.aspectRatio)
        body.aspect_ratio = p.aspectRatio;
    if (p.watermark !== undefined)
        body.watermark_info = { enabled: p.watermark };
    if (p.ref)
        body.image = imageInput(p.ref, true);
    if (p.lastFrame)
        body.image_tail = imageInput(p.lastFrame, true);
    applyExtra(body, p.extra);
    const endpoint = hasImage ? "/kling/v1/videos/image2video" : "/kling/v1/videos/text2video";
    const data = await postJson(`${getBaseUrl()}${endpoint}`, body);
    const taskId = data.data?.task_id ?? data.task_id;
    return taskId ? pollKlingTask(taskId, endpoint, 300000, !!p.watermark) : data;
}
async function pollKlingTask(taskId, endpoint, timeoutMs, wantWatermark = false) {
    const start = Date.now();
    let attempts = 0;
    let netErrors = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        const data = await pollFetchJson(`${getBaseUrl()}${endpoint}/${taskId}`);
        if (!data) {
            netErrors++;
            await sleep(pollDelay(attempts));
            continue;
        }
        const status = data.data?.task_status ?? data.task_status;
        if (status === "succeed") {
            if (process.env.PT_DEBUG)
                console.error(`[pt debug] ${endpoint}/${taskId} => ${JSON.stringify(data, null, 2)}`);
            const videos = data.data?.task_result?.videos;
            // Kling 主 url 无水印，带水印版本在 watermark_url；传 --watermark 时取水印版
            const url = wantWatermark ? (videos?.[0]?.watermark_url || videos?.[0]?.url) : videos?.[0]?.url;
            return { url, elapsed_ms: Date.now() - start };
        }
        if (status === "failed") {
            if (process.env.PT_DEBUG)
                console.error(`[pt debug] ${endpoint}/${taskId} => ${JSON.stringify(data, null, 2)}`);
            throw new Error(data.data?.task_status_msg || "Kling task failed");
        }
        await sleep(pollDelay(attempts));
    }
    throw new Error(pollTimeoutMsg(taskId, timeoutMs, netErrors));
}
// Kling 运镜控制：POST /kling/v1/videos/motion-control
// 支持 --ref/--ref-video/--character-orientation 便利映射；其余参数（video_url 等）均可通过 --params 透传
async function generateKlingMotionControl(p) {
    const res = (p.resolution ?? "").toLowerCase();
    const mode = ["std", "pro"].includes(res) ? res : (res.includes("1080") ? "pro" : "std");
    const body = { model_name: p.model, mode };
    if (p.ref)
        body.image_url = imageInput(p.ref, true); // 本地图转 Base64（无前缀）/ URL
    if (p.refVideo)
        body.video_url = p.refVideo;
    if (p.characterOrientation)
        body.character_orientation = p.characterOrientation;
    if (p.prompt)
        body.prompt = p.prompt;
    if (p.watermark !== undefined)
        body.watermark_info = { enabled: p.watermark };
    applyExtra(body, p.extra); // --params 透传所有字段，覆盖上述便利值
    const data = await postJson(`${getBaseUrl()}/kling/v1/videos/motion-control`, body);
    const taskId = data.data?.task_id ?? data.task_id;
    return taskId ? pollKlingTask(taskId, "/kling/v1/videos/motion-control", 300000, !!p.watermark) : data;
}
// Wan：POST /v1/videos，按模型细分三种结构
// - wan2.7-i2v：media 数组（first_frame + last_frame + driving_audio）
// - wan2.2-kf2v-* / wan2.1-kf2v-*：images 数组（images[0] 首帧 + images[1] 尾帧）
// - wan2.7-r2v：media 数组（reference_image + reference_video + first_frame）
async function generateWanVideo(p) {
    const isKf2v = /kf2v/.test(p.model);
    const isR2v = /r2v/.test(p.model);
    const body = {
        model: p.model,
        prompt: p.prompt,
        seconds: isKf2v ? "5" : String(p.duration ?? 5), // kf2v 时长固定为 5s
        size: (p.resolution ?? "").includes("1080") ? "1080P" : "720P",
    };
    if (p.negativePrompt)
        body.negative_prompt = p.negativePrompt;
    if (p.seed !== undefined)
        body.seed = p.seed;
    if (p.watermark !== undefined)
        body.watermark = p.watermark;
    if (isKf2v) {
        // 首尾帧专用模型：images 数组必须 2 张（首帧 + 尾帧）
        if (p.ref && p.lastFrame) {
            body.images = [imageInput(p.ref), imageInput(p.lastFrame)];
        }
    }
    else if (isR2v) {
        // 参考生视频：reference_image + reference_video + 可选 first_frame
        const media = [];
        if (p.ref) {
            const img = { type: "reference_image", url: imageInput(p.ref) };
            if (p.refAudio)
                img.reference_voice = imageInput(p.refAudio);
            media.push(img);
        }
        if (p.refVideo)
            media.push({ type: "reference_video", url: imageInput(p.refVideo) });
        if (p.lastFrame)
            media.push({ type: "first_frame", url: imageInput(p.lastFrame) });
        body.media = media;
    }
    else if (p.ref) {
        // wan2.7-i2v：media 数组
        const media = [{ type: "first_frame", url: imageInput(p.ref) }];
        if (p.lastFrame)
            media.push({ type: "last_frame", url: imageInput(p.lastFrame) });
        if (p.refAudio)
            media.push({ type: "driving_audio", url: imageInput(p.refAudio) });
        body.media = media;
    }
    applyExtra(body, p.extra);
    const data = await postJson(`${getBaseUrl()}/v1/videos`, body);
    const taskId = data.task_id || data.id;
    return taskId ? pollVideoTask(taskId, 900000) : data;
}
// Vidu：POST /vidu/ent/v2/{text2video|img2video|start-end2video}
// - 文生：text2video
// - 图生（首帧）：img2video，images 数组 1 张
// - 首尾帧：start-end2video，images 数组 2 张（images[0] 首帧 + images[1] 尾帧）
async function generateViduVideo(p) {
    const isStartEnd = !!(p.ref && p.lastFrame);
    const hasImage = !!p.ref;
    const body = {
        model: p.model,
        prompt: p.prompt,
        duration: p.duration ?? 5,
        resolution: p.resolution ?? "720p",
    };
    if (p.aspectRatio)
        body.aspect_ratio = p.aspectRatio;
    if (p.seed !== undefined)
        body.seed = p.seed;
    if (p.watermark !== undefined)
        body.watermark = p.watermark;
    if (p.generateAudio !== undefined)
        body.audio = p.generateAudio;
    if (isStartEnd) {
        body.images = [imageInput(p.ref), imageInput(p.lastFrame)];
    }
    else if (hasImage) {
        body.images = [imageInput(p.ref)];
    }
    applyExtra(body, p.extra);
    const endpoint = isStartEnd ? "/vidu/ent/v2/start-end2video" : (hasImage ? "/vidu/ent/v2/img2video" : "/vidu/ent/v2/text2video");
    const data = await postJson(`${getBaseUrl()}${endpoint}`, body);
    const taskId = data.task_id || data.id;
    return taskId ? pollViduTask(taskId, 300000, !!p.watermark) : data;
}
async function pollViduTask(taskId, timeoutMs, wantWatermark = false) {
    const start = Date.now();
    let attempts = 0;
    let netErrors = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        const data = await pollFetchJson(`${getBaseUrl()}/vidu/ent/v2/tasks/${taskId}/creations`);
        if (!data) {
            netErrors++;
            await sleep(pollDelay(attempts));
            continue;
        }
        if (data.state === "success") {
            const c = data.creations?.[0];
            // Vidu 主 url 无水印，带水印版本在 watermarked_url；传 --watermark 时取水印版
            const url = wantWatermark ? (c?.watermarked_url || c?.url) : c?.url;
            return { url, elapsed_ms: Date.now() - start };
        }
        if (data.state === "failed")
            throw new Error(data.err_code || "Vidu task failed");
        await sleep(pollDelay(attempts));
    }
    throw new Error(pollTimeoutMsg(taskId, timeoutMs, netErrors));
}
// HappyHorse：POST /ali/api/v1/services/aigc/video-generation/video-synthesis
async function generateHappyHorseVideo(p) {
    const input = {
        prompt: p.prompt,
        duration: p.duration ?? 5,
    };
    if (p.ref)
        input.media = [{ type: "first_frame", url: imageInput(p.ref) }];
    const body = { model: p.model, input };
    applyExtra(body, p.extra);
    const data = await postJson(`${getBaseUrl()}/ali/api/v1/services/aigc/video-generation/video-synthesis`, body);
    const taskId = data.task_id || data.id;
    return taskId ? pollHappyHorseTask(taskId, 300000) : data;
}
async function pollHappyHorseTask(taskId, timeoutMs) {
    const start = Date.now();
    let attempts = 0;
    let netErrors = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        const data = await pollFetchJson(`${getBaseUrl()}/ali/api/v1/tasks/${taskId}`);
        if (!data) {
            netErrors++;
            await sleep(pollDelay(attempts));
            continue;
        }
        if (data.task_status === "SUCCEEDED") {
            return { url: data.video_url, elapsed_ms: Date.now() - start };
        }
        if (data.task_status === "FAILED")
            throw new Error(data.message || "HappyHorse task failed");
        await sleep(pollDelay(attempts));
    }
    throw new Error(pollTimeoutMsg(taskId, timeoutMs, netErrors));
}
// 统一视频生成入口：按模型判断供应商并分派
export async function generateVideo(params) {
    const provider = videoProvider(params.model);
    if (provider === "hailuo")
        return generateHailuoVideo(params);
    if (provider === "minimax-h3")
        return generateMinimaxH3Video(params);
    if (provider === "kling")
        return generateKlingVideo(params);
    if (provider === "wan")
        return generateWanVideo(params);
    if (provider === "vidu")
        return generateViduVideo(params);
    if (provider === "happyhorse")
        return generateHappyHorseVideo(params);
    // Seedance：官方透传 /byteplus/api/v3/contents/generations/tasks
    return generateSeedanceNative(params);
}
function audioProvider(model) {
    const m = model.toLowerCase();
    if (m.startsWith("audio") || m.startsWith("vidu"))
        return "vidu";
    if (m.startsWith("qwen") || m.includes("tts"))
        return "ali";
    return "minimax";
}
export async function textToSpeech(params) {
    const provider = audioProvider(params.model);
    // Vidu 音频：POST /vidu/ent/v2/text2audio，异步任务
    if (provider === "vidu") {
        const body = {
            model: params.model,
            prompt: params.text,
            duration: params.duration ?? 10,
        };
        if (params.extra)
            Object.assign(body, params.extra);
        const data = await postJson(`${getBaseUrl()}/vidu/ent/v2/text2audio`, body);
        const taskId = data.task_id || data.id;
        return taskId ? pollViduTask(taskId, 120000) : data;
    }
    // MiniMax（默认）：POST /v1/audio/speech，同步返回 data.audio
    const body = {
        model: params.model,
        input: params.text,
        voice: params.voice ?? "Chinese (Mandarin)_Lyrical_Voice",
        response_format: "mp3",
        metadata: { output_format: "url" },
    };
    if (params.speed)
        body.speed = params.speed;
    if (params.extra)
        Object.assign(body, params.extra);
    const res = await fetch(`${getBaseUrl()}/v1/audio/speech`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        redirect: "manual",
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API ${res.status}: ${err}`);
    }
    // 非流式调用可能返回 302 + Location 头（音频 URL）
    const location = res.headers.get("location");
    if (location)
        return { url: location };
    // JSON 响应：音频 URL 在 data.audio，也可能是 base64（data.audio 为 hex）
    const data = await res.json();
    if (data.task_id)
        return pollTask(data.task_id, 60000);
    const audio = data?.data?.audio;
    if (typeof audio === "string" && /^https?:\/\//.test(audio)) {
        return { url: audio };
    }
    return data;
}
// ─── Seedance 官方透传（火山方舟原生协议）────────────────
// POST /byteplus/api/v3/contents/generations/tasks，content 数组（text / image_url / video_url / audio_url + role）
async function generateSeedanceNative(p) {
    // 字节 Seedance 所有素材（图片/视频/音频）必须先上传资产库拿到 asset_id，
    // 再以 asset://<asset_id> 格式传入 url 字段。
    // 三种场景互斥：首帧 / 首尾帧 / 多模态参考（含参考图/视频/音频）。
    // 当传入 ref-video / ref-audio 时判定为「多模态参考」场景，--ref 视为参考图（reference_image）；
    // 否则 --ref 视为首帧（first_frame）。
    const isMultimodal = !!(p.refVideo || p.refAudio);
    const content = [];
    if (p.prompt)
        content.push({ type: "text", text: p.prompt });
    if (p.ref) {
        const role = isMultimodal ? "reference_image" : "first_frame";
        content.push({ type: "image_url", image_url: { url: await resolveAssetRef(p.ref, p.assetGroupId) }, role });
    }
    if (p.lastFrame)
        content.push({ type: "image_url", image_url: { url: await resolveAssetRef(p.lastFrame, p.assetGroupId) }, role: "last_frame" });
    if (p.refVideo)
        content.push({ type: "video_url", video_url: { url: await resolveAssetRef(p.refVideo, p.assetGroupId) }, role: "reference_video" });
    if (p.refAudio)
        content.push({ type: "audio_url", audio_url: { url: await resolveAssetRef(p.refAudio, p.assetGroupId) }, role: "reference_audio" });
    const body = {
        model: p.model,
        content,
        duration: p.duration ?? 5,
        resolution: p.resolution ?? "720p",
        ratio: p.ratio ?? "adaptive",
    };
    if (p.generateAudio !== undefined)
        body.generate_audio = p.generateAudio;
    if (p.watermark !== undefined)
        body.watermark = p.watermark;
    if (p.seed !== undefined)
        body.seed = p.seed;
    applyExtra(body, p.extra);
    const data = await postJson(`${getBaseUrl()}/byteplus/api/v3/contents/generations/tasks`, body);
    const taskId = data.task_id || data.id;
    return taskId ? pollSeedanceNativeTask(taskId, 300000) : data;
}
async function pollSeedanceNativeTask(taskId, timeoutMs) {
    const start = Date.now();
    let attempts = 0;
    let netErrors = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        const data = await pollFetchJson(`${getBaseUrl()}/byteplus/api/v3/contents/generations/tasks/${taskId}`);
        if (!data) {
            netErrors++;
            await sleep(pollDelay(attempts));
            continue;
        }
        if (data.status === "succeeded") {
            return { url: data.content?.video_url, elapsed_ms: Date.now() - start };
        }
        if (data.status === "failed" || data.status === "expired") {
            throw new Error(data.error?.message || data.message || "Seedance task failed");
        }
        await sleep(pollDelay(attempts));
    }
    throw new Error(pollTimeoutMsg(taskId, timeoutMs, netErrors));
}
// ─── Asset Library（资产库）────────────────────────────
// 资产库与生成类 API 是不同域名，但从生成类域名可推导：
//   生成类 API: api.powertokens.ai       → 资产库 powertokens.ai/api（生产）
//   生成类 API: baze-api.powerbuyin.top   → 资产库 baze.powerbuyin.top/api（测试）
// 规则：去掉域名里的 "api" 前缀（或 "-api" 后缀），再加 "/api" 路径前缀。
// 也可通过 POWERTOKENS_ASSET_BASE_URL 环境变量直接覆盖。
function assetBaseUrl() {
    const configured = getAssetBaseUrl(); // 环境变量或配置文件里的资产库地址
    if (configured)
        return configured;
    const base = getBaseUrl();
    const url = new URL(base);
    const host = url.host.replace(/^api\./, "").replace(/-api\./, ".");
    return `${url.protocol}//${host}/api`;
}
function assetHeaders(key) {
    // 资产库端点要求直接传 token，不带 "Bearer " 前缀（与生成类 API 不同）
    return {
        Authorization: key,
        "User-Agent": "powertokensAi",
        Accept: "application/json",
    };
}
export async function uploadAsset(filePath, groupId) {
    const key = getApiKey();
    if (!key)
        throw new Error("未配置 API Key。运行: pt login");
    const data = fs.readFileSync(filePath);
    const form = new FormData();
    form.append("file", new Blob([data]), safeAssetName(path.basename(filePath)));
    if (groupId)
        form.append("group_id", groupId);
    const res = await fetch(`${assetBaseUrl()}/v1/asset/upload`, {
        method: "POST",
        headers: assetHeaders(key),
        body: form,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`素材上传失败 ${res.status}: ${err}`);
    }
    const resp = await res.json();
    const taskId = resp.data?.task_id ?? resp.task_id;
    if (!taskId)
        throw new Error(`素材上传未返回 task_id: ${JSON.stringify(resp)}`);
    return pollAssetId(taskId);
}
// 资产库文件名长度实测限制：45 字符成功、50 字符报错（"Name must be no more than 64 characters"）。
// 服务端会拼接额外信息，故取保守值 40 留足余量。
function safeAssetName(name) {
    const MAX = 40;
    if (name.length <= MAX)
        return name;
    const ext = path.extname(name); // 含点，如 ".jpeg"
    const base = path.basename(name, ext);
    const keep = MAX - ext.length;
    return base.slice(0, keep) + ext;
}
async function pollAssetId(taskId, timeoutMs = 120000) {
    const start = Date.now();
    let attempts = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        try {
            const res = await fetchWithRetry(`${assetBaseUrl()}/v1/asset/jobs/get-asset-id?task_id=${encodeURIComponent(taskId)}`, { headers: { "User-Agent": "powertokensAi" } }, 2, 30000);
            if (res.ok) {
                const data = await res.json();
                const assetId = data?.data?.asset_id ?? data?.asset_id;
                if (data?.code === 200 && assetId)
                    return assetId;
            }
        }
        catch {
            // 网络抖动：不中断轮询
        }
        await sleep(pollDelay(attempts));
    }
    throw new Error(`获取 asset_id 超时（${timeoutMs / 1000}s）`);
}
// 字节素材 url 字段支持三种格式：asset://、公网 URL、Base64 data URL。
// 本地文件路径自动上传资产库拿到 asset_id，其余（asset:// / URL / data:）原样返回。
let tempSeq = 0;
// 解析素材引用：字节 Seedance 的所有素材（图片/视频/音频）必须走资产库上传做人像/授信校验，
// 唯一豁免是已上传的 asset:// 路径。URL / Base64 / 本地文件一律先落盘再上传。
export async function resolveAssetRef(ref, groupId) {
    if (!ref)
        return "";
    if (ref.startsWith("asset://"))
        return ref; // 已上传，原样返回
    let localFile = ref;
    let isTemp = false;
    if (/^https?:\/\//i.test(ref)) {
        // 公网 URL：下载到临时文件再上传
        const res = await fetch(ref);
        if (!res.ok)
            throw new Error(`下载素材失败 ${res.status}: ${ref}`);
        const ext = path.extname(new URL(ref).pathname);
        localFile = path.join(os.tmpdir(), `pt-upload-${Date.now()}-${tempSeq++}${ext}`);
        fs.writeFileSync(localFile, Buffer.from(await res.arrayBuffer()));
        isTemp = true;
    }
    else if (/^data:/.test(ref)) {
        // Base64 data URL：解码到临时文件再上传
        const m = /^data:([^;]+);base64,(.+)$/.exec(ref);
        if (!m)
            throw new Error("无效的 data URL");
        const ext = "." + (m[1].split("/")[1] || "bin");
        localFile = path.join(os.tmpdir(), `pt-upload-${Date.now()}-${tempSeq++}${ext}`);
        fs.writeFileSync(localFile, Buffer.from(m[2], "base64"));
        isTemp = true;
    }
    else if (!fs.existsSync(ref)) {
        if (/\.(jpe?g|png|webp|bmp|tiff|gif|mp4|mov|wav|mp3)$/i.test(ref) || /[/\\]/.test(ref)) {
            throw new Error(`文件不存在: ${ref}`);
        }
        return `asset://${ref}`; // 假定已是裸 asset_id，补前缀
    }
    try {
        const id = await uploadAsset(localFile, groupId);
        return `asset://${id}`;
    }
    finally {
        if (isTemp) {
            try {
                fs.unlinkSync(localFile);
            }
            catch { }
        }
    }
}
// 判断模型是否「多模态」（同时支持图片和视频生成）。
// 这类模型仅凭 id 无法确定用户意图，需配合参数分流。
export function isMultimodalModel(id) {
    const lower = id.toLowerCase();
    // kling-v3 / kling-v3-omni：既支持 image-generation 又支持 openai-video
    return lower === "kling-v3" || lower === "kling-v3-omni";
}
// 根据 supported_endpoint_types + id 模式推断模型类别
export function classifyModel(id, endpointTypes = []) {
    // image-generation 优先于 openai-video：kling-v3/kling-v3-omni 同时含两者，
    // 但文档归在 image（Kling Image Omni），且纯视频模型不会带 image-generation。
    if (endpointTypes.includes("image-generation"))
        return "image";
    if (endpointTypes.includes("openai-video"))
        return "video";
    const lower = id.toLowerCase();
    // 音频
    if (lower.startsWith("speech-") || lower.includes("tts") || lower === "audio1.0")
        return "audio";
    // 视频（Vidu / Seedance / Hailuo / MiniMax-H3 / t2v·i2v·r2v·kf2v / kling-video / kling-*-master|turbo）
    if (lower.startsWith("viduq") ||
        lower.includes("seedance") ||
        lower.includes("hailuo") ||
        lower.includes("h3") ||
        /(t2v|i2v|r2v|kf2v)/.test(lower) ||
        lower.includes("video") ||
        (lower.startsWith("kling") && (lower.includes("-master") || lower.includes("-turbo"))))
        return "video";
    // 图像
    if (lower.startsWith("image-") ||
        lower.includes("seedream") ||
        lower.includes("image") ||
        lower.startsWith("kling-image") ||
        (lower.startsWith("kling") && !lower.includes("video")))
        return "image";
    return "chat";
}
function providerName(ownedBy, id) {
    if (ownedBy === "custom") {
        if (id.startsWith("kling"))
            return "Kuaishou";
        if (id.startsWith("vidu") || id.startsWith("audio"))
            return "Vidu";
        if (id.startsWith("wan"))
            return "Alibaba";
    }
    const map = {
        deepseek: "DeepSeek",
        byteplus: "BytePlus",
        zhipu_4v: "Z.ai",
        ali: "Alibaba",
        minimax: "MiniMax",
        "minimax-overseas": "MiniMax",
        mimo: "MiMo",
    };
    return map[ownedBy] ?? ownedBy;
}
// 动态获取模型列表：GET /v1/models，带 5 分钟缓存，失败回退到内置列表
let modelsCache = null;
export async function listModels(force = false) {
    if (!force && modelsCache && Date.now() - modelsCache.ts < 60 * 60 * 1000) {
        return modelsCache.data;
    }
    try {
        const res = await fetch(`${getBaseUrl()}/v1/models`, { headers: headers() });
        if (res.ok) {
            const json = await res.json();
            const items = json?.data ?? [];
            if (Array.isArray(items) && items.length > 0) {
                const data = items.map((m) => {
                    const types = [classifyModel(m.id, m.supported_endpoint_types ?? [])];
                    // 多模态模型（kling-v3 / kling-v3-omni）同时支持图片和视频
                    if (isMultimodalModel(m.id)) {
                        if (!types.includes("image"))
                            types.push("image");
                        if (!types.includes("video"))
                            types.push("video");
                    }
                    return {
                        id: m.id,
                        name: m.id,
                        types,
                        endpointTypes: m.supported_endpoint_types ?? [],
                        provider: providerName(m.owned_by ?? "", m.id),
                        price: "",
                    };
                });
                modelsCache = { data, ts: Date.now() };
                return data;
            }
        }
    }
    catch {
        // 网络失败或未登录时回退到内置列表
    }
    return getModels();
}
export function getModels() {
    return [
        { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", types: ["chat"], provider: "DeepSeek", price: "$0.435/$0.870" },
        { id: "glm-5", name: "GLM-5", types: ["chat"], provider: "Z.ai", price: "$0.97/$3.10" },
        { id: "glm-4.7", name: "GLM-4.7", types: ["chat"], provider: "Z.ai", price: "$0.60/$2.20" },
        { id: "glm-4.5-air", name: "GLM-4.5 Air", types: ["chat"], provider: "Z.ai", price: "$0.20/$1.10" },
        { id: "glm-4.7-flash", name: "GLM-4.7 Flash", types: ["chat"], provider: "Z.ai", price: "FREE 🆓" },
        { id: "MiniMax-M2.5", name: "MiniMax M2.5", types: ["chat"], provider: "MiniMax", price: "" },
        { id: "qwen3-max", name: "Qwen3 Max", types: ["chat"], provider: "Alibaba", price: "" },
        { id: "MiniMax-M3", name: "MiniMax M3", types: ["chat"], provider: "MiniMax", price: "" },
        { id: "seedream-5-0-260128", name: "Seedream 5.0", types: ["image"], provider: "BytePlus", price: "$0.034/img" },
        { id: "seedream-4-5-251128", name: "Seedream 4.5", types: ["image"], provider: "BytePlus", price: "$0.038/img" },
        { id: "wan2.7-image-pro", name: "Wan 2.7 Image Pro", types: ["image"], provider: "Alibaba", price: "" },
        { id: "dreamina-seedance-2-0-260128", name: "Seedance 2.0", types: ["video"], provider: "BytePlus", price: "$2.64-8.47" },
        { id: "dreamina-seedance-2-0-fast-260128", name: "Seedance 2.0 Fast", types: ["video"], provider: "BytePlus", price: "$3.63-6.16" },
        { id: "seedance-1-5-pro-251215", name: "Seedance 1.5 Pro", types: ["video"], provider: "BytePlus", price: "$1.20-2.28" },
        { id: "kling-video-o1", name: "Kling Video O1", types: ["video"], provider: "Kuaishou", price: "" },
        { id: "MiniMax-Hailuo-02", name: "Hailuo 02", types: ["video"], provider: "MiniMax", price: "" },
        { id: "speech-2.6-hd", name: "MiniMax Speech 2.6 HD", types: ["audio"], provider: "MiniMax", price: "" },
        { id: "speech-02-hd", name: "MiniMax Speech 02 HD", types: ["audio"], provider: "MiniMax", price: "" },
    ];
}
async function pollTask(taskId, timeoutMs) {
    const start = Date.now();
    let attempts = 0;
    let netErrors = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        const data = await pollFetchJson(`${getBaseUrl()}/v1/tasks/${taskId}`);
        if (!data) {
            netErrors++;
            await sleep(pollDelay(attempts));
            continue;
        }
        if (data.status === "completed" || data.status === "succeeded") {
            return { ...data, elapsed_ms: Date.now() - start };
        }
        if (data.status === "failed" || data.status === "error") {
            throw new Error(data.error || data.message || "Task failed");
        }
        await sleep(pollDelay(attempts));
    }
    throw new Error(pollTimeoutMsg(taskId, timeoutMs, netErrors));
}
// 视频任务轮询：走 /v1/videos/{task_id}（与 /v1/tasks 不同），
// 成功状态为 completed，视频 URL 在 metadata.url。
async function pollVideoTask(taskId, timeoutMs) {
    const start = Date.now();
    let attempts = 0;
    let lastProgress = -1;
    let netErrors = 0;
    while (Date.now() - start < timeoutMs) {
        attempts++;
        const data = await pollFetchJson(`${getBaseUrl()}/v1/videos/${taskId}`);
        if (!data) {
            netErrors++;
            await sleep(pollDelay(attempts));
            continue;
        }
        if (typeof data.progress === "number" && data.progress !== lastProgress) {
            lastProgress = data.progress;
            console.error(`  [pt] ${data.status ?? "processing"}: ${data.progress}%`);
        }
        if (data.status === "completed" || data.status === "succeeded") {
            return {
                ...data,
                url: data.metadata?.url ?? data.url ?? data.video_url ?? data.content?.video_url,
                elapsed_ms: Date.now() - start,
            };
        }
        if (data.status === "failed" || data.status === "error" || data.status === "cancelled" || data.status === "expired") {
            throw new Error(data.error?.message || data.message || data.error || "Task failed");
        }
        await sleep(pollDelay(attempts));
    }
    throw new Error(pollTimeoutMsg(taskId, timeoutMs, netErrors));
}
