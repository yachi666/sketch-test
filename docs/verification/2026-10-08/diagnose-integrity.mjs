import {createHash} from 'node:crypto';
import {api,save,original} from './live-client.mjs';
const manifest=await api(`/api/runs/${original.assets.runId}/evidence-manifest`);const report=await api(`/api/runs/${original.assets.runId}/report`);const events=report.steps.flatMap(s=>s.events);
const recomputed=events.map(evt=>{const eventId=`${original.assets.runId}-evt-${evt.payload.sequence}`;const stored=manifest.events.find(x=>x.id===eventId);return {eventId,eventType:evt.eventType,storedHash:stored?.contentHash,recomputedHash:createHash('sha256').update(JSON.stringify(evt.payload)).digest('hex')}});
save('integrity-event-hashes.json',{runId:original.assets.runId,events:recomputed,note:'Inline payloads round-trip through PostgreSQL JSONB before JSON.stringify; no canonical key ordering is used when originally hashing.'});console.log('Saved per-event hash diagnosis');
