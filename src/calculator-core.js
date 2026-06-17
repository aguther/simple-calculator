(function(root, factory){
  if(typeof module === "object" && module.exports){ module.exports = factory(); }
  else { root.CalculatorCore = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  function pad2(n){ return (n<10?"0":"")+n; }
  function groupInt(n){
    return (""+n).replace(/\B(?=(\d{3})+(?!\d))/g," ");
  }
  function parseIntLoose(s){
    return Number.parseInt((""+s).replace(/[.\s]/g,"")||"0",10);
  }

  function entryToSeconds(e){
    if(!e) return 0;
    var h, m, mStr, s, sStr, parts;
    if(!e.includes(":")){
      m = Number.parseInt(e.slice(-2)||"0",10);
      h = parseIntLoose(e.slice(0,-2)||"0");
      return h*3600 + m*60;
    }
    parts = e.split(":");
    h = parseIntLoose(parts[0]||"0");
    mStr = parts[1]||"";
    m = Number.parseInt(mStr||"0",10);
    s = 0;
    if(parts.length>=3){
      sStr = parts[2]||"";
      s = Number.parseInt(sStr||"0",10);
    }
    return h*3600 + m*60 + s;
  }
  function fmtTimeEntry(e){
    if(!e) return "0:00";
    var h, m, mStr, mDisp, parts, sStr, sDisp;
    if(!e.includes(":")){
      m = Number.parseInt(e.slice(-2)||"0",10);
      h = parseIntLoose(e.slice(0,-2)||"0");
      return groupInt(h)+":"+pad2(m);
    }
    parts = e.split(":");
    h = groupInt(parseIntLoose(parts[0]||"0"));
    mStr = parts[1]||"";
    if(mStr.length===0) mDisp="00"; else if(mStr.length===1) mDisp="0"+mStr; else mDisp=mStr;
    if(parts.length===2) return h+":"+mDisp;
    sStr = parts[2]||"";
    if(sStr.length===0) sDisp="00"; else if(sStr.length===1) sDisp="0"+sStr; else sDisp=sStr;
    return h+":"+mDisp+":"+sDisp;
  }
  function fmtSeconds(total){
    if(!Number.isFinite(total)) return "—";
    var neg = total<0; total=Math.abs(Math.round(total));
    var h=Math.floor(total/3600), m=Math.floor((total%3600)/60), s=total%60;
    var str;
    if(s===0) str = groupInt(h)+":"+pad2(m);
    else      str = groupInt(h)+":"+pad2(m)+":"+pad2(s);
    return (neg?"−":"")+str;
  }
  function fmtMinutes(total){
    if(!Number.isFinite(total)) return "—";
    return fmtNum(total/60).replace("-", "−")+" min";
  }
  function fmtNum(n){
    if(!Number.isFinite(n)) return "—";
    var r = Math.round(n*1e6)/1e6;
    var s = (""+r);
    var parts = s.split(".");
    parts[0] = groupInt(parts[0]);
    return parts.join(".");
  }
  function fmtNumEntry(e){
    if(!e) return "0";
    var raw = e.replace(/[,\s]/g,"");
    var parts = raw.split(".");
    var intPart = parts[0] || "0";
    var intValue = Number.parseInt(intPart,10);
    var out = groupInt(Number.isFinite(intValue) ? intValue : 0);
    if(raw.includes(".")) out += "." + (parts[1] || "");
    return out;
  }
  function numberEntryValue(e){
    return e==="" ? 0 : Number.parseFloat(e.replace(/\s/g,"").replace(",","."));
  }
  function valueToEntry(v, mode){
    if(mode==="time"){
      var total=Math.abs(Math.round(v));
      var h=Math.floor(total/3600), m=Math.floor((total%3600)/60), s=total%60;
      if(s>0) return h+":"+pad2(m)+":"+pad2(s);
      return h+":"+pad2(m);
    }
    if(!Number.isFinite(v)) return "";
    var r=Math.round(v*1e6)/1e6;
    return ""+r;
  }
  function precedence(op){ return (op==="*"||op==="/") ? 2 : 1; }
  function applyOp(values, op){
    var b=values.pop(), a=values.pop();
    if(a===undefined || b===undefined) return false;
    if(op==="+") values.push(a+b);
    else if(op==="-") values.push(a-b);
    else if(op==="*") values.push(a*b);
    else if(op==="/") values.push(b===0 ? Number.NaN : a/b);
    return true;
  }
  function lastSumInfo(steps){
    var startIdx=0, lastSumValue=0, hasSumMarker=false;
    for(var si=steps.length-1;si>=0;si--){
      if(steps[si].type==="sum"){ startIdx=si+1; lastSumValue=steps[si].value; hasSumMarker=true; break; }
    }
    return {startIdx:startIdx, lastSumValue:lastSumValue, hasSumMarker:hasSumMarker};
  }
  function expressionSteps(steps){
    var info=lastSumInfo(steps);
    return steps.slice(info.startIdx).filter(function(st){ return st.type!=="sum"; });
  }
  function expressionTokens(steps){
    var info=lastSumInfo(steps);
    var rel=steps.slice(info.startIdx).filter(function(st){ return st.type!=="sum"; });
    var tokens=[];
    rel.forEach(function(st){
      if(st.type==="paren"){
        if(st.value==="(" && st.op) tokens.push({type:"op", op:st.op});
        tokens.push({type:"paren", value:st.value});
      } else {
        if(tokens.length===0){
          if(info.hasSumMarker && st.op){
            tokens.push({type:"num", value:info.lastSumValue});
            tokens.push({type:"op", op:st.op});
          }
        } else if(st.op){
          tokens.push({type:"op", op:st.op});
        }
        tokens.push({type:"num", value:st.value});
      }
    });
    if(tokens.length===0 && info.hasSumMarker) tokens.push({type:"num", value:info.lastSumValue});
    return tokens;
  }
  function evaluateTokens(tokens){
    if(tokens.length===0) return 0;
    var values=[], ops=[];
    for(var i=0;i<tokens.length;i++){
      var tok=tokens[i];
      if(tok.type==="num") values.push(tok.value);
      else if(tok.type==="op"){
        while(ops.length && ops[ops.length-1]!=="(" && precedence(ops[ops.length-1])>=precedence(tok.op)){
          if(!applyOp(values, ops.pop())) return Number.NaN;
        }
        ops.push(tok.op);
      } else if(tok.value==="(") ops.push("(");
      else if(tok.value===")"){
        while(ops.length && ops[ops.length-1]!=="("){
          if(!applyOp(values, ops.pop())) return Number.NaN;
        }
        if(!ops.length) return Number.NaN;
        ops.pop();
      }
    }
    while(ops.length){
      var op=ops.pop();
      if(op==="(") return Number.NaN;
      if(!applyOp(values, op)) return Number.NaN;
    }
    return values.length===1 ? values[0] : Number.NaN;
  }
  function evaluateSteps(steps){ return evaluateTokens(expressionTokens(steps)); }
  function opSymbol(op){return op==="*"?"×":op==="/"?"÷":op==="-"?"−":"+";}
  function valueLabel(v, unit, mode){ return mode==="time" && unit!=="scalar" ? fmtSeconds(v) : fmtNum(v); }

  return {
    pad2: pad2,
    groupInt: groupInt,
    parseIntLoose: parseIntLoose,
    entryToSeconds: entryToSeconds,
    fmtTimeEntry: fmtTimeEntry,
    fmtSeconds: fmtSeconds,
    fmtMinutes: fmtMinutes,
    fmtNum: fmtNum,
    fmtNumEntry: fmtNumEntry,
    numberEntryValue: numberEntryValue,
    valueToEntry: valueToEntry,
    precedence: precedence,
    applyOp: applyOp,
    lastSumInfo: lastSumInfo,
    expressionSteps: expressionSteps,
    expressionTokens: expressionTokens,
    evaluateTokens: evaluateTokens,
    evaluateSteps: evaluateSteps,
    opSymbol: opSymbol,
    valueLabel: valueLabel
  };
});
