'use strict';
/**
 * Documentación de shapes (no valida en runtime — Node no tiene Pydantic).
 * Sirve como contrato de referencia para el cliente HTML/JS y para vos mismo.
 */

/**
 * @typedef {Object} StepDef
 * @property {string} type - key de STEP_TYPES (ver GET /api/tasks/step-types)
 * @property {Object} values - payload específico del step (varía por type)
 */

/**
 * @typedef {Object} StepResult
 * @property {string} type
 * @property {boolean} ok
 * @property {string} [detail]
 * @property {boolean} [abort] - si true, cortó el pipeline para esa instancia
 */

/**
 * @typedef {Object} InstanceProgress
 * @property {number} index
 * @property {'queued'|'running'|'done'|'failed'|'aborted'|'cancelled'} status
 * @property {string|null} currentStep
 * @property {StepResult[]} steps
 */

/**
 * @typedef {Object} Job
 * @property {string} id - uuid
 * @property {string} name
 * @property {StepDef[]} steps
 * @property {number[]} indices
 * @property {boolean} parallel
 * @property {Object} meta
 * @property {'queued'|'running'|'done'|'cancelled'|'error'} status
 * @property {number} createdAt
 * @property {number|null} startedAt
 * @property {number|null} finishedAt
 * @property {boolean} cancelled
 * @property {Object.<number, InstanceProgress>} instances - keyed por index
 * @property {string} [error]
 */

/**
 * @typedef {Object} JobSummary
 * @property {string} id
 * @property {string} name
 * @property {string} status
 * @property {number[]} indices
 * @property {boolean} parallel
 * @property {number} createdAt
 * @property {number|null} startedAt
 * @property {number|null} finishedAt
 */

/**
 * @typedef {Object} StepTypeInfo
 * @property {string} type
 * @property {string} label
 */

/**
 * @typedef {Object} PresetInfo
 * @property {string} id
 * @property {string} name
 */

module.exports = {}; // solo documentación vía JSDoc, no exporta nada ejecutable