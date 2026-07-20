'use strict';
const crypto = require('crypto');
const { normalizeVariables } = require('./variables');
const jobs = new Map();
const JOB_TTL_MS = 30 * 60_000; // 30 min tras terminar
const CLEANUP_MS = 5 * 60_000;

function newId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createJob({ name, steps, indices, parallel, meta, variables }) {
  const id = newId();
  const varsByIndex = normalizeVariables(indices, variables);
  const job = {
    id,
    name: name || 'Pipeline',
    steps: steps || [],
    indices: indices || [],
    parallel: !!parallel,
    meta: meta || {},
    status: 'queued', 
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    cancelled: false,
    instances: Object.fromEntries(
      (indices || []).map((i) => [i, {
        index: i,
        status: 'queued', 
        currentStep: null,
        steps: [],
        vars: varsByIndex[i] || {},
      }])
    ),
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function listJobs() {
  return Array.from(jobs.values());
}

function removeJob(id) {
  return jobs.delete(id);
}

setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}, CLEANUP_MS).unref();

module.exports = { createJob, getJob, listJobs, removeJob };
