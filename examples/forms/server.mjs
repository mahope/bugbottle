import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from 'svelte/compiler';
import { transformSync } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function createFormExample(framework, port = 0) {
  if (!['vue', 'svelte', 'solid'].includes(framework)) throw new Error('Choose vue, svelte or solid');
  const dir = await mkdtemp(join(tmpdir(), 'bugbottle-form-'));
  let server;
  const close = async () => {
    try {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  try {
    // Install only the actual npm artifact into an isolated consumer. Framework
    // tooling comes from the root lockfile, without source aliases or a network.
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], { cwd: root, encoding: 'utf8', timeout: 10_000 }));
    const packageDir = join(dir, 'node_modules/bugbottle');
    execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--legacy-peer-deps',
      '--no-audit', '--no-fund', '--package-lock=false', '--prefix', dir, join(dir, packed[0].filename)],
    { cwd: dir, timeout: 10_000, stdio: 'pipe' });
    const extension = framework === 'solid' ? 'jsx' : framework;
    const filename = join(root, 'examples', framework, `Form.${extension}`);
    const source = await readFile(filename, 'utf8');
    const compiled = framework === 'vue'
      ? compileScript(parse(source, { filename }).descriptor, { id: 'form', inlineTemplate: true }).content
      : framework === 'solid'
        ? transformSync(source, { filename, configFile: false, babelrc: false,
          presets: [[solidPreset, { generate: 'dom', hydratable: false }]] }).code
        : compile(source, { filename, generate: 'client', dev: false }).js.code;
    await writeFile(join(dir, 'Form.js'), compiled);
    const entry = framework === 'vue'
      ? `import { createApp } from 'vue'; import Form from './Form.js';
         let app; window.mountForm = () => { app = createApp(Form); app.mount('#app'); };
         window.unmountForm = () => app.unmount();`
      : framework === 'solid'
        ? `import { render } from 'solid-js/web'; import Form from './Form.js';
           let dispose; window.mountForm = () => { dispose = render(Form, document.querySelector('#app')); };
           window.unmountForm = () => dispose();`
        : `import { mount, unmount } from 'svelte'; import Form from './Form.js';
         let app; window.mountForm = () => { app = mount(Form, { target: document.querySelector('#app') }); };
         window.unmountForm = () => unmount(app);`;
    await writeFile(join(dir, 'main.js'), `${entry}\nwindow.mountForm();
      document.querySelector('#mount').onclick = () => { if (!document.querySelector('form')) window.mountForm(); };
      document.querySelector('#unmount').onclick = () => window.unmountForm();`);
    const bundle = await build({ entryPoints: [join(dir, 'main.js')], bundle: true, write: false,
      format: 'esm', platform: 'browser', conditions: ['browser'], metafile: true,
      nodePaths: [join(root, 'node_modules')] });
    if (framework === 'solid') {
      const inputs = Object.keys(bundle.metafile.inputs).map(input => resolve(input));
      assert.ok(inputs.includes(join(packageDir, 'dist/solid/index.js')));
      assert.ok(inputs.some(input => input.endsWith('/solid-js/dist/solid.js')));
      assert.ok(!inputs.some(input => input.endsWith('/solid-js/dist/server.js')));
      assert.ok(!inputs.some(input => input.startsWith(join(root, 'src') + '/')));
    }
    const consumerRequire = createRequire(join(dir, 'main.js'));
    const { handleReport } = await import(pathToFileURL(consumerRequire.resolve('bugbottle/server')));
    const reports = [];
    const screenshots = [];
    server = createServer(async (req, res) => {
      try {
        if (req.method === 'POST' && req.url === '/reports') {
          const response = await handleReport(new Request(`http://${req.headers.host}/reports`, {
            method: 'POST', body: req, duplex: 'half', headers: req.headers,
          }), { store: (report, screenshot) => {
            reports.push(report);
            screenshots.push(screenshot);
            return { id: `report-${reports.length}` };
          } });
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
        } else if (req.url === '/main.js') {
          res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].text);
        } else if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><html lang="en">
            <meta charset="utf-8"><title>${framework} report form</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 24px auto; padding: 16px; }
              label { display: block; margin-block: 16px; }
              input, textarea { display: block; font: inherit; max-width: 100%; box-sizing: border-box; }
              button { font: inherit; min-height: 44px; }
              [role="status"] { min-height: 24px; }
            </style>
            <button id="mount">Mount form</button><button id="unmount">Unmount form</button>
            <main id="app"></main><script type="module" src="/main.js"></script></html>`);
        } else if (req.url === '/favicon.ico') res.writeHead(204).end();
        else res.writeHead(404).end();
      } catch { res.writeHead(500).end('Example receiver failed'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return { reports, screenshots, url: `http://127.0.0.1:${server.address().port}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const example = await createFormExample(process.argv[2], 8787);
  console.log(`Form and in-memory receiver: ${example.url}. Ctrl-C to stop.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await example.close(); });
}
