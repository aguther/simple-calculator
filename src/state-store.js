(function(root, factory){
  if(typeof module === "object" && module.exports){ module.exports = factory(); }
  else { root.CalculatorStateStore = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  var STORE_KEY = "zeitrechner-state-v5";
  var LEGACY_STORE_KEY = "zeitrechner-state-v4";
  var SETTINGS_KEY = "zeitrechner-settings-v1";
  var VALID_OPERATORS = ["+", "-", "*", "/"];

  function emptyModeState(){
    return { entry:"", steps:[], lastEntryWasResult:false, pendingOp:null, error:null };
  }

  function emptyState(){
    return { version:5, mode:"time", saved:{ time:emptyModeState(), num:emptyModeState() } };
  }

  function isOperator(value){
    return VALID_OPERATORS.indexOf(value)!==-1;
  }

  function validEntry(entry, mode){
    if(typeof entry!=="string" || entry.length>64) return false;
    if(mode==="time") return /^-?\d{0,9}(?::\d{0,2}){0,2}$/.test(entry);
    return /^-?\d*(?:\.\d*)?$/.test(entry);
  }

  function sanitizeStep(step){
    if(!step || typeof step!=="object") return null;
    if(step.type==="sum"){
      if(!Number.isFinite(step.value)) return null;
      return {type:"sum", value:step.value};
    }
    if(step.type==="paren"){
      if(step.value!=="(" && step.value!==")") return null;
      if(step.op!==undefined && step.op!==null && !isOperator(step.op)) return null;
      var paren = {type:"paren", value:step.value};
      if(step.op) paren.op=step.op;
      return paren;
    }
    if(step.type!==undefined && step.type!=="value") return null;
    if(!Number.isFinite(step.value)) return null;
    if(step.op!==undefined && step.op!==null && !isOperator(step.op)) return null;
    if(step.unit!==undefined && step.unit!=="scalar") return null;
    var valueStep = {op:step.op || null, value:step.value};
    if(step.unit==="scalar") valueStep.unit="scalar";
    return valueStep;
  }

  function sanitizeModeState(candidate, mode){
    if(!candidate || typeof candidate!=="object") return null;
    if(!validEntry(candidate.entry, mode) || !Array.isArray(candidate.steps) || candidate.steps.length>1000) return null;
    if(candidate.pendingOp!==undefined && candidate.pendingOp!==null && !isOperator(candidate.pendingOp)) return null;
    var steps=[];
    for(var i=0;i<candidate.steps.length;i++){
      var cleanStep=sanitizeStep(candidate.steps[i]);
      if(!cleanStep) return null;
      steps.push(cleanStep);
    }
    return {
      entry:candidate.entry,
      steps:steps,
      lastEntryWasResult:candidate.lastEntryWasResult===true,
      pendingOp:candidate.pendingOp || null,
      error:candidate.error==="Nicht definiert" ? candidate.error : null
    };
  }

  function parse(raw,allowLegacy){
    var fallback=emptyState();
    if(!raw) return fallback;
    var data;
    try{ data=JSON.parse(raw); }catch(e){ return fallback; }
    if(!data || typeof data!=="object" || !data.saved) return fallback;
    if(allowLegacy){
      if(data.version!==undefined && data.version!==4) return fallback;
    }else if(data.version!==5){
      return fallback;
    }
    var time=sanitizeModeState(data.saved.time,"time");
    var num=sanitizeModeState(data.saved.num,"num");
    return {
      version:5,
      mode:data.mode==="num" ? "num" : "time",
      saved:{time:time || emptyModeState(),num:num || emptyModeState()}
    };
  }

  function load(storage){
    try{
      var current=storage.getItem(STORE_KEY);
      if(current) return parse(current);
      var legacy=storage.getItem(LEGACY_STORE_KEY);
      if(!legacy) return emptyState();
      var migrated=parse(legacy,true);
      storage.setItem(STORE_KEY,JSON.stringify(migrated));
      storage.removeItem(LEGACY_STORE_KEY);
      return migrated;
    }catch(e){
      return emptyState();
    }
  }

  function save(storage,state){
    var clean=parse(JSON.stringify(state));
    storage.setItem(STORE_KEY,JSON.stringify(clean));
    return clean;
  }

  function loadSettings(storage){
    try{
      var raw=storage.getItem(SETTINGS_KEY);
      if(!raw) return {clickSoundEnabled:false,historySide:"left"};
      var data=JSON.parse(raw);
      return {
        clickSoundEnabled:!!(data && data.clickSoundEnabled),
        historySide:data && data.historySide==="right" ? "right" : "left"
      };
    }catch(e){
      return {clickSoundEnabled:false,historySide:"left"};
    }
  }

  function saveSettings(storage,settings){
    var clean={
      clickSoundEnabled:!!settings.clickSoundEnabled,
      historySide:settings.historySide==="right" ? "right" : "left"
    };
    storage.setItem(SETTINGS_KEY,JSON.stringify(clean));
    return clean;
  }

  return {
    STORE_KEY:STORE_KEY,
    LEGACY_STORE_KEY:LEGACY_STORE_KEY,
    SETTINGS_KEY:SETTINGS_KEY,
    emptyModeState:emptyModeState,
    emptyState:emptyState,
    sanitizeStep:sanitizeStep,
    sanitizeModeState:sanitizeModeState,
    parse:parse,
    load:load,
    save:save,
    loadSettings:loadSettings,
    saveSettings:saveSettings
  };
});
