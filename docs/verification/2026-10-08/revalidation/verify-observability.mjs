import {execFileSync} from 'node:child_process';
import {assert,pause,save} from './client.mjs';
const pre='sketchtest-verification-20261008-';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8'}).trim();
const query=async expr=>(await (await fetch('http://127.0.0.1:9090/api/v1/query?query='+encodeURIComponent(expr))).json()).data.result;
const evidence={startedAt:new Date().toISOString()};
try {
 evidence.targets=await (await fetch('http://127.0.0.1:9090/api/v1/targets')).json();
 evidence.histogram=await query('sketchtest_http_request_duration_seconds_bucket');assert(evidence.histogram.length>0);
 evidence.dependencies=await query('sketchtest_dependency_up');assert.equal(evidence.dependencies.length,2);
 evidence.dashboard=await (await fetch('http://127.0.0.1:3000/api/dashboards/uid/sketchtest-operations')).json();assert.equal(evidence.dashboard.dashboard.panels.length,4);
 docker('stop','--time','3',pre+'minio-1');
 try {
  for(let i=0;i<30;i++){const x=await query('ALERTS{alertname="SketchTestDependencyDown",alertstate="firing"}');if(x.length){evidence.firing=x;break}await pause(3000)}
  assert(evidence.firing?.length>0,'Dependency alert did not fire');
  for(let i=0;i<10;i++){try{const lines=docker('exec',pre+'alert-receiver-1','cat','/data/notifications.jsonl').split('\n').map(JSON.parse);if(lines.some(l=>l.notification.status==='firing'&&l.notification.alerts.some(a=>a.labels.alertname==='SketchTestDependencyDown'))){evidence.firingNotifications=lines;break}}catch{}await pause(3000)}
  assert(evidence.firingNotifications,'Firing notification not delivered');
 } finally {docker('start',pre+'minio-1')}
 for(let i=0;i<30;i++){try{const lines=docker('exec',pre+'alert-receiver-1','cat','/data/notifications.jsonl').split('\n').map(JSON.parse);if(lines.some(l=>l.notification.status==='resolved'&&l.notification.alerts.some(a=>a.labels.alertname==='SketchTestDependencyDown'))){evidence.notifications=lines;break}}catch{}await pause(3000)}
 assert(evidence.notifications,'Resolved notification not delivered');
 evidence.finalDependencies=await query('sketchtest_dependency_up');assert(evidence.finalDependencies.every(x=>x.value[1]==='1'));
 evidence.status='passed';
} catch(e) { evidence.status='failed';evidence.error=e.message;process.exitCode=1; }
evidence.completedAt=new Date().toISOString();save('observability-results.json',evidence);console.log(evidence.status,evidence.error??'scrape, histogram, dashboard, fault alert, firing and resolved notifications');
