(function(root,factory){
  "use strict";
  var api=factory();
  if(typeof module==="object" && module.exports) module.exports=api;
  if(root) root.CalculatorViewport=api;
})(typeof window!=="undefined" ? window : null,function(){
  "use strict";

  function positive(value){
    var number=Number(value);
    return Number.isFinite(number) && number>0 ? number : null;
  }

  function measureViewport(win,doc){
    var root=doc && doc.documentElement;
    var visual=win && win.visualViewport;
    var candidates={
      innerHeight:positive(win && win.innerHeight),
      clientHeight:positive(root && root.clientHeight),
      visualHeight:null
    };
    var visualScale=positive(visual && visual.scale) || 1;
    if(visual && Math.abs(visualScale-1)<0.05){
      var visualHeight=positive(visual.height);
      var offsetTop=Number(visual.offsetTop);
      if(visualHeight) candidates.visualHeight=visualHeight+(Number.isFinite(offsetTop) && offsetTop>0 ? offsetTop : 0);
    }
    var values=Object.keys(candidates).map(function(key){ return candidates[key]; }).filter(Boolean);
    return {
      height:values.length ? Math.floor(Math.min.apply(Math,values)*100)/100 : null,
      candidates:candidates,
      visualScale:visualScale
    };
  }

  function install(win,doc){
    var root=doc.documentElement;
    var frame=0;
    var stopped=false;

    function update(){
      frame=0;
      if(stopped) return null;
      var measurement=measureViewport(win,doc);
      if(measurement.height){
        root.style.setProperty("--app-height",measurement.height+"px");
        root.dataset.viewportHeight=String(measurement.height);
      }
      return measurement;
    }

    function schedule(){
      if(frame || stopped) return;
      frame=win.requestAnimationFrame(update);
    }

    win.addEventListener("resize",schedule,{passive:true});
    win.addEventListener("orientationchange",schedule,{passive:true});
    win.addEventListener("pageshow",schedule,{passive:true});
    if(win.visualViewport){
      win.visualViewport.addEventListener("resize",schedule,{passive:true});
      win.visualViewport.addEventListener("scroll",schedule,{passive:true});
    }
    update();
    win.setTimeout(update,0);
    win.setTimeout(update,250);

    return {
      update:update,
      measure:function(){ return measureViewport(win,doc); },
      destroy:function(){
        stopped=true;
        if(frame) win.cancelAnimationFrame(frame);
        win.removeEventListener("resize",schedule);
        win.removeEventListener("orientationchange",schedule);
        win.removeEventListener("pageshow",schedule);
        if(win.visualViewport){
          win.visualViewport.removeEventListener("resize",schedule);
          win.visualViewport.removeEventListener("scroll",schedule);
        }
      }
    };
  }

  return {measureViewport:measureViewport,install:install};
});
