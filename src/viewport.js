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

  function resetScroll(win,doc){
    [doc.scrollingElement,doc.documentElement,doc.body].forEach(function(element){
      if(!element) return;
      element.scrollTop=0;
      element.scrollLeft=0;
    });
    if(typeof win.scrollTo==="function"){
      try{ win.scrollTo(0,0); }catch(error){}
    }
  }

  function orientationKey(win){
    var width=positive(win && win.innerWidth);
    var height=positive(win && win.innerHeight);
    if(!width || !height) return "unknown";
    return width>height ? "landscape" : "portrait";
  }

  function install(win,doc){
    var root=doc.documentElement;
    var frame=0;
    var stopped=false;
    var timers=[];
    var lastOrientation=orientationKey(win);
    var revision=0;

    function update(){
      frame=0;
      if(stopped) return null;
      var measurement=measureViewport(win,doc);
      if(measurement.height){
        root.style.setProperty("--app-height",measurement.height+"px");
        root.dataset.viewportHeight=String(measurement.height);
      }
      root.dataset.viewportOrientation=orientationKey(win);
      return measurement;
    }

    function schedule(){
      if(frame || stopped) return;
      frame=win.requestAnimationFrame(update);
    }

    function stabilize(){
      timers.forEach(function(timer){ win.clearTimeout(timer); });
      timers=[];
      [0,60,180,360,700].forEach(function(delay){
        timers.push(win.setTimeout(function(){
          if(stopped) return;
          resetScroll(win,doc);
          update();
          revision++;
          root.dataset.viewportRevision=String(revision);
        },delay));
      });
    }

    function handleResize(){
      var nextOrientation=orientationKey(win);
      schedule();
      if(nextOrientation!==lastOrientation){
        lastOrientation=nextOrientation;
        stabilize();
      }
    }

    function handleOrientation(){ stabilize(); }
    function handlePageShow(){ stabilize(); }

    win.addEventListener("resize",handleResize,{passive:true});
    win.addEventListener("orientationchange",handleOrientation,{passive:true});
    win.addEventListener("pageshow",handlePageShow,{passive:true});
    if(win.visualViewport){
      win.visualViewport.addEventListener("resize",schedule,{passive:true});
      win.visualViewport.addEventListener("scroll",schedule,{passive:true});
    }
    update();
    stabilize();

    return {
      update:update,
      measure:function(){ return measureViewport(win,doc); },
      destroy:function(){
        stopped=true;
        if(frame) win.cancelAnimationFrame(frame);
        timers.forEach(function(timer){ win.clearTimeout(timer); });
        win.removeEventListener("resize",handleResize);
        win.removeEventListener("orientationchange",handleOrientation);
        win.removeEventListener("pageshow",handlePageShow);
        if(win.visualViewport){
          win.visualViewport.removeEventListener("resize",schedule);
          win.visualViewport.removeEventListener("scroll",schedule);
        }
      }
    };
  }

  return {measureViewport:measureViewport,resetScroll:resetScroll,orientationKey:orientationKey,install:install};
});
