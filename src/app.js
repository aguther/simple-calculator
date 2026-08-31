(function(){
  "use strict";

  var viewportController=window.CalculatorViewport ? window.CalculatorViewport.install(window,document) : null;
  var core=window.CalculatorCore;
  var stateStore=window.CalculatorStateStore;
  var loaded=stateStore.load(localStorage);
  var settings=stateStore.loadSettings(localStorage);

  var mode=loaded.mode;
  var saved=loaded.saved;
  var entry="";
  var steps=[];
  var lastEntryWasResult=false;
  var pendingOp=null;
  var error=null;
  var clickSoundEnabled=settings.clickSoundEnabled;
  var historySide=settings.historySide;
  var audioCtx=null;

  var el={
    app:document.getElementById("app"),
    tape:document.getElementById("tape"),
    sum:document.getElementById("sum"),
    sumMinutes:document.getElementById("sumMinutes"),
    pending:document.getElementById("pending"),
    current:document.getElementById("current"),
    pad:document.getElementById("pad"),
    undo:document.getElementById("undo"),
    modebar:document.getElementById("modebar"),
    openParen:document.getElementById("openParen"),
    closeParen:document.getElementById("closeParen"),
    infoBtn:document.getElementById("infoBtn"),
    aboutDialog:document.getElementById("aboutDialog"),
    aboutClose:document.getElementById("aboutClose"),
    diagnosticsToggle:document.getElementById("diagnosticsToggle"),
    diagnosticsPanel:document.getElementById("diagnosticsPanel"),
    diagnosticsOutput:document.getElementById("diagnosticsOutput"),
    diagnosticsStatus:document.getElementById("diagnosticsStatus"),
    diagnosticsCopy:document.getElementById("diagnosticsCopy"),
    soundToggle:document.getElementById("soundToggle"),
    historySideOptions:document.getElementById("historySideOptions")
  };

  function captureState(){
    saved[mode]={
      entry:entry,
      steps:steps.slice(),
      lastEntryWasResult:lastEntryWasResult,
      pendingOp:pendingOp,
      error:error
    };
  }

  function restoreState(nextMode){
    var state=saved[nextMode] || stateStore.emptyModeState();
    entry=state.entry;
    steps=state.steps.slice();
    lastEntryWasResult=state.lastEntryWasResult;
    pendingOp=state.pendingOp;
    error=state.error || null;
  }

  function persist(){
    captureState();
    try{
      var clean=stateStore.save(localStorage,{version:5,mode:mode,saved:saved});
      saved=clean.saved;
    }catch(e){}
  }

  function persistSettings(){
    try{
      settings=stateStore.saveSettings(localStorage,{clickSoundEnabled:clickSoundEnabled,historySide:historySide});
    }catch(e){}
  }

  function completeChange(){
    render();
    persist();
  }

  function haptic(){
    if(navigator.vibrate) try{ navigator.vibrate(8); }catch(e){}
  }

  function playClick(){
    if(!clickSoundEnabled) return;
    var AudioContext=window.AudioContext || window.webkitAudioContext;
    if(!AudioContext) return;
    try{
      if(!audioCtx) audioCtx=new AudioContext();
      if(audioCtx.state==="suspended") audioCtx.resume().catch(function(){});
      var now=audioCtx.currentTime;
      var osc=audioCtx.createOscillator();
      var gain=audioCtx.createGain();
      var filter=audioCtx.createBiquadFilter();
      osc.type="square";
      osc.frequency.setValueAtTime(360,now);
      osc.frequency.exponentialRampToValueAtTime(190,now+0.026);
      filter.type="lowpass";
      filter.frequency.setValueAtTime(900,now);
      filter.Q.setValueAtTime(0.7,now);
      gain.gain.setValueAtTime(0.0001,now);
      gain.gain.exponentialRampToValueAtTime(0.026,now+0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001,now+0.032);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now+0.035);
    }catch(e){}
  }

  function feedback(){
    haptic();
    playClick();
  }

  function applyHistorySide(){
    el.app.classList.toggle("history-right",historySide==="right");
    var sideInput=document.querySelector('input[name="historySide"][value="'+historySide+'"]');
    if(sideInput) sideInput.checked=true;
  }

  function pressKeyVisual(button){
    if(button.disabled) return;
    button.classList.remove("key-pop");
    button.classList.add("is-pressed");
  }

  function releaseKeyVisual(button){
    if(!button.classList.contains("is-pressed")) return;
    button.classList.remove("is-pressed");
    button.classList.remove("key-pop");
    void button.offsetWidth;
    button.classList.add("key-pop");
    window.setTimeout(function(){ button.classList.remove("key-pop"); },260);
  }

  function expressionSteps(){ return core.expressionSteps(steps); }
  function evaluate(){ return core.evaluateSteps(steps); }
  function valueLabel(value,unit){ return core.valueLabel(value,unit,mode); }

  function isScalarTimeEntry(op){
    return mode==="time" && (op==="*" || op==="/") && entry!=="" && !entry.includes(":");
  }

  function entryValueForOp(op){
    if(mode==="time") return isScalarTimeEntry(op) ? core.numberEntryValue(entry) : core.entryToSeconds(entry);
    return core.numberEntryValue(entry);
  }

  function evaluateGroupSteps(groupSteps){
    var localSteps=groupSteps.map(function(step,index){
      if(index===0 && step.type==="paren" && step.value==="(" && step.op) return {type:"paren",value:"("};
      return step;
    });
    return core.evaluateSteps(localSteps);
  }

  function setGroupDepth(row,depth){
    row.dataset.depth=String(Math.min(depth,8));
    if(depth>0) row.classList.add("grouped");
  }

  function appendValueLabel(parent,value,unit){
    var main=document.createElement("div");
    main.className="val-main";
    main.textContent=valueLabel(value,unit);
    parent.appendChild(main);
    if(mode==="time" && unit!=="scalar"){
      var minutes=document.createElement("div");
      minutes.className="val-minutes";
      minutes.textContent=core.fmtMinutes(value);
      parent.appendChild(minutes);
    }
  }

  function renderTape(){
    el.tape.replaceChildren();
    if(steps.length===0) return;
    var stepNum=0;
    var firstInGroup=true;
    var afterSum=false;
    var depth=0;
    var groupStack=[];
    steps.forEach(function(step,index){
      var row=document.createElement("div");
      if(step.type==="sum"){
        var sumValue=document.createElement("div");
        sumValue.className="val";
        appendValueLabel(sumValue,step.value,step.unit);
        row.className="row sum-divider";
        setGroupDepth(row,depth);
        var equals=document.createElement("div");
        equals.className="sum-eq";
        equals.textContent="=";
        var spacer=document.createElement("div");
        spacer.className="row-spacer";
        row.append(equals,spacer,sumValue);
        firstInGroup=true;
        afterSum=true;
      }else if(step.type==="paren"){
        var isOpen=step.value==="(";
        if(!isOpen) depth=Math.max(0,depth-1);
        row.className="row paren-row "+(isOpen ? "group-open" : "group-close");
        setGroupDepth(row,depth);
        var parenIndex=document.createElement("div");
        parenIndex.className="idx";
        var parenOp=document.createElement("div");
        parenOp.className="op";
        parenOp.textContent=step.op ? core.opSymbol(step.op) : "";
        var parenValue=document.createElement("div");
        parenValue.className="val";
        if(isOpen){
          var groupLabel=document.createElement("div");
          groupLabel.className="val-main";
          groupLabel.textContent="Gruppe";
          parenValue.appendChild(groupLabel);
          groupStack.push({start:index});
        }else{
          parenOp.textContent="=";
          var group=groupStack.pop();
          appendValueLabel(parenValue,group ? evaluateGroupSteps(steps.slice(group.start,index+1)) : Number.NaN);
        }
        row.append(parenIndex,parenOp,parenValue);
        if(isOpen) depth++;
        firstInGroup=isOpen;
        afterSum=false;
      }else{
        var value=document.createElement("div");
        value.className="val";
        appendValueLabel(value,step.value,step.unit);
        stepNum++;
        row.className="row";
        setGroupDepth(row,depth);
        var number=document.createElement("div");
        number.className="idx";
        number.textContent=stepNum;
        var operator=document.createElement("div");
        operator.className="op";
        operator.textContent=step.op && (!firstInGroup || afterSum) ? core.opSymbol(step.op) : "";
        row.append(number,operator,value);
        firstInGroup=false;
        afterSum=false;
      }
      el.tape.appendChild(row);
    });
    el.tape.scrollTop=el.tape.scrollHeight;
  }

  function currentText(){
    if(error) return error;
    if(mode==="time"){
      return isScalarTimeEntry(opForNextValue()) ? core.fmtNum(core.numberEntryValue(entry)) : (entry==="" ? "0:00" : core.fmtTimeEntry(entry));
    }
    return entry==="" ? "0" : core.fmtNumEntry(entry);
  }

  function canCloseParen(){
    if(error || lastEntryWasResult || openParenCount()<=0) return false;
    if(entry!=="") return true;
    var last=lastExprStep();
    return isValueStep(last) || !!(last && last.type==="paren" && last.value===")");
  }

  function canEqual(){
    if(error || lastEntryWasResult || openParenCount()!==0) return false;
    if(entry!=="") return true;
    var last=lastExprStep();
    return isValueStep(last) || !!(last && last.type==="paren" && last.value===")");
  }

  function render(){
    renderTape();
    var totalValue=evaluate();
    el.sum.textContent=valueLabel(totalValue);
    el.sumMinutes.textContent=mode==="time" ? core.fmtMinutes(totalValue) : "";
    el.sum.classList.toggle("compact",el.sum.textContent.length>7);
    el.sum.classList.toggle("tiny",el.sum.textContent.length>10);
    el.pending.textContent=error ? "" : (pendingOp ? core.opSymbol(pendingOp) : "");
    el.current.textContent=currentText();
    el.current.classList.toggle("compact",!error && el.current.textContent.length>12);
    el.current.classList.toggle("tiny",!error && el.current.textContent.length>18);
    el.current.classList.toggle("error",!!error);
    el.current.setAttribute("aria-label",error ? "Fehler: "+error : "Aktuelle Eingabe: "+el.current.textContent);
    Array.prototype.forEach.call(el.pad.querySelectorAll(".op"),function(button){
      button.classList.toggle("armed",!error && button.dataset.op===pendingOp);
    });
    var colonButton=el.pad.querySelector(".colon");
    if(colonButton && mode==="time") colonButton.classList.toggle("armed",!error && entry.includes(":"));
    var equalsButton=el.pad.querySelector('[data-action="eq"]');
    if(equalsButton) equalsButton.disabled=!canEqual();
    el.undo.disabled=!error && entry==="" && !pendingOp && steps.length===0;
    el.closeParen.disabled=!canCloseParen();
    el.openParen.disabled=!!error;
  }

  function lastExprStep(){
    var relevant=expressionSteps();
    return relevant.length ? relevant[relevant.length-1] : null;
  }

  function isValueStep(step){ return step && step.type!=="sum" && step.type!=="paren"; }

  function canStartValue(){
    var last=lastExprStep();
    return !last || pendingOp || (last.type==="paren" && last.value==="(");
  }

  function openParenCount(){
    return expressionSteps().reduce(function(count,step){
      if(step.type==="paren" && step.value==="(") return count+1;
      if(step.type==="paren" && step.value===")") return count-1;
      return count;
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
    var value=valueOverride===undefined ? entryValueForOp(op) : valueOverride;
    steps.push({op:op,value:value,unit:scalar ? "scalar" : undefined});
    entry="";
    pendingOp=null;
  }

  function resetForNewExpression(){
    entry="";
    steps=[];
    pendingOp=null;
    lastEntryWasResult=false;
    error=null;
  }

  function pressDigit(digit){
    if(error || lastEntryWasResult) resetForNewExpression();
    if(!canStartValue()) return false;
    if(mode==="time"){
      var unsigned=entry.charAt(0)==="-" ? entry.slice(1) : entry;
      var parts=unsigned.split(":");
      var colons=parts.length-1;
      if(colons>=1 && parts[colons].length>=2) return false;
      if(colons===0 && unsigned.length>=9) return false;
      entry+=digit;
    }else if(digit==="." || digit===","){
      if(entry.includes(".")) return false;
      if(entry==="") entry="0";
      entry+=".";
    }else{
      if(entry==="0") entry=digit;
      else entry+=digit;
    }
    completeChange();
    return true;
  }

  function pressOp(op){
    if(error) return false;
    if(lastEntryWasResult){
      entry="";
      lastEntryWasResult=false;
      pendingOp=op;
      completeChange();
      return true;
    }
    if(entry!=="") commitEntry();
    var last=lastExprStep();
    if(!last) commitEntry(0);
    else if(last.type==="paren" && last.value==="("){
      if(op==="-") commitEntry(0);
      else return false;
    }else if(!isValueStep(last) && !(last.type==="paren" && last.value===")")){
      return false;
    }
    pendingOp=op;
    completeChange();
    return true;
  }

  function pressEquals(){
    if(!canEqual()) return false;
    if(entry!=="") commitEntry();
    var result=evaluate();
    if(!Number.isFinite(result)){
      error="Nicht definiert";
      entry="";
      pendingOp=null;
      lastEntryWasResult=false;
      completeChange();
      return true;
    }
    steps.push({type:"sum",value:result});
    entry=core.valueToEntry(result,mode);
    pendingOp=null;
    lastEntryWasResult=true;
    completeChange();
    return true;
  }

  function pressColonTime(){
    if(error || lastEntryWasResult) resetForNewExpression();
    if(!canStartValue()) return false;
    if((entry.match(/:/g) || []).length>=2) return false;
    entry+=":";
    completeChange();
    return true;
  }

  function pressOpenParen(){
    if(error) return false;
    if(lastEntryWasResult) resetForNewExpression();
    if(entry!=="") commitEntry();
    var last=lastExprStep();
    var op=null;
    if(last && (isValueStep(last) || (last.type==="paren" && last.value===")"))) op=pendingOp || "*";
    else op=pendingOp;
    steps.push({type:"paren",value:"(",op:op});
    pendingOp=null;
    completeChange();
    return true;
  }

  function pressCloseParen(){
    if(!canCloseParen()) return false;
    if(entry!=="") commitEntry();
    steps.push({type:"paren",value:")"});
    pendingOp=null;
    completeChange();
    return true;
  }

  function backspace(){
    if(error){ resetForNewExpression(); completeChange(); return true; }
    if(entry!=="") entry=entry.slice(0,-1);
    else if(pendingOp) pendingOp=null;
    else if(steps.length>0) steps.pop();
    else return false;
    completeChange();
    return true;
  }

  function clearAll(){
    resetForNewExpression();
    completeChange();
    return true;
  }

  function clearEntry(){
    if(error || lastEntryWasResult) return clearAll();
    if(entry==="") return false;
    entry="";
    completeChange();
    return true;
  }

  function undo(){
    if(error){ resetForNewExpression(); completeChange(); return true; }
    if(lastEntryWasResult){
      lastEntryWasResult=false;
      entry="";
      pendingOp=null;
      if(steps.length>0 && steps[steps.length-1].type==="sum") steps.pop();
      completeChange();
      return true;
    }
    if(entry!=="") entry="";
    else if(pendingOp) pendingOp=null;
    else if(steps.length>0){ steps.pop(); pendingOp=null; }
    else return false;
    completeChange();
    return true;
  }

  var labels={
    allclear:"Alles löschen",
    clear:"Aktuelle Eingabe löschen",
    back:"Letzte Stelle löschen",
    eq:"Ergebnis",
    sepTime:"Zeit-Doppelpunkt",
    sepNum:"Dezimaltrennzeichen",
    "+":"Addieren",
    "-":"Subtrahieren",
    "*":"Multiplizieren",
    "/":"Dividieren"
  };

  function buildPad(){
    el.pad.replaceChildren();
    var separator=mode==="time" ? {t:":",c:"colon",a:"sep",label:labels.sepTime} : {t:".",c:"colon",a:"sep",label:labels.sepNum};
    var rows=[
      [{t:"AC",c:"clear",a:"allclear",label:labels.allclear},{t:"C",c:"clear-soft",a:"clear",label:labels.clear},{t:"⌫",c:"fn",a:"back",label:labels.back},{t:"÷",c:"op",a:"op",op:"/",label:labels["/"]}],
      [{t:"7",a:"d"},{t:"8",a:"d"},{t:"9",a:"d"},{t:"×",c:"op",a:"op",op:"*",label:labels["*"]}],
      [{t:"4",a:"d"},{t:"5",a:"d"},{t:"6",a:"d"},{t:"−",c:"op",a:"op",op:"-",label:labels["-"]}],
      [{t:"1",a:"d"},{t:"2",a:"d"},{t:"3",a:"d"},{t:"+",c:"op",a:"op",op:"+",label:labels["+"]}],
      [{t:"0",a:"d",wide:true},separator,{t:"=",c:"eq",a:"eq",label:labels.eq}]
    ];
    rows.forEach(function(row){
      row.forEach(function(key){
        var button=document.createElement("button");
        button.type="button";
        button.textContent=key.t;
        button.dataset.action=key.a;
        if(key.c) button.className=key.c;
        if(key.wide) button.classList.add("wide");
        if(key.op) button.dataset.op=key.op;
        button.setAttribute("aria-label",key.label || key.t);
        button.addEventListener("pointerdown",function(){ pressKeyVisual(button); });
        button.addEventListener("pointerup",function(){ releaseKeyVisual(button); });
        button.addEventListener("pointercancel",function(){ releaseKeyVisual(button); });
        button.addEventListener("pointerleave",function(){ releaseKeyVisual(button); });
        button.addEventListener("click",function(){
          feedback();
          if(key.a==="d") pressDigit(key.t);
          else if(key.a==="op") pressOp(key.op);
          else if(key.a==="eq") pressEquals();
          else if(key.a==="back") backspace();
          else if(key.a==="allclear") clearAll();
          else if(key.a==="clear") clearEntry();
          else if(key.a==="sep") mode==="num" ? pressDigit(".") : pressColonTime();
        });
        el.pad.appendChild(button);
      });
    });
  }

  function setMode(nextMode){
    if(nextMode===mode) return false;
    captureState();
    mode=nextMode;
    restoreState(mode);
    buildPad();
    Array.prototype.forEach.call(el.modebar.querySelectorAll(".modetab"),function(button){
      var active=button.dataset.mode===mode;
      button.classList.toggle("active",active);
      button.setAttribute("aria-pressed",String(active));
    });
    completeChange();
    return true;
  }

  el.modebar.addEventListener("click",function(event){
    var button=event.target.closest(".modetab");
    if(!button) return;
    feedback();
    setMode(button.dataset.mode);
  });
  el.undo.addEventListener("click",function(){ feedback(); undo(); });
  el.openParen.addEventListener("click",function(){ feedback(); pressOpenParen(); });
  el.closeParen.addEventListener("click",function(){ feedback(); pressCloseParen(); });

  el.infoBtn.addEventListener("click",function(){ feedback(); openAbout(false); });
  el.aboutClose.addEventListener("click",function(){ feedback(); el.aboutDialog.close(); });
  el.aboutDialog.addEventListener("close",function(){ el.infoBtn.focus(); });
  el.aboutDialog.addEventListener("click",function(event){
    if(event.target===el.aboutDialog) el.aboutDialog.close();
  });
  el.soundToggle.addEventListener("change",function(){
    clickSoundEnabled=el.soundToggle.checked;
    persistSettings();
    if(clickSoundEnabled) playClick();
  });
  el.historySideOptions.addEventListener("change",function(event){
    if(event.target.name!=="historySide") return;
    historySide=event.target.value==="right" ? "right" : "left";
    applyHistorySide();
    persistSettings();
  });

  window.addEventListener("keydown",function(event){
    if(el.aboutDialog.open) return;
    var key=event.key;
    if(key>="0" && key<="9") pressDigit(key);
    else if(key==="+") pressOp("+");
    else if(key==="-") pressOp("-");
    else if(key==="*") pressOp("*");
    else if(key==="/"){ event.preventDefault(); pressOp("/"); }
    else if(key==="Enter" || key==="="){ event.preventDefault(); pressEquals(); }
    else if(key==="(") pressOpenParen();
    else if(key===")") pressCloseParen();
    else if(key==="Backspace") backspace();
    else if(key==="Escape") clearAll();
    else if(key==="Delete") clearEntry();
    else if(key==="," || key===".") mode==="num" ? pressDigit(".") : pressColonTime();
  });

  function createSafeProbe(className){
    var probe=document.createElement("span");
    probe.className="safe-probe "+className;
    document.body.appendChild(probe);
    return probe;
  }

  function createViewportProbe(className){
    var probe=document.createElement("span");
    probe.className="viewport-probe "+className;
    document.body.appendChild(probe);
    return probe;
  }

  function serviceWorkerVersion(){
    return new Promise(function(resolve){
      var controller=navigator.serviceWorker && navigator.serviceWorker.controller;
      if(!controller){ resolve(null); return; }
      var channel=new MessageChannel();
      var timeout=setTimeout(function(){ resolve(null); },1000);
      channel.port1.onmessage=function(event){
        clearTimeout(timeout);
        resolve(event.data && event.data.version ? event.data.version : null);
      };
      controller.postMessage({type:"GET_BUILD_VERSION"},[channel.port2]);
    });
  }

  var diagnosticsProbes=null;

  async function diagnosticsReport(){
    var viewport=window.visualViewport;
    var orientation=screen.orientation;
    var swVersion=await serviceWorkerVersion();
    var appRect=el.app.getBoundingClientRect();
    var padButtons=Array.prototype.slice.call(el.pad.querySelectorAll("button"));
    var lastButton=padButtons.length ? padButtons[padButtons.length-1].getBoundingClientRect() : null;
    var runtime=viewportController ? viewportController.measure() : null;
    function safeValue(side){ return getComputedStyle(diagnosticsProbes.safe[side])["padding"+side.charAt(0).toUpperCase()+side.slice(1)]; }
    function unitValue(unit){ return getComputedStyle(diagnosticsProbes.units[unit]).height; }
    return {
      build:document.querySelector(".about-version").textContent.trim(),
      browser:{userAgent:navigator.userAgent,platform:navigator.platform,touchPoints:navigator.maxTouchPoints || 0},
      displayMode:matchMedia("(display-mode: standalone)").matches || navigator.standalone===true ? "standalone" : "browser",
      window:{innerWidth:innerWidth,innerHeight:innerHeight,scrollX:scrollX,scrollY:scrollY},
      document:{clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scrollTop:document.scrollingElement ? document.scrollingElement.scrollTop : null,bodyScrollTop:document.body.scrollTop},
      visualViewport:viewport ? {width:viewport.width,height:viewport.height,offsetTop:viewport.offsetTop,offsetLeft:viewport.offsetLeft,pageTop:viewport.pageTop,pageLeft:viewport.pageLeft,scale:viewport.scale} : null,
      screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight,orientation:orientation ? orientation.type : "unbekannt"},
      cssViewportUnits:{vh:unitValue("vh"),dvh:unitValue("dvh"),svh:unitValue("svh"),lvh:unitValue("lvh")},
      safeArea:{top:safeValue("top"),right:safeValue("right"),bottom:safeValue("bottom"),left:safeValue("left")},
      appliedViewport:{cssVariable:getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim(),orientation:document.documentElement.dataset.viewportOrientation || null,revision:document.documentElement.dataset.viewportRevision || null,measurement:runtime},
      app:{top:appRect.top,right:appRect.right,bottom:appRect.bottom,left:appRect.left,width:appRect.width,height:appRect.height,lastButtonBottom:lastButton ? lastButton.bottom : null},
      serviceWorker:{status:swVersion ? "aktiv" : "nicht aktiv",version:swVersion}
    };
  }

  async function refreshDiagnostics(){
    if(el.diagnosticsPanel.hidden) return;
    el.diagnosticsOutput.textContent=JSON.stringify(await diagnosticsReport(),null,2);
  }

  function setDiagnosticsVisible(visible){
    el.diagnosticsPanel.hidden=!visible;
    el.diagnosticsToggle.setAttribute("aria-expanded",String(visible));
    el.diagnosticsToggle.textContent=visible ? "Diagnose ausblenden" : "Diagnose anzeigen";
    el.diagnosticsStatus.textContent="";
    if(visible) refreshDiagnostics();
  }

  function openAbout(showDiagnostics){
    setDiagnosticsVisible(!!showDiagnostics);
    if(!el.aboutDialog.open) el.aboutDialog.showModal();
    (showDiagnostics ? el.diagnosticsCopy : el.aboutClose).focus();
  }

  function copyText(text){
    if(navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function(resolve,reject){
      var textarea=document.createElement("textarea");
      textarea.value=text;
      textarea.setAttribute("readonly","");
      textarea.style.position="fixed";
      textarea.style.opacity="0";
      document.body.appendChild(textarea);
      textarea.select();
      var copied=false;
      try{ copied=document.execCommand("copy"); }catch(error){}
      textarea.remove();
      if(copied) resolve(); else reject(new Error("copy unavailable"));
    });
  }

  function setupDiagnostics(){
    diagnosticsProbes={
      safe:{top:createSafeProbe("safe-probe-top"),right:createSafeProbe("safe-probe-right"),bottom:createSafeProbe("safe-probe-bottom"),left:createSafeProbe("safe-probe-left")},
      units:{vh:createViewportProbe("viewport-probe-vh"),dvh:createViewportProbe("viewport-probe-dvh"),svh:createViewportProbe("viewport-probe-svh"),lvh:createViewportProbe("viewport-probe-lvh")}
    };
    el.diagnosticsToggle.addEventListener("click",function(){ setDiagnosticsVisible(el.diagnosticsPanel.hidden); });
    el.diagnosticsCopy.addEventListener("click",function(){
      refreshDiagnostics().then(function(){ return copyText(el.diagnosticsOutput.textContent); }).then(function(){ el.diagnosticsStatus.textContent="Diagnose kopiert."; },function(){ el.diagnosticsStatus.textContent="Kopieren nicht verfügbar."; });
    });
    function refreshIfVisible(){ if(!el.diagnosticsPanel.hidden) refreshDiagnostics(); }
    window.addEventListener("resize",refreshIfVisible);
    window.addEventListener("orientationchange",refreshIfVisible);
    if(window.visualViewport) window.visualViewport.addEventListener("resize",refreshIfVisible);
    if(navigator.serviceWorker) navigator.serviceWorker.addEventListener("controllerchange",refreshIfVisible);
    if(new URLSearchParams(location.search).get("diagnostics")==="1") openAbout(true);
  }

  restoreState(mode);
  el.soundToggle.checked=clickSoundEnabled;
  applyHistorySide();
  Array.prototype.forEach.call(el.modebar.querySelectorAll(".modetab"),function(button){
    var active=button.dataset.mode===mode;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
  buildPad();
  render();
  setupDiagnostics();

  if("serviceWorker" in navigator){
    window.addEventListener("load",function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
  }
})();
