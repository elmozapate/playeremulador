'use strict';
const express = require('express');
const eventBus = require('../utils/eventBus');
// @ts-check
// eslint-disable-next-line no-unused-vars
const _schemas = require('../schemas/tasks'); // referencia de shapes, ver JSDoc del archivo
const jobStore = require('../services/pipelines/jobStore');
const { runJob, cancelJob } = require('../services/pipelines/jobRunner');
const { STEP_TYPES } = require('../services/pipelines/stepTypes');
const { listPresets, buildPreset } = require('../services/pipelines/presets');

function buildTasksRouter(client) {
  const router = express.Router();

  router.get('/step-types', (req, res) => {
    res.json(Object.entries(STEP_TYPES).map(([type, def]) => ({ type, label: def.label })));
  });
 // @ts-check
// eslint-disable-next-line no-unused-vars
  router.get('/presets', (req, res) => res.json(listPresets()));

  router.post('/presets/:id/run', (req, res) => {
    const { indices, parallel, params } = req.body || {};
    if (!Array.isArray(indices) || indices.length === 0) {
      return res.status(400).json({ error: 'indices requerido (array de números)' });
    }
    const preset = buildPreset(req.params.id, params);
    if (!preset) return res.status(404).json({ error: 'preset no encontrado' });
    const job = jobStore.createJob({
      name: preset.name,
      steps: preset.steps,
      indices: indices.map(Number),
      parallel: !!parallel,
      meta: { presetId: req.params.id, params: params || {} },
    });
    eventBus.emit('job:created', { jobId: job.id, name: job.name, indices: job.indices });
    runJob(client, job.id).catch((err) => console.error('[tasks] error corriendo job:', err.message));
    res.status(202).json({ ok: true, jobId: job.id });
  });

  router.post('/', (req, res) => {
    const { name, steps, indices, parallel, meta } = req.body || {};
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'steps requerido (array)' });
    }
    if (!Array.isArray(indices) || indices.length === 0) {
      return res.status(400).json({ error: 'indices requerido (array de números)' });
    }
    const job = jobStore.createJob({ name, steps, indices: indices.map(Number), parallel: !!parallel, meta });
    eventBus.emit('job:created', { jobId: job.id, name: job.name, indices: job.indices });
    runJob(client, job.id).catch((err) => console.error('[tasks] error corriendo job:', err.message));
    res.status(202).json({ ok: true, jobId: job.id });
  });

  router.get('/', (req, res) => {
    res.json(jobStore.listJobs().map((j) => ({
      id: j.id, name: j.name, status: j.status, indices: j.indices,
      parallel: j.parallel, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
    })));
  });

  router.get('/:id', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'no encontrado' });
    res.json(job);
  });

  router.post('/:id/cancel', (req, res) => {
    const job = cancelJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'no encontrado' });
    res.json({ ok: true, jobId: job.id, cancelled: true });
  });

  return router;
}

module.exports = buildTasksRouter;