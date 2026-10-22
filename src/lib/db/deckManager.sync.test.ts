import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeckSnapshot, EditFile, EditOp } from '../sync/types';
import type { PendingEdit, SyncStorage } from '../sync/syncStorage';
import { getAllDecks, getReviewLogsByDeck, insertReviewLog, renameDeck, setCardState } from './queries';

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
function fixture() {
  const cloud = new Map<string,string>([[`${DECK}/snapshot.json`,JSON.stringify(snapshot())]]);
  const deletes: string[] = [];
  return { cloud, deletes };
}
async function device(shared: ReturnType<typeof fixture>, id: string, prior?: Map<string,string>) {
  vi.resetModules();
  const manager=await import('./deckManager'); modules.push(manager);
  const local=prior ?? new Map<string,string>();
  const pending=new Map<string,PendingEdit>();
  const archive=new Map<string,PendingEdit>();
  const control={ offline:false, queueFailure:false, archiveFailure:false, checkpointFailure:false,
    barrier:undefined as undefined | (()=>Promise<void>) };
  const storage: SyncStorage={
    async writeFile(key,data) { if(control.offline) throw new Error('cloud offline'); shared.cloud.set(key,data); },
    async readFile(key) { if(control.offline) throw new Error('cloud offline'); return shared.cloud.get(key) ?? null; },
    async deleteFile(key) { shared.deletes.push(key); shared.cloud.delete(key); },
    async listDirectory(prefix) { if(control.offline) throw new Error('cloud offline'); return [...shared.cloud.keys()].filter(key=>key.startsWith(prefix+'/')).map(key=>key.slice(prefix.length+1)).filter(key=>!key.includes('/')); },
    async fileExists(key) { return shared.cloud.has(key); },
    async copyFileToSync() {}, async copyFileFromSync() {},
    async queuePendingEdit(deckId,filename,data) { if(control.queueFailure) throw new Error('queue disk full'); pending.set(`${deckId}/${filename}`,{deckId,filename,data}); },
    async listPendingEdits() { return [...pending.values()]; },
    async removePendingEdit(deckId,filename) { pending.delete(`${deckId}/${filename}`); },
    async archiveEdit(deckId,filename,data) { if(control.archiveFailure) throw new Error('archive disk full'); const key=`${deckId}/${filename}`; const old=archive.get(key); if(old && old.data!==data) throw new Error('immutable identity changed'); archive.set(key,{deckId,filename,data}); },
    async listArchivedEdits() { return [...archive.values()]; },
    async isAvailable() { return !control.offline; },
  };
  const configure=()=>manager.initDeckManager({ SQL, storage, registryJson:JSON.stringify({v:1,deviceId:id,decks:{}}),
    readLocalSnapshot:async key=>local.get(key)??null,
    writeLocalSnapshot:async(key,data)=>{ if(control.checkpointFailure) throw new Error('checkpoint disk full'); const barrier=control.barrier; control.barrier=undefined; if(barrier) await barrier(); local.set(key,data); } });
  configure();
  const db=await manager.openDeck(DECK); expect(db).not.toBeNull();
  return { manager, db:db!, local,pending,archive,control,storage,configure };
}
function name(db: NonNullable<Awaited<ReturnType<(typeof import('./deckManager'))['openDeck']>>>) {
  const decks=getAllDecks(db); if(!decks.success) throw new Error(decks.error); return decks.data[0]?.name;
}
function review(logId: string, reviewedAt: number): Extract<EditOp,{type:'review'}> {
  return { type:'review',cardId:'card',rating:'good',reviewedAt,elapsed:0,scheduledDays:1,logId,
    newState:{cardId:'card',due:reviewedAt+86400,stability:1,difficulty:5,elapsedDays:0,scheduledDays:1,reps:1,lapses:0,state:'review',lastReview:reviewedAt,learningStepIndex:0,suspended:false} };
}
async function commitReview(owner: Awaited<ReturnType<typeof device>>, op: ReturnType<typeof review>) {
  expect(insertReviewLog(owner.db,{id:op.logId,cardId:op.cardId,rating:op.rating,reviewedAt:op.reviewedAt,elapsed:op.elapsed,scheduledDays:op.scheduledDays}).success).toBe(true);
  expect(setCardState(owner.db,op.newState).success).toBe(true);
  return owner.manager.applyAndSync(DECK,[op]);
}

describe('retained canonical deck journals',()=>{
  it('replays an older offline review after our later edit, without losing either device history',async()=>{
    const shared=fixture(); const a=await device(shared,'aaaaaaaa'); const b=await device(shared,'bbbbbbbb');
    const clock=vi.spyOn(Date,'now'); b.control.offline=true; clock.mockReturnValue(NOW);
    await commitReview(b,review('older-review',NOW/1000));
    clock.mockReturnValue(NOW+2000); renameDeck(a.db,DECK,'Later name',NOW/1000+2);
    await a.manager.applyAndSync(DECK,[{type:'deck_rename',name:'Later name'}]);
    b.control.offline=false; await b.manager.flushPendingSync();
    expect(await a.manager.syncDeck(DECK)).toBe(1);
    expect(name(a.db)).toBe('Later name');
    const logs=getReviewLogsByDeck(a.db,DECK); expect(logs.success && logs.data.map(log=>log.id)).toEqual(['older-review']);
    expect(await b.manager.syncDeck(DECK)).toBe(1); expect(name(b.db)).toBe('Later name');
    expect(await a.manager.syncDeck(DECK)).toBe(0); expect(shared.deletes).toEqual([]);
  });

  it('keeps the later rename when an earlier rename arrives last and after reopening offline',async()=>{
    const shared=fixture();const a=await device(shared,'aaaaaaaa');const b=await device(shared,'bbbbbbbb');const clock=vi.spyOn(Date,'now');
    b.control.offline=true;clock.mockReturnValue(NOW);renameDeck(b.db,DECK,'Older',1);await b.manager.applyAndSync(DECK,[{type:'deck_rename',name:'Older'}]);
    clock.mockReturnValue(NOW+2000);renameDeck(a.db,DECK,'Later',2);await a.manager.applyAndSync(DECK,[{type:'deck_rename',name:'Later'}]);
    b.control.offline=false;await b.manager.flushPendingSync();await a.manager.syncDeck(DECK);expect(name(a.db)).toBe('Later');
    a.manager.closeDeck(DECK);a.control.offline=true;const reopened=await a.manager.openDeck(DECK);expect(reopened && name(reopened)).toBe('Later');
  });

  it('actually replays observed remote edits before concurrent checkpoints and never prunes their files',async()=>{
    const shared=fixture();const a=await device(shared,'aaaaaaaa');const b=await device(shared,'bbbbbbbb');
    vi.spyOn(Date,'now').mockReturnValue(NOW); await commitReview(b,review('remote-review',NOW/1000));
    await Promise.all([a.manager.compactDeckEdits(DECK),b.manager.compactDeckEdits(DECK)]);
    const checkpoint=JSON.parse(shared.cloud.get(`${DECK}/snapshot.json`)!) as DeckSnapshot;
    expect(checkpoint.reviewLogs.map(log=>log.id)).toEqual(['remote-review']);expect(checkpoint.replay?.edits).toHaveLength(1);
    expect([...shared.cloud.keys()].some(key=>key.includes('/edits/'))).toBe(true);expect(shared.deletes).toEqual([]);
  });

  it('does not let a stale checkpoint remove already retained edits on either a known or a new device',async()=>{
    const shared=fixture();const a=await device(shared,'aaaaaaaa');vi.spyOn(Date,'now').mockReturnValue(NOW);
    await commitReview(a,review('one',NOW/1000));await a.manager.compactDeckEdits(DECK);const stale=shared.cloud.get(`${DECK}/snapshot.json`)!;
    await commitReview(a,review('two',NOW/1000+1));await a.manager.compactDeckEdits(DECK);shared.cloud.set(`${DECK}/snapshot.json`,stale);
    await a.manager.syncDeck(DECK);expect(getReviewLogsByDeck(a.db,DECK)).toMatchObject({success:true,data:expect.arrayContaining([expect.objectContaining({id:'two'})])});
    const c=await device(shared,'cccccccc');expect(getReviewLogsByDeck(c.db,DECK)).toMatchObject({success:true,data:expect.arrayContaining([expect.objectContaining({id:'two'})])});
  });

  it('does not archive or publish a save whose required queue write failed',async()=>{
    const a=await device(fixture(),'aaaaaaaa');a.control.queueFailure=true;
    await expect(a.manager.applyAndSync(DECK,[{type:'deck_rename',name:'Failed'}])).rejects.toThrow('queue disk full');
    expect(a.pending.size).toBe(0);expect(a.archive.size).toBe(0);expect(name(a.db)).toBe('Original');
  });

  it('keeps a committed queue entry when retaining its replay copy fails, then recovers it',async()=>{
    const a=await device(fixture(),'aaaaaaaa');a.control.archiveFailure=true;
    renameDeck(a.db,DECK,'Durable pending',2);expect(await a.manager.applyAndSync(DECK,[{type:'deck_rename',name:'Durable pending'}])).toBeTruthy();
    expect(a.pending.size).toBe(1);expect(a.archive.size).toBe(0);a.manager.closeDeck(DECK);
    a.control.archiveFailure=false;const reopened=await a.manager.openDeck(DECK);expect(reopened && name(reopened)).toBe('Durable pending');expect(a.archive.size).toBe(1);
  });

  it('preserves the live deck when its replacement checkpoint write fails and retries the retained remote review',async()=>{
    const shared=fixture();const a=await device(shared,'aaaaaaaa');const b=await device(shared,'bbbbbbbb');await commitReview(b,review('kept-review',NOW/1000));
    a.control.checkpointFailure=true;await expect(a.manager.syncDeck(DECK)).rejects.toThrow('checkpoint disk full');
    expect(getReviewLogsByDeck(a.db,DECK)).toEqual({success:true,data:[]});expect(a.archive.size).toBe(1);expect(shared.deletes).toEqual([]);
    a.control.checkpointFailure=false;expect(await a.manager.syncDeck(DECK)).toBe(1);expect(getReviewLogsByDeck(a.db,DECK)).toMatchObject({success:true,data:[expect.objectContaining({id:'kept-review'})]});
  });

  it('rejects conflicting immutable identities and keeps the existing local study',async()=>{
    const shared=fixture();const a=await device(shared,'aaaaaaaa');const hlc=await a.manager.applyAndSync(DECK,[{type:'deck_rename',name:'Stored'}]);
    if (!hlc) throw new Error('Fixture edit was not saved');
    shared.cloud.set(`${DECK}/edits/${hlc}.json`,JSON.stringify({v:1,hlc,deviceId:'aaaaaaaa',deckId:DECK,ops:[{type:'deck_rename',name:'Conflicting'}]} satisfies EditFile));
    await expect(a.manager.syncDeck(DECK)).rejects.toThrow('reuse an edit identity');expect(name(a.db)).toBe('Original');expect(a.archive.size).toBe(1);
  });

  it('does not replace local study with a peer checkpoint from an unverified baseline',async()=>{
    const shared=fixture();const a=await device(shared,'aaaaaaaa');const foreign=snapshot();foreign.deck.name='Different baseline';
    shared.cloud.set(`${DECK}/snapshot.json`,JSON.stringify({...foreign,replay:{v:1,base:foreign,edits:[]}}));
    await expect(a.manager.syncDeck(DECK)).rejects.toThrow('different saved sync baselines');expect(name(a.db)).toBe('Original');
  });

  it('retries canonical preparation when a local edit commits during the checkpoint await',async()=>{
    const shared=fixture();const a=await device(shared,'aaaaaaaa');const b=await device(shared,'bbbbbbbb');await commitReview(b,review('remote',NOW/1000));
    let release:(()=>void)|undefined;let entered:(()=>void)|undefined;
    const blocked=new Promise<void>(resolve=>{entered=resolve;});
    a.control.barrier=()=>{entered?.();return new Promise<void>(resolve=>{release=resolve;});};
    const syncing=a.manager.syncDeck(DECK);await blocked;
    renameDeck(a.db,DECK,'During checkpoint',2);await a.manager.applyAndSync(DECK,[{type:'deck_rename',name:'During checkpoint'}]);release?.();
    await syncing;expect(name(a.db)).toBe('During checkpoint');expect(getReviewLogsByDeck(a.db,DECK)).toMatchObject({success:true,data:[expect.objectContaining({id:'remote'})]});
  });

  it('heals a durable local operation even if its caller did not finish applying it to the live cache',async()=>{
    const a=await device(fixture(),'aaaaaaaa');await a.manager.applyAndSync(DECK,[{type:'deck_rename',name:'Queued first'}]);
    expect(name(a.db)).toBe('Original');await a.manager.syncDeck(DECK);expect(name(a.db)).toBe('Queued first');
  });

  it('rolls back the entire live replacement on SQL failure without deleting its journal',async()=>{
    const shared=fixture();const a=await device(shared,'aaaaaaaa');const b=await device(shared,'bbbbbbbb');await commitReview(b,review('recoverable',NOW/1000));
    a.db.run("CREATE TRIGGER block_sync BEFORE INSERT ON cards BEGIN SELECT RAISE(ABORT,'blocked replacement'); END");
    await expect(a.manager.syncDeck(DECK)).rejects.toThrow('blocked replacement');
    expect(name(a.db)).toBe('Original');expect(a.db.exec('SELECT id FROM cards')[0]?.values).toEqual([['card']]);
    expect(getReviewLogsByDeck(a.db,DECK)).toEqual({success:true,data:[]});expect(shared.deletes).toEqual([]);
    a.db.run('DROP TRIGGER block_sync');await a.manager.syncDeck(DECK);
    expect(getReviewLogsByDeck(a.db,DECK)).toMatchObject({success:true,data:[expect.objectContaining({id:'recoverable'})]});
  });

  it('advances past retained clocks after a restart and a backwards wall clock',async()=>{
    const shared=fixture();const a=await device(shared,'aaaaaaaa');const clock=vi.spyOn(Date,'now').mockReturnValue(NOW);
    const first=await a.manager.applyAndSync(DECK,[{type:'deck_rename',name:'First'}]);await a.manager.compactDeckEdits(DECK);
    a.manager.closeDeck(DECK);clock.mockReturnValue(NOW-10000);a.configure();const reopened=await a.manager.openDeck(DECK);expect(reopened).not.toBeNull();
    const next=await a.manager.applyAndSync(DECK,[{type:'deck_rename',name:'After restart'}]);expect(next!>first!).toBe(true);expect(a.archive.size).toBe(2);
  });
});
