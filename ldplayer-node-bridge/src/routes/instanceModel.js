'use strict';
const express = require('express');
const instanceModelStore = require('../services/instanceModelStore');
const {instanceRecordStore} = require('../services/instanceRecordStore');
const pythonBridgeSocket = require('../services/pythonBridgeSocket');

function buildInstanceModelRouter(client) {const router = express.Router();
  router.get('/',(req,res)=>{res.json(instanceModelStore.list().map((m)=>m.toJSON()));});
  router.get('/deprecated',(req,res)=>{
    res.json(instanceModelStore.list().filter(m=>m.power.deprecated).map(m=>m.toJSON()));});
  router.post('/prune',async (req,res)=>{try {
      const list = await client.listInstances();
      const arr = Array.isArray(list) ? list:list?.instances||[];
      const activeIndices = arr.map(i=>i.index??i.Index??i.idx).filter(Number.isFinite);
      instanceModelStore.prune(activeIndices);
      res.json({ok:true,active:activeIndices,
        deprecated:instanceModelStore.list().filter(m=>m.power.deprecated).map(m=>m.index)});
    } catch (err) {res.status(500).json({error:err.message});}});
  router.post('/purge',(req,res)=>{
    const removed = instanceModelStore.purgeDeprecated();
    for (const idx of removed) instanceRecordStore.delete(idx);
    res.json({ok:true,removed});});
  router.delete('/:index',(req,res)=>{const idx = Number(req.params.index);
    if (!Number.isFinite(idx)) return res.status(400).json({error:'index inválido'});
    const model = instanceModelStore.get(idx);
    if (!model) return res.status(404).json({error:'no encontrado'});
    if (!model.power.deprecated&&req.query.force!=='true') {
      return res.status(409).json({error:'no está marcada deprecated, usá ?force=true para forzar'});}
    instanceModelStore.delete(idx);
    instanceRecordStore.delete(idx);
    res.json({ok:true,deleted:idx});});
  router.get('/bridge/status',(req,res)=>{res.json({connected:pythonBridgeSocket.isConnected(),url:pythonBridgeSocket.url});});
  router.get('/:index',(req,res)=>{const model = instanceModelStore.get(req.params.index);
    if (!model) return res.status(404).json({error:'no encontrado'});
    res.json(model.toJSON());});
  router.get('/:index/health-decision',(req,res)=>{const {action,model} = instanceModelStore.decideHealthAction(req.params.index);
    res.json({action,model:model ? model.toJSON():null});});
  return router;}
module.exports = buildInstanceModelRouter;