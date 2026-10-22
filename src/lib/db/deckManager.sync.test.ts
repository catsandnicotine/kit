import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeckSnapshot, EditFile, EditOp } from '../sync/types';
import type { PendingEdit, SyncStorage } from '../sync/syncStorage';
import { replayEdits } from '../sync/replay';
import {
  deleteCardState, deleteReviewLog, getAllDecks, getCardStatesByDeck,
  getReviewLogsByDeck, insertReviewLog, renameDeck, setCardState, setCardSuspended,
} from './queries';

let SQL: SqlJsStatic;
const DECK = 'sync-fixture';
const NOW = 1_700_000_000_000;
const modules: Array<typeof import('./deckManager')> = [];
beforeAll(async () => { SQL = await initSqlJs({ locateFile:file => path.join(process.cwd(), 'node_modules/sql.js/dist', file) }); });
afterEach(() => { modules.forEach(manager => manager.closeDeck(DECK)); modules.length=0; vi.restoreAllMocks(); });

function snapshot(): DeckSnapshot {
  return { v:1, deckId:DECK, compactedThrough:'', mergedEditFiles:[],
    deck:{ id:DECK, name:'Original', description:'', createdAt:1, updatedAt:1 },
    settings:{ deckId:DECK,newCardsPerDay:20,maxReviewsPerDay:200,againSteps:[1,10],graduatingInterval:1,easyInterval:4,maxInterval:365,leechThreshold:8,desiredRetention:0.9 },
    noteTypes:[],notes:[],cards:[{ id:'card',deckId:DECK,noteId:null,front:'Question',back:'Answer',tags:[],createdAt:1,updatedAt:1 }],
    cardStates:[],reviewLogs:[],tags:[],deckTags:[],deletedCardIds:[] };
}
async function fixture() {
  vi.resetModules();
  const manager=await import('./deckManager'); modules.push(manager);
  const cloud=new Map<string,string>([[`${DECK}/snapshot.json`,JSON.stringify(snapshot())]]);
  const local=new Map<string,string>();
  const pending=new Map<string,PendingEdit>();
  const deletes:string[]=[];
  const control={offline:false,queueFailure:false,checkpointFailure:false};
  const storage:SyncStorage={
    async writeFile(key,data) { if(control.offline) throw new Error('cloud offline'); cloud.set(key,data); },
    async readFile(key) { if(control.offline) throw new Error('cloud offline'); return cloud.get(key)??null; },
    async deleteFile(key) { deletes.push(key);cloud.delete(key); },
    async listDirectory(prefix) { if(control.offline) throw new Error('cloud offline'); return [...cloud.keys()].filter(key=>key.startsWith(prefix+'/')).map(key=>key.slice(prefix.length+1)).filter(key=>!key.includes('/')); },
    async fileExists(key) { return cloud.has(key); },
    async copyFileToSync() {},async copyFileFromSync() {},
    async queuePendingEdit(deckId,filename,data) { if(control.queueFailure) throw new Error('queue disk full');pending.set(`${deckId}/${filename}`,{deckId,filename,data}); },
    async listPendingEdits() { return [...pending.values()]; },
    async removePendingEdit(deckId,filename) { pending.delete(`${deckId}/${filename}`); },
    async isAvailable() { return !control.offline; },
  };
  manager.initDeckManager({SQL,storage,registryJson:JSON.stringify({v:1,deviceId:'aaaaaaaa',decks:{}}),
    readLocalSnapshot:async key=>local.get(key)??null,
    writeLocalSnapshot:async(key,data)=>{if(control.checkpointFailure) throw new Error('checkpoint disk full');local.set(key,data);},
  });
  const db=await manager.openDeck(DECK);if(!db) throw new Error('Fixture could not open');
  return {manager,db,cloud,local,pending,deletes,control};
}
function review():Extract<EditOp,{type:'review'}> {
  return {type:'review',cardId:'card',rating:'good',reviewedAt:NOW/1000,elapsed:0,scheduledDays:1,logId:'log',
    newState:{cardId:'card',due:NOW/1000+86400,stability:1,difficulty:5,elapsedDays:0,scheduledDays:1,reps:1,lapses:0,state:'review',lastReview:NOW/1000,learningStepIndex:0,suspended:false}};
}
async function saveReview(owner:Awaited<ReturnType<typeof fixture>>) {
  const op=review();
  expect(insertReviewLog(owner.db,{id:op.logId,cardId:op.cardId,rating:op.rating,reviewedAt:op.reviewedAt,elapsed:op.elapsed,scheduledDays:op.scheduledDays}).success).toBe(true);
  expect(setCardState(owner.db,op.newState).success).toBe(true);
  await owner.manager.applyAndSync(DECK,[op]);
}
function cloudSnapshot(owner:Awaited<ReturnType<typeof fixture>>):DeckSnapshot {
  return JSON.parse(owner.cloud.get(`${DECK}/snapshot.json`)! ) as DeckSnapshot;
}

describe('non-destructive live deck checkpoints',()=>{
  it('keeps a local Undo instead of replaying its original rating back over the live cache',async()=>{
    const owner=await fixture();await saveReview(owner);
    expect(deleteCardState(owner.db,'card').success).toBe(true);expect(deleteReviewLog(owner.db,'log').success).toBe(true);
    expect(await owner.manager.compactDeckEdits(DECK)).toBe(true);
    expect(owner.manager.getDeckDb(DECK)).toBe(owner.db);
    expect(getReviewLogsByDeck(owner.db,DECK)).toEqual({success:true,data:[]});
    expect(cloudSnapshot(owner).reviewLogs).toEqual([]);expect(cloudSnapshot(owner).cardStates).toEqual([]);
    owner.manager.closeDeck(DECK);owner.control.offline=true;
    const reopened=await owner.manager.openDeck(DECK);expect(reopened).not.toBeNull();
    expect(getReviewLogsByDeck(reopened!,DECK)).toEqual({success:true,data:[]});
  });

  it('preserves local automatic leech suspension after the review was journaled',async()=>{
    const owner=await fixture();await saveReview(owner);expect(setCardSuspended(owner.db,'card',true).success).toBe(true);
    expect(await owner.manager.compactDeckEdits(DECK)).toBe(true);
    expect(getCardStatesByDeck(owner.db,DECK)).toMatchObject({success:true,data:[{suspended:true}]});
    expect(cloudSnapshot(owner).cardStates[0]?.suspended).toBe(true);
    owner.manager.closeDeck(DECK);const reopened=await owner.manager.openDeck(DECK);
    expect(getCardStatesByDeck(reopened!,DECK)).toMatchObject({success:true,data:[{suspended:true}]});
  });

  it('does not replace a live local change when its edit queue write failed',async()=>{
    const owner=await fixture();expect(renameDeck(owner.db,DECK,'Keep local change',2).success).toBe(true);owner.control.queueFailure=true;
    await expect(owner.manager.applyAndSync(DECK,[{type:'deck_rename',name:'Keep local change'}])).rejects.toThrow('queue disk full');
    expect(await owner.manager.compactDeckEdits(DECK)).toBe(true);
    expect(getAllDecks(owner.db)).toMatchObject({success:true,data:[{name:'Keep local change'}]});
    expect(JSON.parse(owner.local.get(DECK)!)).toMatchObject({deck:{name:'Keep local change'}});
  });

  it('retains unobserved remote edits and does not claim they were included in a checkpoint',async()=>{
    const owner=await fixture();const edit:EditFile={v:1,deckId:DECK,deviceId:'bbbbbbbb',hlc:'1700000000000_bbbbbbbb_0000',ops:[{type:'deck_rename',name:'Remote change'}]};
    const key=`${DECK}/edits/${edit.hlc}.json`;owner.cloud.set(key,JSON.stringify(edit));
    expect(await owner.manager.compactDeckEdits(DECK)).toBe(true);
    expect(owner.deletes).toEqual([]);expect(owner.cloud.get(key)).toBe(JSON.stringify(edit));
    expect(cloudSnapshot(owner).compactedThrough).toBe('');expect(cloudSnapshot(owner).deck.name).toBe('Original');
    expect(await owner.manager.syncDeck(DECK)).toBe(1);
    expect(getAllDecks(owner.db)).toMatchObject({success:true,data:[{name:'Remote change'}]});
  });

  it('keeps queued offline edits during checkpoint failure and uploads them only on a later retry',async()=>{
    const owner=await fixture();owner.control.offline=true;await saveReview(owner);
    expect(owner.pending.size).toBe(1);expect(await owner.manager.compactDeckEdits(DECK)).toBe(false);
    expect(owner.pending.size).toBe(1);expect(owner.deletes).toEqual([]);
    expect(JSON.parse(owner.local.get(DECK)!)).toMatchObject({reviewLogs:[{id:'log'}]});
    owner.control.offline=false;expect(await owner.manager.flushPendingSync()).toBe(1);expect(owner.pending.size).toBe(0);
    expect([...owner.cloud.keys()].some(key=>key.includes('/edits/'))).toBe(true);
  });

  it('reports a failed local checkpoint without replacing the live database or mirroring stale state',async()=>{
    const owner=await fixture();expect(renameDeck(owner.db,DECK,'Still here',2).success).toBe(true);owner.control.checkpointFailure=true;
    const previous=owner.cloud.get(`${DECK}/snapshot.json`);
    expect(await owner.manager.compactDeckEdits(DECK)).toBe(false);
    expect(owner.manager.getDeckDb(DECK)).toBe(owner.db);expect(getAllDecks(owner.db)).toMatchObject({success:true,data:[{name:'Still here'}]});
    expect(owner.cloud.get(`${DECK}/snapshot.json`)).toBe(previous);expect(owner.deletes).toEqual([]);
  });
});


describe('transaction-safe duplicate replay',()=>{
  it('accepts duplicate valid review identities without adding a second log',async()=>{
    const owner=await fixture();const edit:EditFile={v:1,deckId:DECK,deviceId:'bbbbbbbb',hlc:'1700000000000_bbbbbbbb_0000',ops:[review()]};
    expect(replayEdits(owner.db,[edit],new Set())).toBe(edit.hlc);
    expect(replayEdits(owner.db,[edit],new Set())).toBe(edit.hlc);
    expect(getReviewLogsByDeck(owner.db,DECK)).toMatchObject({success:true,data:[{id:'log'}]});
  });

  it('rolls back every operation when a new review violates a required SQL field',async()=>{
    const owner=await fixture();const malformed=JSON.parse(JSON.stringify({...review(),rating:null})) as EditOp;
    const edit:EditFile={v:1,deckId:DECK,deviceId:'bbbbbbbb',hlc:'1700000000000_bbbbbbbb_0000',ops:[{type:'deck_rename',name:'Must roll back'},malformed]};
    const deleted=new Set<string>();expect(replayEdits(owner.db,[edit],deleted)).toBeNull();
    expect(getAllDecks(owner.db)).toMatchObject({success:true,data:[{name:'Original'}]});
    expect(getReviewLogsByDeck(owner.db,DECK)).toEqual({success:true,data:[]});
    expect(getCardStatesByDeck(owner.db,DECK)).toEqual({success:true,data:[]});expect([...deleted]).toEqual([]);
  });

  it('does not acknowledge an invalid new card as a harmless duplicate',async()=>{
    const owner=await fixture();const card={...snapshot().cards[0]!,id:'bad-card',front:null};
    const malformed=JSON.parse(JSON.stringify({type:'card_add',card})) as EditOp;
    const edit:EditFile={v:1,deckId:DECK,deviceId:'bbbbbbbb',hlc:'1700000000000_bbbbbbbb_0000',ops:[{type:'deck_rename',name:'Must roll back'},malformed]};
    expect(replayEdits(owner.db,[edit],new Set())).toBeNull();
    expect(getAllDecks(owner.db)).toMatchObject({success:true,data:[{name:'Original'}]});
    expect(owner.db.exec('SELECT id FROM cards')[0]?.values).toEqual([['card']]);
  });
});


describe('failed replay does not advance delivery coverage',()=>{
  it('keeps the live cache and source file when remote replay fails, then permits retry',async()=>{
    const owner=await fixture();const valid:EditFile={v:1,deckId:DECK,deviceId:'bbbbbbbb',hlc:'1700000000000_bbbbbbbb_0000',ops:[review()]};
    const invalid={...valid,ops:[{...review(),rating:null}]};const key=`${DECK}/edits/${valid.hlc}.json`;
    owner.cloud.set(key,JSON.stringify(invalid));
    await expect(owner.manager.syncDeck(DECK)).rejects.toThrow('could not be applied');
    expect(getReviewLogsByDeck(owner.db,DECK)).toEqual({success:true,data:[]});expect(owner.cloud.get(key)).toBe(JSON.stringify(invalid));
    owner.cloud.set(key,JSON.stringify(valid));expect(await owner.manager.syncDeck(DECK)).toBe(1);
    expect(getReviewLogsByDeck(owner.db,DECK)).toMatchObject({success:true,data:[{id:'log'}]});
  });

  it('does not cache or expose an incompletely replayed deck on open',async()=>{
    const owner=await fixture();owner.manager.closeDeck(DECK);
    const invalid={v:1,deckId:DECK,deviceId:'bbbbbbbb',hlc:'1700000000000_bbbbbbbb_0000',ops:[{...review(),rating:null}]};
    owner.cloud.set(`${DECK}/edits/${invalid.hlc}.json`,JSON.stringify(invalid));
    expect(await owner.manager.openDeck(DECK)).toBeNull();expect(owner.manager.getDeckDb(DECK)).toBeNull();
    expect(owner.manager.isDeckFailed(DECK)).toBe(true);expect(owner.deletes).toEqual([]);
  });
});
