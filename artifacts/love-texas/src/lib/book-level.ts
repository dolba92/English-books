import type { BookChapter } from './storage';
import { getEfllexProfile } from './efllex-profile-data';

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface BookLevelAnalysis {
  level: CefrLevel;
  score: number;
  averageSentenceLength: number;
  averageWordLength: number;
  longWordRatio: number;
  advancedWordRatio: number;
  lexicalDiversity: number;
  sampledWords: number;
}

const IRREGULAR: Record<string,string> = {
  children:'child',men:'man',women:'woman',feet:'foot',teeth:'tooth',mice:'mouse',
  went:'go',gone:'go',came:'come',saw:'see',seen:'see',knew:'know',known:'know',
  thought:'think',brought:'bring',bought:'buy',caught:'catch',taught:'teach',
  heard:'hear',felt:'feel',left:'leave',kept:'keep',slept:'sleep',stood:'stand',
  understood:'understand',wrote:'write',written:'write',spoke:'speak',spoken:'speak',
  took:'take',taken:'take',gave:'give',given:'give',made:'make',ran:'run'
};

function clean(w:string) {
  return w.toLowerCase().replace(/[’]/g,"'").replace(/^[^a-z]+|[^a-z]+$/g,'');
}

function hasProfile(w:string) { return !!getEfllexProfile(w); }

function lemma(w:string):string {
  if(IRREGULAR[w]) return IRREGULAR[w];
  if(hasProfile(w)) return w;
  const c:string[]=[];
  if(w.endsWith('ies')&&w.length>4)c.push(w.slice(0,-3)+'y');
  if(w.endsWith('ied')&&w.length>4)c.push(w.slice(0,-3)+'y');
  if(w.endsWith('ing')&&w.length>5){
    const s=w.slice(0,-3); c.push(s,s+'e');
    if(/(.)\1$/.test(s))c.push(s.slice(0,-1));
  }
  if(w.endsWith('ed')&&w.length>4){
    const s=w.slice(0,-2); c.push(s,s+'e');
    if(/(.)\1$/.test(s))c.push(s.slice(0,-1));
  }
  if(w.endsWith('es')&&w.length>4)c.push(w.slice(0,-2),w.slice(0,-1));
  if(w.endsWith('s')&&w.length>3)c.push(w.slice(0,-1));
  return c.find(hasProfile)||w;
}

function sampleBook(chapters:BookChapter[],target=18000){
  const ps=chapters.flatMap(c=>c.paragraphs||[])
    .map(p=>p.replace(/\s+/g,' ').trim()).filter(p=>p.length>=40);
  if(!ps.length)return '';
  const n=Math.min(ps.length,320),step=ps.length/n,out:string[]=[];
  for(let i=0;i<n;i++)out.push(ps[Math.min(ps.length-1,Math.floor(i*step))]);
  return out.join(' ').split(/\s+/).slice(0,target).join(' ');
}

function splitSentences(text:string){
  return text.replace(/([.!?])["”’)]/g,'$1 ')
    .split(/[.!?]+(?:\s+|$)/).map(s=>s.trim()).filter(s=>s.length>8);
}

function syntaxComplexity(s:string){
  const x=s.toLowerCase();
  const markers=/\b(although|though|whereas|while|unless|despite|whilst|whenever|wherever|however|which|whose|whom|whether)\b/g;
  return (x.match(markers)||[]).length+Math.min(3,(s.match(/[,;:—–]/g)||[]).length*.28);
}

/*
  Convert an EFLLex frequency profile to a "late-level tendency".

  Important: a word is NOT assigned to the first/maximum CEFR bucket.
  We use its whole A1..C1 distribution, with a small prior so a single
  corpus occurrence cannot make an everyday word look "C1".
*/
function profileDifficulty(p:readonly number[]):number{
  const sum=p.reduce((a,b)=>a+b,0);
  if(sum<=0)return 0;

  const prior=0.35;
  const smoothed=p.map(v=>v+prior);
  const denom=smoothed.reduce((a,b)=>a+b,0);
  const weighted=smoothed.reduce((a,v,i)=>a+v*(i+1),0)/denom; // 1..5

  // Strong early-level evidence reduces the difficulty of words that also
  // happen to occur in later materials.
  const early=(p[0]+p[1])/(sum+1e-9);
  const late=(p[3]+p[4])/(sum+1e-9);
  return Math.max(1,Math.min(5,weighted + late*.22 - early*.12));
}

export function analyzeBookLevel(chapters:BookChapter[]):BookLevelAnalysis{
  const text=sampleBook(chapters);
  const tokens=text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)||[];
  const words=tokens.map(clean).filter(Boolean);

  if(words.length<120)return {
    level:'A2',score:20,averageSentenceLength:0,averageWordLength:0,
    longWordRatio:0,advancedWordRatio:0,lexicalDiversity:0,sampledWords:words.length
  };

  const ss=splitSentences(text);
  const sl=ss.map(s=>(s.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)||[]).length)
    .filter(n=>n>0&&n<120);
  const avgSentence=sl.reduce((a,b)=>a+b,0)/Math.max(1,sl.length);
  const avgWord=words.reduce((a,w)=>a+w.length,0)/words.length;
  const longRatio=words.filter(w=>w.length>=9).length/words.length;

  const lemmas=words.map(lemma);
  const content=lemmas.filter(w=>w.length>=4);

  let knownDifficulty=0,known=0,advancedKnown=0;
  for(const w of content){
    const p=getEfllexProfile(w);
    if(!p)continue;
    const d=profileDifficulty(p);
    knownDifficulty+=d;
    known++;
    if(d>=3.65)advancedKnown++;
  }

  // Unknown words are deliberately NOT all called C1.
  // Proper names, invented fantasy terms and parser noise otherwise punish
  // Harry Potter/Percy Jackson unfairly. Only a small capped rarity signal remains.
  const unknown=Math.max(0,content.length-known);
  const unknownRatio=unknown/Math.max(1,content.length);
  const avgLex=knownDifficulty/Math.max(1,known);
  const advancedRatio=advancedKnown/Math.max(1,known);

  const ds:number[]=[];
  for(let i=0;i<lemmas.length;i+=500){
    const w=lemmas.slice(i,i+500); if(w.length<150)break;
    ds.push(new Set(w).size/w.length);
  }
  const diversity=ds.reduce((a,b)=>a+b,0)/Math.max(1,ds.length);
  const syntax=ss.map(syntaxComplexity).reduce((a,b)=>a+b,0)/Math.max(1,ss.length);

  // Vocabulary profile is central, but syntax and diversity can move a book
  // roughly one band. Unknown vocabulary has a deliberately small cap.
  const lexicalScore=Math.max(0,(avgLex-1.55)*18);
  const advancedScore=Math.min(10,advancedRatio*30);
  const sentenceScore=Math.max(0,Math.min(10,(avgSentence-8)*.72));
  const syntaxScore=Math.min(8,syntax*3.7);
  const diversityScore=Math.max(0,Math.min(8,(diversity-.43)*32));
  const rarityScore=Math.min(5,unknownRatio*12);

  let score=lexicalScore+advancedScore+sentenceScore+syntaxScore+diversityScore+rarityScore;

  // Keep the top end conservative. C2 should mean exceptionally dense prose,
  // not merely a fantasy novel with invented vocabulary.
  if(avgSentence<11.5 && avgLex<3.15)score-=2;
  if(avgSentence>=14 && diversity>=.55 && avgLex>=3.0)score+=3;

  let level:CefrLevel;
  if(score<16)level='A1';
  else if(score<27)level='A2';
  else if(score<39)level='B1';
  else if(score<52)level='B2';
  else if(score<66)level='C1';
  else level='C2';

  return {
    level,
    score:Math.round(score*10)/10,
    averageSentenceLength:Math.round(avgSentence*10)/10,
    averageWordLength:Math.round(avgWord*100)/100,
    longWordRatio:Math.round(longRatio*1000)/1000,
    advancedWordRatio:Math.round(advancedRatio*1000)/1000,
    lexicalDiversity:Math.round(diversity*1000)/1000,
    sampledWords:words.length
  };
}
