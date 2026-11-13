import {act,renderHook} from '@testing-library/react';
import {expect,test,vi} from 'vitest';
import {useFeedback} from '../../src/hooks/use-feedback';
import {createReviewModel} from '../../src/review';
import type {Workspace,FeedbackComment} from '../../src/types';
function workspace(comments:FeedbackComment[]):Workspace{return {version:'v1',repositoryId:'repo',comparisonId:'comparison',comparison:{kind:'commits',beforeRef:'a',afterRef:'b'},repo:{name:'test',path:'/test',branch:'main',source:'git'},groups:[],sections:[{id:'s',path:'code.ts',role:'Code',lines:[]}],planStatus:'none',cycle:{pass:{id:'pass',snapshotId:'v1',previousPassId:null,createdAt:'',decisions:{},checks:{},planRevision:0,groups:[],planHistory:[]},feedback:{comments,general:'',revision:0},history:[],changes:{matches:{},removed:[]},previousDecisions:{},latestSnapshotId:'v1',proposals:[],reports:[],batches:[],storage:{bytes:0,snapshots:1}}};}
const original:FeedbackComment={id:'c',path:'code.ts',text:'Original',intent:'change',status:'open',revision:1};
function api(get:()=>Workspace){vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:RequestInit)=>{const w=get();if(!options?.body)return new Response(JSON.stringify({workspace:w,revision:1}));const {input}=JSON.parse(options.body as string);const c=w.cycle!.feedback.comments.find(c=>c.id===input.id)!;if(input.expectedRevision!==c.revision)return new Response(JSON.stringify({message:'Conflict',current:c}),{status:409});Object.assign(c,input.patch,{revision:c.revision!+1});return new Response(JSON.stringify({workspace:w,revision:2,result:c}));}));}
test('conflicts retain the draft and Use latest loads the actual server revision',async()=>{
 let server=workspace([{...original}]);api(()=>server);const {result,rerender}=renderHook(({w})=>useFeedback(w,createReviewModel(w).createReview()),{initialProps:{w:server}});
 act(()=>result.current.update('c',{text:'My draft'}));server=workspace([{...original,text:'Other window',revision:2}]);rerender({w:server});
 await act(async()=>{await result.current.flush();});expect(result.current.conflict).toBe(true);expect(result.current.state.comments[0].text).toBe('My draft');
 act(()=>result.current.useLatest());expect(result.current.state.comments[0].text).toBe('Other window');
});
test('recovered drafts keep their original expected revision instead of overwriting newer text',async()=>{
 let server=workspace([{...original}]);api(()=>server);const first=renderHook(()=>useFeedback(server,createReviewModel(server).createReview()));act(()=>first.result.current.update('c',{text:'Recovered draft'}));first.unmount();
 server=workspace([{...original,text:'New server text',revision:2}]);const second=renderHook(()=>useFeedback(server,createReviewModel(server).createReview()));
 await act(async()=>{await second.result.current.flush();});expect(second.result.current.conflict).toBe(true);expect(server.cycle!.feedback.comments[0].text).toBe('New server text');expect(second.result.current.state.comments[0].text).toBe('Recovered draft');
});
