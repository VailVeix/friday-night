// Build only the public website. Deployment must use a configured shared backend.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), context);
const config = {
  supabaseUrl: (process.env.SUPABASE_URL || context.window.WATCH_CONFIG.supabaseUrl || '').trim(),
  supabasePublishableKey: (process.env.SUPABASE_PUBLISHABLE_KEY || context.window.WATCH_CONFIG.supabasePublishableKey || '').trim()
};
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.supabaseUrl)) {
  throw new Error('Set SUPABASE_URL to the shared project URL before publishing.');
}
const key = config.supabasePublishableKey;
let legacyAnon = false;
try { legacyAnon = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key) && JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch {}
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && !legacyAnon) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY to a publishable key or legacy anon key. Secret/service-role keys cannot be published.');
}
const output = path.join(root, '_site');
fs.mkdirSync(output, {recursive:true});
const assets = ['index.html','style.css','app.js','seed.js','series.js'];
for (const asset of assets) fs.copyFileSync(path.join(root, asset), path.join(output, asset));
fs.writeFileSync(path.join(output, 'config.js'), 'window.WATCH_CONFIG = '+JSON.stringify(config,null,2)+';\n');
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log('Prepared six website assets in _site/. Shared storage configured; no sample responses are uploaded.');
