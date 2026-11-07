// A minute change always takes priority over the user-selected data interval.
class SyncSchedule {
  constructor(){this.lastMinute=null;this.retryAt=0;}
  reset(){this.lastMinute=null;this.retryAt=0;}
  due(now,nextPush){return now>=this.retryAt&&(this.lastMinute!==Math.floor(now/60000)||now>=nextPush);}
  success(renderedAt){this.lastMinute=Math.floor(renderedAt/60000);this.retryAt=0;}
  failure(now){this.retryAt=now+5000;}
}
module.exports={SyncSchedule};
