'use strict';
const express = require('express');
const { LDPlayerApiError } = require('../services/ldplayerClient');
const dataStore = require('../services/dataStore');

function buildStatusRouter(client, poller) {
  const router = express.Router();

  router.get('/all', async (req, res) => {
    // 1) archivo compartido (lo que escribe el monitor de Python) — esto
    //    reemplaza al viejo "poller.getLastSnapshot()" como fuente
    //    principal, ya que el archivo persiste solo entre reinicios.
    const fromDisk = dataStore.readStatusSnapshot();
    if (fromDisk) return res.json(fromDisk.instances || {});
    // 2) último snapshot en memoria del poller, por si el archivo
    //    todavía no se escribió pero ya hubo un fallback HTTP exitoso
    const cached = poller.getLastSnapshot();
    if (cached) return res.json(cached.instances);
    // 3) consulta en caliente directa a Python como último recurso
    try {
      res.json(await client.getAllStatus());
    } catch (err) {
      res.status(err instanceof LDPlayerApiError ? err.status || 502 : 500).json({ error: err.message });
    }
  });

  router.get('/:index', async (req, res) => {
    const index = Number(req.params.index);
    const snapshot = dataStore.readStatusSnapshot();
    const fromSnapshot = snapshot?.instances?.[String(index)];
    if (fromSnapshot) {
      const health = dataStore.readHealth(index);
      return res.json({
        ...fromSnapshot,
        battery: fromSnapshot.battery ?? health?.health?.battery ?? null,
      });
    }
    // consulta en caliente directa: instancia todavía no está en el
    // snapshot compartido (recién creada, o el monitor no corrió aún)
    try {
      res.json(await client.getInstanceStatus(index));
    } catch (err) {
      if (err instanceof LDPlayerApiError) {
        return res.status(err.status || 502).json({ error: err.message, detail: err.detail });
      }
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
module.exports = buildStatusRouter;
