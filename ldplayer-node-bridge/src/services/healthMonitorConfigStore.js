'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');
const CONFIG_FILE = path.join(config.dataDir,'config','health-monitor.json');
function _ensureDir() {fs.mkdirSync(path.dirname(CONFIG_FILE),{recursive:true});}
function read() {try {const raw = fs.readFileSync(CONFIG_FILE,'utf8');
    const parsed = JSON.parse(raw);
    return {excluded:Array.isArray(parsed.excluded) ? parsed.excluded.map(Number):[]};
  } catch (err) {return {excluded:[]};}}
function write(data) {_ensureDir();
  const excluded = Array.from(new Set((data.excluded||[]).map(Number))).sort((a,b)=>a-b);
  const tmp = `${CONFIG_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp,JSON.stringify({excluded,updated_at:Date.now()},null,2),'utf8');
  fs.renameSync(tmp,CONFIG_FILE);
  return {excluded};}
module.exports = {read,write};