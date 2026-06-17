(function(){
  "use strict";

  /* ---------- State ---------- */
  var mode = "time";            // "time" | "num"
  var entry = "";               // rohe Eingabe als String
  var steps = [];               // {op:'+'|'-'|'*'|'/'|null, value:Number} | {type:'sum', value:Number}
  var lastEntryWasResult = false;
  var pendingOp = null;         // Operator, der auf den nächsten committeten Wert wartet
  var ready = false;
  var clickSoundEnabled = false;
  var historySide = "left";
  var audioCtx = null;

  // Getrennter Zustand je Modus.
  var saved = {
    time: { entry:"", steps:[], lastEntryWasResult:false, pendingOp:null },
    num:  { entry:"", steps:[], lastEntryWasResult:false, pendingOp:null }
  };

  function captureState(){
    saved[mode] = {
      entry: entry,
      steps: steps.slice(),
      lastEntryWasResult: lastEntryWasResult,
      pendingOp: pendingOp
    };
  }
  function restoreState(m){
    var s = saved[m];
    entry = s.entry;
    steps = s.steps.slice();
    lastEntryWasResult = s.lastEntryWasResult;
    pendingOp = s.pendingOp;
  }

  var STORE_KEY = "zeitrechner-state-v4";
  var SETTINGS_KEY = "zeitrechner-settings-v1";
  function persist(){
    captureState();
    try{
      localStorage.setItem(STORE_KEY, JSON.stringify({ mode: mode, saved: saved }));
    }catch(e){}
  }
  function loadPersisted(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(!raw) return;
      var data = JSON.parse(raw);
      if(data && data.saved){
        if(data.saved.time) saved.time = data.saved.time;
        if(data.saved.num)  saved.num  = data.saved.num;
      }
      if(data && (data.mode==="time"||data.mode==="num")) mode = data.mode;
    }catch(e){}
  }
  function persistSettings(){
    try{
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ clickSoundEnabled: clickSoundEnabled, historySide: historySide }));
    }catch(e){}
  }
  function loadSettings(){
    try{
      var raw = localStorage.getItem(SETTINGS_KEY);
      if(!raw) return;
      var data = JSON.parse(raw);
      clickSoundEnabled = !!(data && data.clickSoundEnabled);
      if(data && (data.historySide==="left" || data.historySide==="right")) historySide = data.historySide;
    }catch(e){}
  }

  var el = {
    app: document.getElementById("app"),
    tape: document.getElementById("tape"),
    sum: document.getElementById("sum"),
    sumMinutes: document.getElementById("sumMinutes"),
    pending: document.getElementById("pending"),
    current: document.getElementById("current"),
    pad: document.getElementById("pad"),
    undo: document.getElementById("undo"),
    modebar: document.getElementById("modebar")
  };

  function haptic(){ if(navigator.vibrate) try{navigator.vibrate(8);}catch(e){} }
  function playClick(){
    if(!clickSoundEnabled) return;
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if(!AudioContext) return;
    try{
      if(!audioCtx) audioCtx = new AudioContext();
      if(audioCtx.state==="suspended") audioCtx.resume().catch(function(){});
      var now = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(820, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    }catch(e){}
  }
  function feedback(){
    haptic();
    playClick();
  }
  function applyHistorySide(){
    el.app.classList.toggle("history-right", historySide==="right");
    var sideInput = document.querySelector('input[name="historySide"][value="' + historySide + '"]');
    if(sideInput) sideInput.checked = true;
  }

  function pressKeyVisual(button){
    button.classList.remove("key-pop");
    button.classList.add("is-pressed");
  }

  function releaseKeyVisual(button){
    if(!button.classList.contains("is-pressed")) return;
    button.classList.remove("is-pressed");
    button.classList.remove("key-pop");
    // Reflow erzwingen, damit wiederholtes schnelles Tippen die Animation neu startet.
    void button.offsetWidth;
    button.classList.add("key-pop");
    window.setTimeout(function(){
      button.classList.remove("key-pop");
    }, 260);
  }

  /* ---------- Zeit-Helfer ----------
     Ohne ":" im entry: Auto-Modus — letzte 2 Ziffern = Minuten, Rest = Stunden (H:MM).
     Mit ":" im entry: Explizit-Modus — Felder werden links nach rechts eingegeben.
       Einzelne Ziffer in Min/Sek wird als Einerstelle interpretiert (1 → 01).
       Leerfeld = 0. Bis zu 2 Doppelpunkte erlaubt (H:MM:SS).
     Beispiele: "123"→1:23, "1:23"→1:23, "1:2"→1:02, "1::1"→1:00:01
  */
  var core = window.CalculatorCore;
  var pad2 = core.pad2;
  var entryToSeconds = core.entryToSeconds;
  var fmtTimeEntry = core.fmtTimeEntry;
  var fmtSeconds = core.fmtSeconds;
  var fmtMinutes = core.fmtMinutes;
  var fmtNum = core.fmtNum;
  var fmtNumEntry = core.fmtNumEntry;
  var numberEntryValue = core.numberEntryValue;
  var valueToEntryCore = core.valueToEntry;
  var expressionStepsCore = core.expressionSteps;
  var evaluateStepsCore = core.evaluateSteps;
  var opSymbol = core.opSymbol;
  var valueLabelCore = core.valueLabel;

  function expressionSteps(){
    return expressionStepsCore(steps);
  }
  function isScalarTimeEntry(op){
    return mode==="time" && (op==="*"||op==="/") && entry!=="" && !entry.includes(":");
  }
  function entryValueForOp(op){
    if(mode==="time") return isScalarTimeEntry(op) ? numberEntryValue(entry) : entryToSeconds(entry);
    return numberEntryValue(entry);
  }
  function evaluate(){
    return evaluateStepsCore(steps);
  }
  function evaluateGroupSteps(groupSteps){
    var localSteps = groupSteps.map(function(st, i){
      if(i===0 && st.type==="paren" && st.value==="(" && st.op){
        return {type:"paren", value:"("};
      }
      return st;
    });
    return evaluateStepsCore(localSteps);
  }

  /* ---------- Rendering ---------- */
  function valueLabel(v, unit){ return valueLabelCore(v, unit, mode); }
  function setGroupDepth(row, depth){
    row.style.setProperty("--depth", depth);
    if(depth>0) row.classList.add("grouped");
  }
  function appendValueLabel(parent, value, unit){
    var main=document.createElement("div");
    main.className="val-main";
    main.textContent=valueLabel(value, unit);
    parent.appendChild(main);
    if(mode==="time" && unit!=="scalar"){
      var minutes=document.createElement("div");
      minutes.className="val-minutes";
      minutes.textContent=fmtMinutes(value);
      parent.appendChild(minutes);
    }
  }

  function render(){
    // Tape
    el.tape.innerHTML="";
    if(steps.length!==0){
      var stepNum=0, firstInGroup=true, afterSum=false, depth=0, groupStack=[];
      steps.forEach(function(st, index){
        var row=document.createElement("div");
        if(st.type==="sum"){
          var val=document.createElement("div"); val.className="val"; appendValueLabel(val, st.value, st.unit);
          row.className="row sum-divider";
          setGroupDepth(row, depth);
          var eq=document.createElement("div"); eq.className="sum-eq"; eq.textContent="=";
          var sp=document.createElement("div"); sp.style.flex="1";
          row.appendChild(eq); row.appendChild(sp); row.appendChild(val);
          firstInGroup=true;
          afterSum=true;
        } else if(st.type==="paren"){
          var isOpen = st.value==="(";
          if(!isOpen) depth = Math.max(0, depth-1);
          row.className="row paren-row " + (isOpen ? "group-open" : "group-close");
          setGroupDepth(row, depth);
          var idxParen=document.createElement("div"); idxParen.className="idx"; idxParen.textContent="";
          var opParen=document.createElement("div"); opParen.className="op"; opParen.textContent=st.op?opSymbol(st.op):"";
          var valParen=document.createElement("div"); valParen.className="val";
          if(isOpen){
            var mainParen=document.createElement("div"); mainParen.className="val-main"; mainParen.textContent="Gruppe";
            valParen.appendChild(mainParen);
            groupStack.push({start:index});
          } else {
            opParen.textContent = "=";
            var group = groupStack.pop();
            var groupValue = group ? evaluateGroupSteps(steps.slice(group.start, index+1)) : Number.NaN;
            appendValueLabel(valParen, groupValue);
          }
          row.appendChild(idxParen); row.appendChild(opParen); row.appendChild(valParen);
          if(isOpen) depth++;
          firstInGroup = isOpen;
          afterSum=false;
        } else {
          var val=document.createElement("div"); val.className="val"; appendValueLabel(val, st.value, st.unit);
          stepNum++;
          row.className="row";
          setGroupDepth(row, depth);
          var idx=document.createElement("div"); idx.className="idx"; idx.textContent=stepNum;
          var op=document.createElement("div"); op.className="op"; op.textContent=st.op&&(!firstInGroup||afterSum)?opSymbol(st.op):"";
          row.appendChild(idx); row.appendChild(op); row.appendChild(val);
          firstInGroup=false;
          afterSum=false;
        }
        el.tape.appendChild(row);
      });
      el.tape.scrollTop = el.tape.scrollHeight;
    }
    // Summe
    var totalValue = evaluate();
    el.sum.textContent = valueLabel(totalValue);
    el.sumMinutes.textContent = mode==="time" ? fmtMinutes(totalValue) : "";
    // Pending-Operator / aktuelle Eingabe
    el.pending.textContent = pendingOp ? opSymbol(pendingOp) : "";
    if(mode==="time"){
      el.current.textContent = isScalarTimeEntry(opForNextValue()) ? fmtNum(numberEntryValue(entry)) : (entry==="" ? "0:00" : fmtTimeEntry(entry));
    } else if(entry===""){
      el.current.textContent = "0";
    } else {
      el.current.textContent = fmtNumEntry(entry);
    }
    el.current.classList.toggle("compact", el.current.textContent.length>12);
    el.current.classList.toggle("tiny", el.current.textContent.length>18);
    // armed operator highlight
    Array.prototype.forEach.call(document.querySelectorAll(".pad .op"),function(b){
      b.classList.toggle("armed", b.dataset.op===pendingOp);
    });
    // Doppelpunkt leuchtet wenn expliziter Modus aktiv (entry enthält ":")
    var colonBtn = el.pad.querySelector(".colon");
    if(colonBtn && mode==="time") colonBtn.classList.toggle("armed", entry.includes(":"));
    if(ready) persist();
  }

  /* ---------- Eingabelogik ---------- */
  function lastExprStep(){
    var rel=expressionSteps();
    return rel.length ? rel[rel.length-1] : null;
  }
  function isValueStep(st){ return st && st.type!=="sum" && st.type!=="paren"; }
  function canStartValue(){
    var last=lastExprStep();
    return !last || pendingOp || (last.type==="paren" && last.value==="(");
  }
  function openParenCount(){
    return expressionSteps().reduce(function(acc, st){
      if(st.type==="paren" && st.value==="(") return acc+1;
      if(st.type==="paren" && st.value===")") return acc-1;
      return acc;
    },0);
  }
  function opForNextValue(){
    var last=lastExprStep();
    if(!last) return pendingOp || null;
    if(last.type==="paren" && last.value==="(") return null;
    return pendingOp || "+";
  }
  function commitEntry(valueOverride){
    var op=opForNextValue();
    var scalar=isScalarTimeEntry(op);
    var v = valueOverride===undefined ? entryValueForOp(op) : valueOverride;
    steps.push({op:op, value:v, unit:scalar?"scalar":undefined});
    entry="";
    pendingOp=null;
  }

  function pressDigit(d){
    if(lastEntryWasResult){ entry=""; pendingOp=null; lastEntryWasResult=false; }
    if(!canStartValue()) return;
    if(mode==="time"){
      var parts = entry.split(":");
      var colons = parts.length-1;
      // Im aktuellen Min-/Sek-Feld max 2 Ziffern; im Auto-Modus max 9 Gesamt
      if(colons>=1 && parts[colons].length>=2) return;
      if(colons===0 && entry.length>=9) return;
      entry += d;
    } else {
      if(d==="." || d===","){
        if(entry.includes(".")) return;
        if(entry==="") entry="0";
        entry += ".";
      } else {
        if(entry==="0") entry=d; else entry+=d;
      }
    }
    render();
  }

  function pressOp(op){
    if(lastEntryWasResult){
      entry = "";
      lastEntryWasResult = false;
      pendingOp = op;
      render();
      return;
    }
    if(entry!==""){
      commitEntry();
    }
    var last=lastExprStep();
    if(!last){
      commitEntry(0);
    } else if(last.type==="paren" && last.value==="("){
      if(op==="-") commitEntry(0);
      else return;
    } else if(!isValueStep(last) && !(last.type==="paren" && last.value===")")){
      return;
    }
    pendingOp = op;
    render();
  }

  function pressEquals(){
    if(lastEntryWasResult) return;
    if(entry!=="") commitEntry();
    if(expressionSteps().length===0) return;
    if(openParenCount()!==0) return;
    var last=lastExprStep();
    if(!isValueStep(last) && !(last && last.type==="paren" && last.value===")")) return;
    var res = evaluate();
    if(!Number.isFinite(res)) return;
    steps.push({type:"sum", value:res});
    entry = valueToEntryCore(res, mode);
    pendingOp = null;
    lastEntryWasResult = true;
    render();
  }

  function pressColonTime(){
    if(lastEntryWasResult){ entry=""; pendingOp=null; lastEntryWasResult=false; }
    if(!canStartValue()) return;
    var colons = (entry.match(/:/g)||[]).length;
    if(colons>=2) return; // max. 2 Doppelpunkte (H:MM:SS)
    entry += ":";
    render();
  }
  function pressOpenParen(){
    if(lastEntryWasResult){ entry=""; pendingOp=null; lastEntryWasResult=false; }
    if(entry!=="") commitEntry();
    var last=lastExprStep();
    var op=null;
    if(last && (isValueStep(last) || (last.type==="paren" && last.value===")"))){
      op=pendingOp || "*";
    } else {
      op=pendingOp;
    }
    steps.push({type:"paren", value:"(", op:op});
    pendingOp=null;
    render();
  }
  function pressCloseParen(){
    if(lastEntryWasResult) return;
    if(entry!=="") commitEntry();
    if(openParenCount()<=0) return;
    var last=lastExprStep();
    if(!isValueStep(last) && !(last && last.type==="paren" && last.value===")")) return;
    steps.push({type:"paren", value:")"});
    pendingOp=null;
    render();
  }

  function backspace(){
    if(entry!==""){ entry=entry.slice(0,-1); }
    else if(pendingOp){ pendingOp=null; }
    else if(steps.length>0){ steps.pop(); }
    render();
  }
  function clearAll(){
    entry=""; steps=[]; pendingOp=null; lastEntryWasResult=false;
    render();
  }
  function clearEntry(){
    if(lastEntryWasResult){ clearAll(); return; }
    entry=""; render();
  }
  function undo(){
    if(lastEntryWasResult){
      lastEntryWasResult = false;
      entry = "";
      pendingOp = null;
      if(steps.length>0 && steps[steps.length-1].type==="sum") steps.pop();
      render();
      return;
    }
    if(entry!==""){ entry=""; render(); return; }
    if(pendingOp){ pendingOp=null; render(); return; }
    if(steps.length>0){ steps.pop(); pendingOp=null; }
    render();
  }

  /* ---------- Keypad-Aufbau ---------- */
  function buildPad(){
    el.pad.innerHTML="";
    var sep = mode==="time"
      ? {t:":",c:"colon",a:"sep"}
      : {t:".",c:"colon",a:"sep"};
    var rows = [
      [{t:"AC",c:"clear",a:"allclear"}, {t:"C",c:"clear-soft",a:"clear"}, {t:"⌫",c:"fn",a:"back"}, {t:"÷",c:"op",a:"op",op:"/"}],
      [{t:"7",a:"d"}, {t:"8",a:"d"}, {t:"9",a:"d"}, {t:"×",c:"op",a:"op",op:"*"}],
      [{t:"4",a:"d"}, {t:"5",a:"d"}, {t:"6",a:"d"}, {t:"−",c:"op",a:"op",op:"-"}],
      [{t:"1",a:"d"}, {t:"2",a:"d"}, {t:"3",a:"d"}, {t:"+",c:"op",a:"op",op:"+"}],
      [{t:"0",a:"d",wide:true}, sep, {t:"=",c:"eq",a:"eq"}]
    ];

    rows.forEach(function(r){
      r.forEach(function(k){
        var b=document.createElement("button");
        b.textContent=k.t;
        if(k.c) b.className=k.c;
        if(k.wide) b.classList.add("wide");
        if(k.op) b.dataset.op=k.op;
        b.addEventListener("pointerdown",function(){ pressKeyVisual(b); });
        b.addEventListener("pointerup",function(){ releaseKeyVisual(b); });
        b.addEventListener("pointercancel",function(){ releaseKeyVisual(b); });
        b.addEventListener("pointerleave",function(){ releaseKeyVisual(b); });
        b.addEventListener("click",function(){
          feedback();
          if(k.a==="d") pressDigit(k.t);
          else if(k.a==="op") pressOp(k.op);
          else if(k.a==="eq") pressEquals();
          else if(k.a==="back") backspace();
          else if(k.a==="allclear") clearAll();
          else if(k.a==="clear") clearEntry();
          else if(k.a==="sep") {
            if(mode==="num") pressDigit(".");
            else pressColonTime();
          }
        });
        el.pad.appendChild(b);
      });
    });
  }

  /* ---------- Modus ---------- */
  function setMode(m){
    if(m===mode) return;
    captureState();
    mode=m;
    restoreState(m);
    buildPad();
    Array.prototype.forEach.call(el.modebar.querySelectorAll(".modetab"),function(btn){
      btn.classList.toggle("active", btn.dataset.mode===m);
    });
    render();
    persist();
  }
  el.modebar.addEventListener("click",function(e){
    var b=e.target.closest(".modetab"); if(!b) return;
    feedback(); setMode(b.dataset.mode);
  });
  el.undo.addEventListener("click",function(){feedback();undo();});
  document.getElementById("openParen").addEventListener("click",function(){feedback();pressOpenParen();});
  document.getElementById("closeParen").addEventListener("click",function(){feedback();pressCloseParen();});

  /* ---------- About-Dialog ---------- */
  var overlay = document.getElementById("aboutOverlay");
  var soundToggle = document.getElementById("soundToggle");
  var historySideOptions = document.getElementById("historySideOptions");
  document.getElementById("infoBtn").addEventListener("click",function(){
    feedback(); overlay.style.display="flex";
  });
  document.getElementById("aboutClose").addEventListener("click",function(){
    feedback(); overlay.style.display="none";
  });
  overlay.addEventListener("click",function(e){ if(e.target===this) this.style.display="none"; });
  soundToggle.addEventListener("change",function(){
    clickSoundEnabled = soundToggle.checked;
    persistSettings();
    if(clickSoundEnabled) playClick();
  });
  historySideOptions.addEventListener("change",function(e){
    if(e.target.name!=="historySide") return;
    historySide = e.target.value==="right" ? "right" : "left";
    applyHistorySide();
    persistSettings();
  });

  /* ---------- Hardware-Tastatur ---------- */
  window.addEventListener("keydown",function(e){
    var k=e.key;
    if(k>="0"&&k<="9"){pressDigit(k);}
    else if(k==="+"){pressOp("+");}
    else if(k==="-"){pressOp("-");}
    else if(k==="*"){pressOp("*");}
    else if(k==="/"){e.preventDefault();pressOp("/");}
    else if(k==="Enter"||k==="="){e.preventDefault();pressEquals();}
    else if(k==="("){pressOpenParen();}
    else if(k===")"){pressCloseParen();}
    else if(k==="Backspace"){backspace();}
    else if(k==="Escape"){clearAll();}
    else if(k==="Delete"){clearEntry();}
    else if(k===","||k==="."){
      if(mode==="num") pressDigit(".");
      else pressColonTime();
    }
  });

  // Gespeicherten Zustand laden.
  loadPersisted();
  loadSettings();
  restoreState(mode);
  soundToggle.checked = clickSoundEnabled;
  applyHistorySide();
  Array.prototype.forEach.call(el.modebar.querySelectorAll(".modetab"),function(btn){
    btn.classList.toggle("active", btn.dataset.mode===mode);
  });
  buildPad();
  ready = true;
  render();

  /* ---------- Service Worker ---------- */
  if("serviceWorker" in navigator){
    window.addEventListener("load",function(){
      navigator.serviceWorker.register("sw.js").catch(function(){});
    });
  }
})();
