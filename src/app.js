(function(){
  "use strict";

  /* ---------- State ---------- */
  var mode = "time";            // "time" | "num"
  var entry = "";               // rohe Eingabe als String
  var steps = [];               // {op:'+'|'-'|'*'|'/'|null, value:Number} | {type:'sum', value:Number}
  var lastEntryWasResult = false;
  var pendingOp = null;         // Operator, der auf den nächsten committeten Wert wartet
  var ready = false;

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

  var el = {
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
       Einzelne Ziffer in Min/Sek = Zehnerstelle (1 → 10, nicht 01).
       Leerfeld = 0. Bis zu 2 Doppelpunkte erlaubt (H:MM:SS).
     Beispiele: "145"→1:45, "1:45"→1:45, "1:1"→1:10, "1::15"→1:00:15
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

  /* ---------- Rendering ---------- */
  function valueLabel(v, unit){ return valueLabelCore(v, unit, mode); }
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
      var stepNum=0, firstInGroup=true, afterSum=false;
      steps.forEach(function(st){
        var row=document.createElement("div");
        if(st.type==="sum"){
          var val=document.createElement("div"); val.className="val"; appendValueLabel(val, st.value, st.unit);
          row.className="row sum-divider";
          var eq=document.createElement("div"); eq.className="sum-eq"; eq.textContent="=";
          var sp=document.createElement("div"); sp.style.flex="1";
          row.appendChild(eq); row.appendChild(sp); row.appendChild(val);
          firstInGroup=true;
          afterSum=true;
        } else if(st.type==="paren"){
          row.className="row paren-row";
          var idxParen=document.createElement("div"); idxParen.className="idx"; idxParen.textContent="";
          var opParen=document.createElement("div"); opParen.className="op"; opParen.textContent=st.op?opSymbol(st.op):"";
          var valParen=document.createElement("div"); valParen.className="val";
          var mainParen=document.createElement("div"); mainParen.className="val-main"; mainParen.textContent=st.value;
          valParen.appendChild(mainParen);
          row.appendChild(idxParen); row.appendChild(opParen); row.appendChild(valParen);
          firstInGroup = st.value==="(";
          afterSum=false;
        } else {
          var val=document.createElement("div"); val.className="val"; appendValueLabel(val, st.value, st.unit);
          stepNum++;
          row.className="row";
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
          haptic();
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
    haptic(); setMode(b.dataset.mode);
  });
  el.undo.addEventListener("click",function(){haptic();undo();});
  document.getElementById("openParen").addEventListener("click",function(){haptic();pressOpenParen();});
  document.getElementById("closeParen").addEventListener("click",function(){haptic();pressCloseParen();});

  /* ---------- About-Dialog ---------- */
  var overlay = document.getElementById("aboutOverlay");
  document.getElementById("infoBtn").addEventListener("click",function(){
    haptic(); overlay.style.display="flex";
  });
  document.getElementById("aboutClose").addEventListener("click",function(){
    haptic(); overlay.style.display="none";
  });
  overlay.addEventListener("click",function(e){ if(e.target===this) this.style.display="none"; });

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
    else if((k===","||k===".")&&mode==="num"){pressDigit(".");}
  });

  // Gespeicherten Zustand laden.
  loadPersisted();
  restoreState(mode);
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
