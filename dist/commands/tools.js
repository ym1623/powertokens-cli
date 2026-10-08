import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { getApiKey, getBaseUrl } from "../config.js";
function headers() {
    const key = getApiKey();
    if (!key)
        throw new Error("未配置 API Key。运行: pt login");
    return {
        Authorization: `Bearer ${key}`,
        "User-Agent": "PowerTokens-CLI/1.0",
        Accept: "application/json",
    };
}
async function pollTask(baseUrl, taskId, timeoutMs = 120_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const r = await fetch(`${baseUrl}/v1/tools/tasks/${taskId}`, { headers: headers() });
        if (!r.ok)
            throw new Error(`poll ${r.status}: ${await r.text()}`);
        const j = await r.json();
        if (j.status === "succeeded")
            return j;
        if (j.status === "failed")
            throw new Error(`task failed: ${j.error?.message || JSON.stringify(j.error)}`);
        await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error("poll timeout");
}
export async function toolsBgRemoveCmd(options) {
    const key = getApiKey();
    if (!key) {
        console.log(chalk.red("❌ Not logged in. Run: pt login"));
        return;
    }
    const baseUrl = getBaseUrl();
    const spinner = (await import("ora")).default;
    let spin = spinner("Uploading...").start();
    try {
        let submitRes;
        if (options.imageUrl) {
            const r = await fetch(`${baseUrl}/v1/tools/image-bg-remover`, {
                method: "POST",
                headers: { ...headers(), "Content-Type": "application/json" },
                body: JSON.stringify({ image_url: options.imageUrl }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) {
                spin.fail(`Failed ${r.status}: ${j.message || j.code || JSON.stringify(j)}`);
                if (r.status === 429)
                    console.log(chalk.yellow(`  quota_exhausted → ${j.cta || "/pricing"}`));
                return;
            }
            submitRes = j;
        }
        else {
            const input = options.input;
            if (!input) {
                spin.fail("No input. Use -i <path> or --image-url <url>");
                console.log(chalk.gray("  example: pt tools bg-remove -i input.jpg -o out.png"));
                return;
            }
            if (!fs.existsSync(input)) {
                spin.fail(`File not found: ${input}`);
                return;
            }
            const stat = fs.statSync(input);
            if (stat.size > 10 * 1024 * 1024) {
                spin.fail("File too large (>10MB)");
                return;
            }
            const fd = new FormData();
            const blob = new Blob([fs.readFileSync(input)]);
            fd.append("image", blob, path.basename(input));
            const h = headers();
            delete h["Content-Type"];
            const r = await fetch(`${baseUrl}/v1/tools/image-bg-remover`, { method: "POST", headers: h, body: fd });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) {
                spin.fail(`Failed ${r.status}: ${j.message || j.code || JSON.stringify(j)}`);
                if (r.status === 429)
                    console.log(chalk.yellow(`  quota_exhausted → ${j.cta || "/pricing"}`));
                return;
            }
            submitRes = j;
        }
        if (submitRes.status === "succeeded" && submitRes.output_url) {
            spin.succeed(`Done (sync) task=${submitRes.task_id}`);
            const outUrl = submitRes.output_url.startsWith("http") ? submitRes.output_url : `${baseUrl}${submitRes.output_url}`;
            if (options.output) {
                spin = spinner("Downloading...").start();
                const r = await fetch(outUrl, { headers: headers() });
                if (!r.ok)
                    throw new Error(`download ${r.status}: ${await r.text()}`);
                const buf = Buffer.from(await r.arrayBuffer());
                fs.writeFileSync(options.output, buf);
                spin.succeed(chalk.green(`✅ Saved to ${options.output} (${buf.length} bytes) - PNG transparent`));
            }
            else {
                console.log(chalk.green(`✅ ${outUrl}`));
            }
            if (submitRes.quota)
                console.log(chalk.gray(`  quota remaining: ${submitRes.quota.remaining}`));
            return;
        }
        const taskId = submitRes.task_id;
        spin.text = `Processing ${taskId} ...`;
        const result = await pollTask(baseUrl, taskId);
        spin.succeed(`Done task=${taskId}`);
        const outUrl = result.output_url.startsWith("http") ? result.output_url : `${baseUrl}${result.output_url}`;
        if (options.output) {
            spin = spinner("Downloading...").start();
            const r = await fetch(outUrl, { headers: headers() });
            if (!r.ok)
                throw new Error(`download ${r.status}: ${await r.text()}`);
            const buf = Buffer.from(await r.arrayBuffer());
            fs.writeFileSync(options.output, buf);
            spin.succeed(chalk.green(`✅ Saved to ${options.output} (${buf.length} bytes) - PNG transparent`));
        }
        else {
            console.log(chalk.green(`✅ ${outUrl}`));
        }
    }
    catch (e) {
        spin.fail(chalk.red(`❌ ${e.message || String(e)}`));
    }
}
export async function toolsUpscaleCmd(options) {
    const key = getApiKey();
    if (!key) {
        console.log(chalk.red("❌ Not logged in. Run: pt login"));
        return;
    }
    const scale = options.scale ? parseInt(options.scale, 10) : 2;
    if (scale !== 2 && scale !== 4) {
        console.log(chalk.red("❌ --scale must be 2 or 4"));
        return;
    }
    const baseUrl = getBaseUrl();
    const spinner = (await import("ora")).default;
    let spin = spinner("Uploading...").start();
    try {
        let submitRes;
        if (options.imageUrl) {
            // JSON path
            const r = await fetch(`${baseUrl}/v1/tools/image-upscale`, {
                method: "POST",
                headers: { ...headers(), "Content-Type": "application/json" },
                body: JSON.stringify({ image_url: options.imageUrl, scale, face_enhance: !!options.faceEnhance }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) {
                spin.fail(`Failed ${r.status}: ${j.message || j.code || JSON.stringify(j)}`);
                if (r.status === 429)
                    console.log(chalk.yellow(`  quota_exhausted → ${j.cta || "/pricing"}`));
                return;
            }
            submitRes = j;
        }
        else {
            const input = options.input;
            if (!input) {
                spin.fail("No input. Use -i <path> or --image-url <url>");
                console.log(chalk.gray("  example: pt tools upscale -i input.jpg -s 2 -o out.png"));
                return;
            }
            if (!fs.existsSync(input)) {
                spin.fail(`File not found: ${input}`);
                return;
            }
            const stat = fs.statSync(input);
            if (stat.size > 10 * 1024 * 1024) {
                spin.fail("File too large (>10MB)");
                return;
            }
            const fd = new FormData();
            const blob = new Blob([fs.readFileSync(input)]);
            fd.append("image", blob, path.basename(input));
            fd.append("scale", String(scale));
            if (options.faceEnhance)
                fd.append("face_enhance", "true");
            // fetch with FormData: let runtime set boundary, drop Content-Type from headers
            const h = headers();
            delete h["Content-Type"];
            const r = await fetch(`${baseUrl}/v1/tools/image-upscale`, {
                method: "POST",
                headers: h,
                body: fd,
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) {
                spin.fail(`Failed ${r.status}: ${j.message || j.code || JSON.stringify(j)}`);
                if (r.status === 429)
                    console.log(chalk.yellow(`  quota_exhausted → ${j.cta || "/pricing"}`));
                return;
            }
            submitRes = j;
        }
        // sync direct return
        if (submitRes.status === "succeeded" && submitRes.output_url) {
            spin.succeed(`Done (sync) task=${submitRes.task_id}`);
            if (options.output) {
                spin = spinner("Downloading...").start();
                const outUrl = submitRes.output_url.startsWith("http") ? submitRes.output_url : `${baseUrl}${submitRes.output_url}`;
                const r = await fetch(outUrl, { headers: headers() });
                if (!r.ok)
                    throw new Error(`download ${r.status}: ${await r.text()}`);
                const buf = Buffer.from(await r.arrayBuffer());
                fs.writeFileSync(options.output, buf);
                spin.succeed(chalk.green(`✅ Saved to ${options.output} (${buf.length} bytes)`));
            }
            else {
                console.log(chalk.green(`✅ ${submitRes.output_url}`));
            }
            if (submitRes.quota)
                console.log(chalk.gray(`  quota remaining: ${submitRes.quota.remaining}`));
            return;
        }
        // async poll
        const taskId = submitRes.task_id;
        spin.text = `Processing ${taskId} ...`;
        const result = await pollTask(baseUrl, taskId);
        spin.succeed(`Done task=${taskId}`);
        const outUrl = result.output_url.startsWith("http") ? result.output_url : `${baseUrl}${result.output_url}`;
        if (options.output) {
            spin = spinner("Downloading...").start();
            const r = await fetch(outUrl, { headers: headers() });
            if (!r.ok)
                throw new Error(`download ${r.status}: ${await r.text()}`);
            const buf = Buffer.from(await r.arrayBuffer());
            fs.writeFileSync(options.output, buf);
            spin.succeed(chalk.green(`✅ Saved to ${options.output} (${buf.length} bytes)`));
        }
        else {
            console.log(chalk.green(`✅ ${outUrl}`));
        }
    }
    catch (e) {
        spin.fail(chalk.red(`❌ ${e.message || String(e)}`));
    }
}
