/* ===== src\services\pipelines\stepTypes.js ===== */

'use strict';
const { findToolAction } = require('./toolActions');
const {
  waitForAndroidReady,
  waitForRootReady,
  waitForAppInstalled,
  waitForAppForeground,
} = require('./waitHelpers');

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}


const STEP_TYPES = {
  note: {
    label: '📝 Nota',
    async exec(index, v, ctx) {
      ctx.log(`nota: ${v.text || ''}`);
      return { ok: true };
    },
  },

  wait: {
    label: '⏱️ Esperar',
    async exec(index, v, ctx) {
      await ctx.sleep(Number(v.seconds || 0) * 1000);
      return { ok: true };
    },
  },

  launch: {
    label: '🟢 Encender (launch)',
    async exec(index, v, ctx) {
      await ctx.acquirePower(index);
      try {
        await ctx.client.launch(index);
      } catch (err) {
        ctx.releasePower(index);
        return { ok: false, detail: `launch falló: ${err.message}`, abort: true };
      }
      try {
        await ctx.waitForBoot(index, Number(v.bootTimeoutSec || 90) * 1000);
      } catch (err) {
        ctx.releasePower(index);
        return { ok: false, detail: err.message, abort: true };
      }
      return { ok: true, detail: 'Tools disponible' };
    },
  },

  reboot: {
    label: '🔁 Reboot',
    async exec(index, v, ctx) {
      try {
        await ctx.client.reboot(index);
      } catch (err) {
        return { ok: false, detail: `reboot falló: ${err.message}`, abort: true };
      }
      try {
        await ctx.waitForBoot(index, Number(v.bootTimeoutSec || 90) * 1000);
      } catch (err) {
        return { ok: false, detail: err.message, abort: true };
      }
      return { ok: true, detail: 'Tools disponible' };
    },
  },

  quit: {
    label: '🔴 Apagar (quit)',
    async exec(index, v, ctx) {
      try {
        await ctx.client.quit(index);
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err.message };
      } finally {
        ctx.releasePower(index);
      }
    },
  },

  initial_root: {
    label: '🌱 Perfil: Root Inicial',
    async exec(index, v, ctx) {
      try {
        await ctx.client.initialRoot(index);
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },
  },

  wait_root_ready: {
    label: '🌱 Esperar ADB listo',
    async exec(index, v, ctx) {
      try {
        await waitForRootReady(ctx.client, index, {
          timeoutMs: Number(v.timeoutSec || 120) * 1000,
          pollMs: Number(v.pollSec || 3) * 1000,
          graceMs: Number(v.graceSec || 5) * 1000,
          isCancelledFn: ctx.isCancelled,
        });
        return { ok: true, detail: 'ADB listo' };
      } catch (err) {
        return { ok: false, detail: err.message, abort: true };
      }
    },
  },

  make_ready: {
    label: '✅ Perfil: Ready',
    async exec(index, v, ctx) {
      try {
        await ctx.client.makeReady(index);
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },
  },

  install: {
    label: '⬇️ Instalar APK',
    async exec(index, v, ctx) {
      if (!v.apk_path) return { ok: false, detail: 'sin ruta de APK' };
      try {
        await ctx.client.installApp(index, v.apk_path);
      } catch (err) {
        return { ok: false, detail: err.message };
      }
      if (!v.package_name) return { ok: true, detail: 'APK enviada para instalar' };
      const result = await waitForAppInstalled(ctx.client, index, v.package_name, {
        maxRetries: Number(v.maxRetries) || 3,
        delay: 5000,
        reinstallApkPath: v.apk_path,
        maxReinstalls: 2,
        reinstallDelay: 5000,
        isCancelledFn: ctx.isCancelled,
      });
      if (!result.ok) return { ok: false, detail: result.error };
      return { ok: true, detail: `Instalada correctamente (${v.package_name})` };
    },
  },

  run: {
    label: '▶️ Abrir app',
    async exec(index, v, ctx) {
      if (!v.package_name) return { ok: false, detail: 'sin package name' };
      const result = await waitForAppForeground(ctx.client, index, v.package_name, {
        maxRetries: 3,
        delay: 5000,
        installApkPath: v.apk_path || null,
        maxInstallRetries: 2,
        installDelay: 5000,
        isCancelledFn: ctx.isCancelled,
      });
      if (!result.ok) return { ok: false, detail: result.error };
      return {
        ok: true,
        detail:
          `${v.package_name} en primer plano tras ${result.totalAttempts} intento(s)` +
          (result.installAttempts ? ` y ${result.installAttempts} instalación(es)` : ''),
      };
    },
  },

  kill: {
    label: '✖️ Cerrar app',
    async exec(index, v, ctx) {
      if (!v.package_name) return { ok: false, detail: 'sin package name' };
      try {
        await ctx.client.killApp(index, v.package_name);
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },
  },

  tool: {
    label: '🛠️ Acción ADB genérica',
    async exec(index, v, ctx) {
      const action = findToolAction(v.tool_action);
      if (!action) return { ok: false, detail: `acción inválida: ${v.tool_action}` };
      try {
        const data = await action.call(ctx.client, index, v);
        return { ok: true, detail: JSON.stringify(data) };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },
  },

  verify: {
    label: '✅ Verificar config',
    async exec(index, v, ctx) {
      const action = findToolAction(v.tool_action);
      if (!action || action.method !== 'get') {
        return { ok: false, detail: `acción de consulta inválida: ${v.tool_action}` };
      }
      let data;
      try {
        data = await action.call(ctx.client, index, v);
      } catch (err) {
        return { ok: false, detail: err.message, abort: v.on_mismatch === 'abort' };
      }
      const actual = getByPath(data, v.expect_path);
      const matches = String(actual) === String(v.expect_value);
      return {
        ok: matches,
        detail: `esperado="${v.expect_value}" obtenido="${actual}"`,
        abort: !matches && v.on_mismatch === 'abort',
      };
    },
  },

  root_shell: {
    label: '⌨️ Comando root shell',
    async exec(index, v, ctx) {
      if (!v.command) return { ok: false, detail: 'sin comando' };
      try {
        const data = await ctx.client.rootShell(index, v.command);
        return { ok: true, detail: JSON.stringify(data) };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },
  },
};

module.exports = { STEP_TYPES, getByPath };