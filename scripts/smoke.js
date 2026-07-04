// Headless smoke test — injected into the real app's main process via
// NODE_OPTIONS --require (the bundle shim always boots Sparky, so the tests
// ride along and exit the app when done). See scripts/test.sh.
// Electron's built-in module isn't registered yet at --require time, so all
// electron access must be deferred until after boot.
setTimeout(async () => {
  let app;
  try { ({ app } = require('electron')); } catch { return; } // helper processes: no-op
  if (!app || !app.whenReady) return;
  const assert = require('assert');

  await app.whenReady();
  {
    const tools = require('../main/tools.js');
    const store = require('../main/store.js');
    let failed = 0;
    const t = async (name, fn) => {
      try { await fn(); console.log('PASS', name); }
      catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
    };

    await t('computer tools blocked in display mode', async () => {
      const r = await tools.execute('open_app', { name: 'Finder' });
      assert(r.error && /computer/i.test(r.error));
    });

    await t('set_mode unlocks, dry-run previews instead of executing', async () => {
      const prevDry = store.settings.data.dryRun;
      store.settings.data.dryRun = true;
      assert((await tools.execute('set_mode', { mode: 'computer' })).ok);
      const r = await tools.execute('open_app', { name: 'Finder' });
      assert(r.dry_run === true);
      store.settings.data.dryRun = prevDry;
      await tools.execute('set_mode', { mode: 'display' });
    });

    await t('open_url rejects non-http and file paths', async () => {
      assert((await tools.execute('open_url', { url: 'file:///etc/hosts' })).error);
      assert((await tools.execute('open_url', { url: 'javascript:alert(1)' })).error);
    });

    await t('open_file rejects missing paths', async () => {
      assert((await tools.execute('open_file', { path: '/nope/missing.txt' })).error);
    });

    await t('db_delete requires confirmation; approve executes; decline cancels; id single-use', async () => {
      const up = await tools.execute('db_upsert', { table: '_smoke', record: { name: 'x' } });
      let del = await tools.execute('db_delete', { table: '_smoke', id: up.id });
      assert(del.status === 'awaiting_confirmation');
      const ok = await tools.execute('confirm_action', { id: del.id, approved: true });
      assert(ok.ok === true && ok.deleted);
      const up2 = await tools.execute('db_upsert', { table: '_smoke', record: { name: 'y' } });
      del = await tools.execute('db_delete', { table: '_smoke', id: up2.id });
      const no = await tools.execute('confirm_action', { id: del.id, approved: false });
      assert(no.cancelled === true);
      const spent = await tools.execute('confirm_action', { id: del.id, approved: true });
      assert(spent.error);
      store.db.data.tables._smoke = [];
      store.db.save();
    });

    await t('unknown tool returns error not throw', async () => {
      assert((await tools.execute('not_a_tool', {})).error);
    });

    await t('computer_click_element gated behind computer mode', async () => {
      const r = await tools.execute('computer_click_element', { title: 'OK' });
      assert(r.error && /computer/i.test(r.error));
    });

    await t('fetchT aborts hung requests', async () => {
      const { fetchT } = require('../main/util.js');
      const t0 = Date.now();
      try {
        await fetchT('https://example.com:81/hang', {}, 1500); // unroutable port → hangs until abort
        assert.fail('should have thrown');
      } catch (e) {
        assert(/timed out|abort|fetch failed/i.test(String(e.message)), e.message);
        assert(Date.now() - t0 < 10000);
      }
    });

    await t('store flush is atomic (no tmp file left, valid JSON)', async () => {
      store.notes.flush();
      const fs = require('fs');
      assert(!fs.existsSync(store.notes.file + '.tmp'));
      JSON.parse(fs.readFileSync(store.notes.file, 'utf8'));
    });

    await t('debounced save coalesces writes', async () => {
      const fs = require('fs');
      const before = fs.statSync(store.notes.file).mtimeMs;
      for (let i = 0; i < 20; i++) store.notes.save();
      assert(fs.statSync(store.notes.file).mtimeMs === before); // not yet flushed
      await new Promise((r) => setTimeout(r, 400));
      assert(fs.statSync(store.notes.file).mtimeMs >= before);  // flushed once
    });

    await t('memory summary excludes episodes and caps lines', async () => {
      const mem = require('../main/memory.js');
      const s = mem.summary();
      assert(typeof s === 'string');
      assert(!/\[episode\]/.test(s));
      assert(s.split('\n').length <= 12);
    });

    console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll smoke tests passed');
    process.exit(failed ? 1 : 0);
  }
}, 2000);
