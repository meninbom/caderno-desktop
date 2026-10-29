export interface ReminderTask { id:string; title:string }
export interface ReminderNotifications {
  show(task:ReminderTask):void;
  fallback(task:ReminderTask):void;
}

/** Timer-only while the app is alive. `runOnce` is public for deterministic clock tests. */
export class LocalReminderScheduler {
  private timer:ReturnType<typeof setInterval>|null=null;
  constructor(private due:(now:number,limit:number)=>ReminderTask[],private notifications:ReminderNotifications,private now:()=>number=Date.now,private everyMs=30_000,private limit=10){}
  runOnce():number {const rows=this.due(this.now(),this.limit);for(const task of rows){try{this.notifications.show(task);}catch{this.notifications.fallback(task);}}return rows.length;}
  start():void {if(this.timer)return;this.runOnce();this.timer=setInterval(()=>this.runOnce(),this.everyMs);}
  stop():void {if(this.timer){clearInterval(this.timer);this.timer=null;}}
}
