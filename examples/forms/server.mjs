import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from 'svelte/compiler';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function createFormExample(framework, port = 0) {
  if (!['vue', 'svelte'].includes(framework)) throw new Error('Choose vue or svelte');
  const dir = await mkdtemp(join(tmpdir(), 'bugbottle-form-'));
  let server;
  try {
    // Extract the actual npm artifact into an isolated consumer. No install,
    // source aliases or network access: framework tooling is root-lockfile pinned.
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], { cwd: root, encoding: 'utf8' }));
    const packageDir = join(dir, 'node_modules/bugbottle');
    await mkdir(packageDir, { recursive: true });
    execFileSync('tar', ['-xzf', join(dir, packed[0].filename), '--strip-components=1', '-C', packageDir]);
    const extension = framework === 'vue' ? 'vue' : 'svelte';
    const filename = join(root, 'examples', framework, `Form.${extension}`);
    const source = await readFile(filename, 'utf8');
    const compiled = framework === 'vue'
      ? compileScript(parse(source, { filename }).descriptor, { id: 'form', inlineTemplate: true }).content
      : compile(source, { filename, generate: 'client', dev: false }).js.code;
    await writeFile(join(dir, 'Form.js'), compiled);
    const entry = framework === 'vue'
      ? `import { createApp } from 'vue'; import Form from './Form.js';
         let app; window.mountForm = () => { app = createApp(Form); app.mount('#app'); };
         window.unmountForm = () => app.unmount();`
      : `import { mount, unmount } from 'svelte'; import Form from './Form.js';
         let app; window.mountForm = () => { app = mount(Form, { target: document.querySelector('#app') }); };
         window.unmountForm = () => unmount(app);`;
    await writeFile(join(dir, 'main.js'), `${entry}\nwindow.mountForm();
      document.querySelector('#mount').onclick = () => { if (!document.querySelector('form')) window.mountForm(); };
      document.querySelector('#unmount').onclick = () => window.unmountForm();`);
    const bundle = await build({ entryPoints: [join(dir, 'main.js')], bundle: true, write: false,
      format: 'esm', platform: 'browser', conditions: ['browser'], nodePaths: [join(root, 'node_modules')] });
    const { handleReport } = await import(pathToFileURL(join(packageDir, 'dist/server/index.js')));
    const reports = [];
    server = createServer(async (req, res) => {
      try {
        if (req.method === 'POST' && req.url === '/reports') {
          const response = await handleReport(new Request(`http://${req.headers.host}/reports`, {
            method: 'POST', body: req, duplex: 'half', headers: req.headers,
          }), { store: report => { reports.push(report); return { id: `report-${reports.length}` }; } });
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
        } else if (req.url === '/main.js') {
          res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].text);
        } else if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><html lang="en">
            <meta charset="utf-8"><title>${framework} report form</title>
            <button id="mount">Mount form</button><button id="unmount">Unmount form</button>
            <main id="app"></main><script type="module" src="/main.js"></script></html>`);
        } else if (req.url === '/favicon.ico') res.writeHead(204).end();
        else res.writeHead(404).end();
      } catch { res.writeHead(500).end('Example receiver failed'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return { reports, url: `http://127.0.0.1:${server.address().port}`, close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    } };
  } catch (error) {
    server?.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const example = await createFormExample(process.argv[2], 8787);
  console.log(`Form and in-memory receiver: ${example.url}. Ctrl-C to stop.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await example.close(); });
}
