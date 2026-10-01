import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { chromium } from '@playwright/test';

interface Scene {
    id: string;
    title: string;
    narration: string;
    htmlContent: string;
}

const SCENES: Scene[] = [
    {
        id: 'scene-1',
        title: 'The Centralized Trap vs. Zero-Knowledge S3',
        narration: 'When building modern web and mobile applications, we are often told to rely on centralized backend-as-a-service platforms like Supabase or Firebase. But what happens when the network drops? Your app freezes. What happens when your database server gets hacked? All your users unencrypted data leaks. Meet Sovereign Sync: a zero-server, offline-first storage library. Every byte of data is stored in a local, relational SQLite database inside your browser, encrypted with modern X25519 and AES-256-GCM cryptography, and synchronized directly with any standard S3 bucket or via peer-to-peer WebRTC. Zero application servers. Zero unencrypted data on the cloud. 100 percent offline resilience.',
        htmlContent: `
        <div class="slide">
            <div class="badge-pill">SovereignS3nc v3.2.0</div>
            <h1 class="hero-title">Zero-Trust. Offline-First.</h1>
            <p class="hero-subtitle">Client-to-Storage Relational Engine for S3 & WebRTC</p>

            <div class="split-grid">
                <div class="card danger-card">
                    <div class="card-tag">Traditional Centralized BaaS</div>
                    <h3>The Centralized Trap</h3>
                    <ul>
                        <li><span class="icon">❌</span> Server reads all user data in plaintext</li>
                        <li><span class="icon">❌</span> App freezes or writes fail when offline</li>
                        <li><span class="icon">❌</span> Expensive dedicated database servers ($25–$500/mo)</li>
                        <li><span class="icon">❌</span> Proprietary vendor lock-in</li>
                    </ul>
                </div>

                <div class="vs-badge">VS</div>

                <div class="card success-card">
                    <div class="card-tag">SovereignS3nc Architecture</div>
                    <h3>The Sovereign Solution</h3>
                    <ul>
                        <li><span class="icon">✅</span> <strong>Zero-Knowledge E2EE</strong> (X25519 + AES-256-GCM)</li>
                        <li><span class="icon">✅</span> <strong>100% Offline-First</strong> (Relational SQLite WASM)</li>
                        <li><span class="icon">✅</span> <strong>Serverless Commodity S3</strong> ($0.015/GB or Cloudflare R2)</li>
                        <li><span class="icon">✅</span> <strong>Serverless P2P Gossip</strong> (Native WebRTC Mesh)</li>
                    </ul>
                </div>
            </div>

            <div class="footer-stats">
                <div class="stat"><span class="val">0</span> Application Servers</div>
                <div class="stat"><span class="val">100%</span> Data Sovereignty</div>
                <div class="stat"><span class="val">&lt; 1ms</span> Local Read Latency</div>
                <div class="stat"><span class="val">11 9's</span> S3 Durability</div>
            </div>
        </div>
        `
    },
    {
        id: 'scene-2',
        title: 'Live Code: 60-Second Reactive Notes App',
        narration: 'Let us build a fully syncing, encrypted notes application in under 60 seconds. First, we install Sovereign Sync and the Sovereign Sync React package. We wrap our application with SovereignProvider, specifying our user credentials and S3 endpoint. Now, we use the useRepository hook to read and write notes directly into local SQLite. Every time create is called, our note is instantly saved to local IndexedDB and committed to our daily SQLite partition in microseconds. No waiting for server round-trips.',
        htmlContent: `
        <div class="slide">
            <div class="badge-pill">Developer Experience</div>
            <h1 class="hero-title">Reactive React Hooks</h1>
            <p class="hero-subtitle">Build encrypted, offline-first apps with @sovereigns3nc/react</p>

            <div class="code-terminal">
                <div class="terminal-header">
                    <span class="dot red"></span>
                    <span class="dot yellow"></span>
                    <span class="dot green"></span>
                    <span class="terminal-title">Terminal</span>
                </div>
                <div class="terminal-body">
                    <span class="prompt">$</span> npm install sovereigns3nc @sovereigns3nc/react
                </div>
            </div>

            <div class="code-editor">
                <div class="editor-header">
                    <span class="file-tab">App.tsx</span>
                </div>
                <pre class="code-snippet"><code><span class="kw">import</span> React, { useState } <span class="kw">from</span> <span class="str">'react'</span>;
<span class="kw">import</span> { SovereignProvider, useRepository } <span class="kw">from</span> <span class="str">'@sovereigns3nc/react'</span>;

<span class="kw">function</span> <span class="fn">NotesApp</span>() {
  <span class="kw">const</span> { data: notes, create } = <span class="fn">useRepository</span>&lt;<span class="type">Note</span>&gt;(<span class="str">'notes'</span>);
  <span class="kw">const</span> [text, setText] = <span class="fn">useState</span>(<span class="str">''</span>);

  <span class="kw">const</span> <span class="fn">handleAdd</span> = () =&gt; {
    <span class="fn">create</span>({ id: <span class="str">'note-'</span> + Date.now(), title: text, updatedAt: Date.now() });
    <span class="fn">setText</span>(<span class="str">''</span>);
  };

  <span class="kw">return</span> (
    &lt;<span class="tag">div</span> className=<span class="str">"vault"</span>&gt;
      &lt;<span class="tag">h2</span>&gt;🔒 Encrypted Offline Notes&lt;/<span class="tag">h2</span>&gt;
      &lt;<span class="tag">input</span> value={text} onChange={e =&gt; <span class="fn">setText</span>(e.target.value)} /&gt;
      &lt;<span class="tag">button</span> onClick={handleAdd}&gt;Save to Local SQLite&lt;/<span class="tag">button</span>&gt;
      &lt;<span class="tag">ul</span>&gt;{notes.map(n =&gt; &lt;<span class="tag">li</span> key={n.id}&gt;{n.title}&lt;/<span class="tag">li</span>&gt;)}&lt;/<span class="tag">ul</span>&gt;
    &lt;/<span class="tag">div</span>&gt;
  );
}</code></pre>
            </div>
        </div>
        `
    },
    {
        id: 'scene-3',
        title: 'Airplane Mode & Multi-Device Sync',
        narration: 'Let us test offline mode. We turn off Wi-Fi in DevTools. We add notes, modify existing ones, and reorder them. The app responds instantly because everything runs against local SQLite WebAssembly. Now, we re-enable network connectivity. In the background, Sovereign Sync worker engine wakes up, generates an incremental Merkle manifest, and pushes only the changed partitions to S3. Opening the S3 console reveals what the cloud provider sees: salted private GUIDs and pure AES-256-GCM ciphertext. The storage provider knows nothing about your notes.',
        htmlContent: `
        <div class="slide">
            <div class="badge-pill">Sync & Encryption</div>
            <h1 class="hero-title">Offline Flight & Zero-Knowledge S3</h1>
            <p class="hero-subtitle">Continuous availability with background Merkle-tree synchronization</p>

            <div class="pipeline-grid">
                <div class="step-card">
                    <div class="step-badge">Phase 1</div>
                    <div class="step-icon">✈️</div>
                    <h4>Airplane Mode Active</h4>
                    <p>Network offline. User reads and mutates local records. Zero latency, instant SQLite WASM transaction commit.</p>
                    <div class="tag-status offline">Local Status: Offline 100% Functional</div>
                </div>

                <div class="arrow-connector">➔</div>

                <div class="step-card">
                    <div class="step-badge">Phase 2</div>
                    <div class="step-icon">🌲</div>
                    <h4>Merkle Tree Diff</h4>
                    <p>Network reconnects. Background Worker computes sub-manifest hashes, skipping unchanged daily partitions.</p>
                    <div class="tag-status sync">Incremental Delta Sync</div>
                </div>

                <div class="arrow-connector">➔</div>

                <div class="step-card">
                    <div class="step-badge">Phase 3</div>
                    <div class="step-icon">☁️</div>
                    <h4>Zero-Knowledge S3</h4>
                    <p>Cloud provider only ever sees salted private GUIDs and encrypted ciphertext blobs. Zero metadata correlation.</p>
                    <div class="tag-status secure">AES-256-GCM Zero Knowledge</div>
                </div>
            </div>

            <div class="s3-preview">
                <div class="s3-header">☁️ AWS S3 / Cloudflare R2 Bucket View</div>
                <div class="s3-code">
                    <span>s3://sovereign-vault/8f2a1b9c-44e2/2026-10-01/private.sqlite.enc</span>
                    <span class="cipher-pill">CIPHERTEXT (AES-256-GCM)</span>
                </div>
            </div>
        </div>
        `
    },
    {
        id: 'scene-4',
        title: 'Production Ready: 5 Live Demos & Call to Action',
        narration: 'Sovereign Sync gives you the simplicity of serverless object storage, the speed of local SQLite, and the security of zero-trust end-to-end encryption. Try out our five live demo apps—including full Kanban boards, encrypted feeds, and multi-user messaging—right now in your browser. Install Sovereign Sync today from npm and check out the documentation. Take control of your users data sovereignty!',
        htmlContent: `
        <div class="slide">
            <div class="badge-pill">Ecosystem</div>
            <h1 class="hero-title">Ready for Any Application</h1>
            <p class="hero-subtitle">Five comprehensive demo applications included out of the box</p>

            <div class="demos-grid">
                <div class="demo-card">
                    <div class="demo-icon">💬</div>
                    <h4>Sovereign Social</h4>
                    <p>E2EE messaging, public feeds, nested replies, image attachments, and user discovery.</p>
                </div>
                <div class="demo-card">
                    <div class="demo-icon">📋</div>
                    <h4>Sovereign Board</h4>
                    <p>Collaborative Kanban boards powered by field-level CRDT conflict resolution.</p>
                </div>
                <div class="demo-card">
                    <div class="demo-icon">💳</div>
                    <h4>Banky-Sov</h4>
                    <p>Encrypted personal banking, budgets, transaction analytics, and ledger sync.</p>
                </div>
                <div class="demo-card">
                    <div class="demo-icon">✍️</div>
                    <h4>Sovereign Blog</h4>
                    <p>Markdown publishing CMS with static site export and decentralized reader mode.</p>
                </div>
                <div class="demo-card">
                    <div class="demo-icon">🌐</div>
                    <h4>Social Local</h4>
                    <p>100% serverless peer-to-peer WebRTC gossip mesh without any cloud dependency.</p>
                </div>
            </div>

            <div class="cta-box">
                <div class="cta-command">npm install sovereigns3nc @sovereigns3nc/react</div>
                <div class="cta-links">
                    <span>📖 Docs: https://tonym128.github.io/SovereignS3nc/</span>
                    <span>⭐ GitHub: tonym128/SovereignS3nc</span>
                </div>
            </div>
        </div>
        `
    }
];

const BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
body { width: 1920px; height: 1080px; background: #0a0d13; color: #f0f6fc; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.slide { width: 1720px; height: 940px; background: #111622; border: 1px solid #30363d; border-radius: 24px; padding: 60px 80px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 20px 60px rgba(0,0,0,0.6); position: relative; }
.badge-pill { align-self: flex-start; background: rgba(56, 139, 253, 0.15); border: 1px solid #388bfd; color: #58a6ff; padding: 6px 18px; border-radius: 9999px; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
.hero-title { font-size: 56px; font-weight: 800; margin-top: 14px; background: linear-gradient(90deg, #ffffff, #58a6ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.hero-subtitle { font-size: 24px; color: #8b949e; margin-top: 8px; margin-bottom: 30px; }
.split-grid { display: flex; gap: 40px; align-items: stretch; margin-top: 10px; }
.card { flex: 1; background: #161b26; border-radius: 18px; padding: 36px; border: 1px solid #21262d; display: flex; flex-direction: column; gap: 16px; }
.danger-card { border-color: rgba(248, 81, 73, 0.3); background: rgba(248, 81, 73, 0.04); }
.success-card { border-color: rgba(63, 185, 80, 0.3); background: rgba(63, 185, 80, 0.04); }
.card-tag { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; color: #8b949e; }
.danger-card .card-tag { color: #f85149; }
.success-card .card-tag { color: #3fb950; }
.card h3 { font-size: 28px; font-weight: 700; }
.card ul { list-style: none; display: flex; flex-direction: column; gap: 14px; margin-top: 10px; }
.card li { font-size: 20px; display: flex; align-items: center; gap: 12px; color: #c9d1d9; }
.vs-badge { align-self: center; background: #21262d; color: #8b949e; border-radius: 50%; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; border: 1px solid #30363d; flex-shrink: 0; }
.footer-stats { display: flex; justify-content: space-around; background: #161b26; border: 1px solid #21262d; border-radius: 14px; padding: 20px 40px; margin-top: 30px; }
.stat { font-size: 20px; color: #8b949e; }
.stat .val { font-size: 26px; font-weight: 800; color: #58a6ff; margin-right: 6px; }

/* Code scene */
.code-terminal { background: #0d1117; border: 1px solid #30363d; border-radius: 12px; padding: 14px 20px; font-family: monospace; font-size: 20px; margin-bottom: 20px; }
.terminal-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.dot { width: 12px; height: 12px; border-radius: 50%; }
.dot.red { background: #ff5f56; }
.dot.yellow { background: #ffbd2e; }
.dot.green { background: #27c93f; }
.terminal-title { margin-left: 10px; font-size: 14px; color: #8b949e; }
.prompt { color: #3fb950; margin-right: 10px; font-weight: 700; }
.code-editor { background: #0d1117; border: 1px solid #30363d; border-radius: 16px; overflow: hidden; height: 480px; }
.editor-header { background: #161b22; padding: 12px 20px; border-bottom: 1px solid #30363d; font-size: 15px; color: #c9d1d9; }
.code-snippet { padding: 24px; font-size: 18px; line-height: 1.5; color: #c9d1d9; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; }
.kw { color: #ff7b72; }
.str { color: #a5d6ff; }
.fn { color: #d2a8ff; }
.type { color: #ffa657; }
.tag { color: #7ee787; }

/* Pipeline scene */
.pipeline-grid { display: flex; gap: 20px; align-items: center; margin-top: 10px; }
.step-card { flex: 1; background: #161b26; border: 1px solid #30363d; border-radius: 18px; padding: 30px; display: flex; flex-direction: column; gap: 14px; min-height: 320px; }
.step-badge { font-size: 13px; font-weight: 700; color: #58a6ff; text-transform: uppercase; }
.step-icon { font-size: 40px; }
.step-card h4 { font-size: 24px; }
.step-card p { font-size: 17px; color: #8b949e; line-height: 1.4; }
.tag-status { margin-top: auto; padding: 8px 14px; border-radius: 8px; font-size: 14px; font-weight: 600; text-align: center; }
.tag-status.offline { background: rgba(248, 81, 73, 0.15); color: #f85149; border: 1px solid rgba(248, 81, 73, 0.3); }
.tag-status.sync { background: rgba(56, 139, 253, 0.15); color: #58a6ff; border: 1px solid rgba(56, 139, 253, 0.3); }
.tag-status.secure { background: rgba(63, 185, 80, 0.15); color: #3fb950; border: 1px solid rgba(63, 185, 80, 0.3); }
.arrow-connector { font-size: 32px; color: #58a6ff; }
.s3-preview { background: #0d1117; border: 1px solid #30363d; border-radius: 14px; padding: 20px 30px; margin-top: 25px; }
.s3-header { font-size: 15px; color: #8b949e; margin-bottom: 8px; }
.s3-code { display: flex; justify-content: space-between; align-items: center; font-family: monospace; font-size: 17px; color: #79c0ff; }
.cipher-pill { background: #238636; color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; }

/* Demos scene */
.demos-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 18px; margin-top: 10px; }
.demo-card { background: #161b26; border: 1px solid #21262d; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
.demo-icon { font-size: 36px; }
.demo-card h4 { font-size: 20px; font-weight: 700; }
.demo-card p { font-size: 14px; color: #8b949e; line-height: 1.4; }
.cta-box { background: linear-gradient(135deg, #1f293d, #111622); border: 1px solid #388bfd; border-radius: 18px; padding: 28px 40px; display: flex; justify-content: space-between; align-items: center; margin-top: 25px; }
.cta-command { font-family: monospace; font-size: 24px; font-weight: 700; color: #58a6ff; }
.cta-links { display: flex; flex-direction: column; gap: 6px; font-size: 16px; color: #c9d1d9; text-align: right; }
`;

export async function generateVideo(rootDir: string = path.resolve(__dirname, '..')) {
    const tempDir = path.join(rootDir, 'temp_video_build');
    const outDir = path.join(rootDir, 'docs/public/videos');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    console.log('🎬 Starting Automated SovereignS3nc Video Generation...');
    console.log(`📁 Workspace: ${rootDir}`);
    console.log(`📁 Output Directory: ${outDir}\n`);

    const sceneVideos: string[] = [];

    // Launch Chromium for rendering high-res 1920x1080 slides
    const browser = await chromium.launch();
    const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 }
    });

    try {
        for (let i = 0; i < SCENES.length; i++) {
            const scene = SCENES[i];
            console.log(`📽️ Processing [${scene.id}]: ${scene.title}...`);

            // 1. Generate Voiceover Audio using modern neural TTS (edge-tts)
            const textPath = path.join(tempDir, `${scene.id}.txt`);
            const audioPath = path.join(tempDir, `${scene.id}.mp3`);
            fs.writeFileSync(textPath, scene.narration, 'utf8');

            const voice = process.env.TTS_VOICE || 'en-US-AndrewNeural';
            let ttsSuccess = false;

            try {
                // edge-tts generates lifelike Microsoft Azure neural voices
                execSync(`edge-tts --voice "${voice}" --file "${textPath}" --write-media "${audioPath}"`, { stdio: 'pipe' });
                ttsSuccess = true;
                console.log(`   🎙️ Generated lifelike neural voice (${voice})`);
            } catch (ttsErr: any) {
                console.warn(`   ⚠️ edge-tts failed (${ttsErr.message}), falling back to espeak-ng...`);
            }

            if (!ttsSuccess) {
                const wavPath = path.join(tempDir, `${scene.id}.wav`);
                const espeakCmd = `espeak-ng -v en-us -s 145 -p 42 -w "${wavPath}" "${scene.narration}"`;
                execSync(espeakCmd);
                fs.copyFileSync(wavPath, audioPath);
                console.log(`   🎙️ Generated fallback voice (espeak-ng)`);
            }

            // Get exact duration of the generated audio
            const durationOutput = execSync(`ffprobe -i "${audioPath}" -show_entries format=duration -v quiet -of csv="p=0"`).toString().trim();
            const durationSec = parseFloat(durationOutput);
            console.log(`   🎙️ Audio duration: ${durationSec.toFixed(2)}s`);

            // 2. Render Slide HTML in Playwright
            const fullHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>${BASE_CSS}</style>
            </head>
            <body>
                ${scene.htmlContent}
            </body>
            </html>
            `;
            await page.setContent(fullHtml);
            await page.waitForTimeout(300);

            const pngPath = path.join(tempDir, `${scene.id}.png`);
            await page.screenshot({ path: pngPath });

            // If Scene 1, save as poster.png as well
            if (i === 0) {
                fs.copyFileSync(pngPath, path.join(outDir, 'poster.png'));
                console.log(`   🖼️ Saved video poster: ${path.join(outDir, 'poster.png')}`);
            }

            // 3. Encode Scene Video with ffmpeg (with 0.75s post-narration padding for smooth scene transitions)
            const sceneMp4 = path.join(tempDir, `${scene.id}.mp4`);
            const ffmpegSceneCmd = `ffmpeg -y -loop 1 -i "${pngPath}" -i "${audioPath}" -af "apad=pad_dur=0.75" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest "${sceneMp4}"`;
            execSync(ffmpegSceneCmd, { stdio: 'pipe' });

            sceneVideos.push(sceneMp4);
            console.log(`   ✅ Rendered clip: ${scene.id}.mp4`);
        }
    } finally {
        await browser.close();
    }

    // 4. Concatenate all scenes into final video
    console.log('\n🎞️ Concatenating all scenes into final production video...');
    const concatListPath = path.join(tempDir, 'concat_list.txt');
    const concatFileContent = sceneVideos.map(v => `file '${v}'`).join('\n');
    fs.writeFileSync(concatListPath, concatFileContent, 'utf8');

    const finalMp4 = path.join(outDir, 'sovereigns3nc-quickstart.mp4');
    const ffmpegConcatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${finalMp4}"`;
    execSync(ffmpegConcatCmd, { stdio: 'pipe' });

    // 5. Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Get final video duration & stats
    const finalDuration = execSync(`ffprobe -i "${finalMp4}" -show_entries format=duration -v quiet -of csv="p=0"`).toString().trim();
    const finalSizeMb = (fs.statSync(finalMp4).size / (1024 * 1024)).toFixed(2);

    console.log('\n=========================================');
    console.log('🎉 VIDEO GENERATION COMPLETE');
    console.log('=========================================');
    console.log(`File:     ${finalMp4}`);
    console.log(`Size:     ${finalSizeMb} MB`);
    console.log(`Duration: ${parseFloat(finalDuration).toFixed(1)} seconds (~${(parseFloat(finalDuration) / 60).toFixed(1)} minutes)`);
    console.log('=========================================\n');

    return {
        path: finalMp4,
        sizeMb: parseFloat(finalSizeMb),
        durationSec: parseFloat(finalDuration)
    };
}

if (require.main === module) {
    generateVideo().then(() => process.exit(0)).catch(err => {
        console.error('Video generation failed:', err);
        process.exit(1);
    });
}
