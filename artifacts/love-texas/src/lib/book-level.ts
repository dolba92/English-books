import type { BookChapter } from './storage';
import { getEfllexLevel } from './efllex-data';

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

const IRREGULAR: Record<string, string> = {
  children:'child', men:'man', women:'woman', feet:'foot', teeth:'tooth', mice:'mouse',
  went:'go', gone:'go', came:'come', saw:'see', seen:'see', knew:'know', known:'know',
  thought:'think', brought:'bring', bought:'buy', caught:'catch', taught:'teach',
  heard:'hear', felt:'feel', left:'leave', kept:'keep', slept:'sleep', stood:'stand',
  understood:'understand', wrote:'write', written:'write', spoke:'speak', spoken:'speak',
  took:'take', taken:'take', gave:'give', given:'give', made:'make', ran:'run'
};

function cleanWord(word: string) {
  return word.toLowerCase().replace(/[’]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '');
}

function lemma(word: string): string {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (getEfllexLevel(word)) return word;

  const c: string[] = [];
  if (word.endsWith('ies') && word.length > 4) c.push(word.slice(0,-3)+'y');
  if (word.endsWith('ied') && word.length > 4) c.push(word.slice(0,-3)+'y');
  if (word.endsWith('ing') && word.length > 5) {
    const s=word.slice(0,-3); c.push(s,s+'e');
    if (/(.)\1$/.test(s)) c.push(s.slice(0,-1));
  }
  if (word.endsWith('ed') && word.length > 4) {
    const s=word.slice(0,-2); c.push(s,s+'e');
    if (/(.)\1$/.test(s)) c.push(s.slice(0,-1));
  }
  if (word.endsWith('es') && word.length > 4) c.push(word.slice(0,-2),word.slice(0,-1));
  if (word.endsWith('s') && word.length > 3) c.push(word.slice(0,-1));

  return c.find(x => getEfllexLevel(x)) || word;
}

function collectSample(chapters: BookChapter[], target=18000) {
  const ps=chapters.flatMap(c=>c.paragraphs||[])
    .map(p=>p.replace(/\s+/g,' ').trim()).filter(p=>p.length>=40);
  if (!ps.length) return '';
  const n=Math.min(ps.length,300), step=ps.length/n, out:string[]=[];
  for(let i=0;i<n;i++) out.push(ps[Math.min(ps.length-1,Math.floor(i*step))]);
  return out.join(' ').split(/\s+/).slice(0,target).join(' ');
}

function sentences(text:string) {
  return text.replace(/([.!?])["”’)]/g,'$1 ')
    .split(/[.!?]+(?:\s+|$)/).map(s=>s.trim()).filter(s=>s.length>8);
}

function clauseComplexity(s:string) {
  const x=s.toLowerCase();
  const markers=/\b(although|though|whereas|while|unless|despite|whilst|whenever|wherever|however|which|whose|whom)\b/g;
  return (x.match(markers)||[]).length + Math.min(3,(s.match(/[,;:—–]/g)||[]).length*.3);
}

export function analyzeBookLevel(chapters: BookChapter[]): BookLevelAnalysis {
  const sample=collectSample(chapters);
  const original=sample.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)||[];
  const words=original.map(cleanWord).filter(Boolean);

  if(words.length<120) return {
    level:'A2',score:20,averageSentenceLength:0,averageWordLength:0,
    longWordRatio:0,advancedWordRatio:0,lexicalDiversity:0,sampledWords:words.length
  };

  const ss=sentences(sample);
  const lens=ss.map(s=>(s.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)||[]).length)
    .filter(n=>n>0&&n<120);
  const avgSentence=lens.reduce((a,b)=>a+b,0)/Math.max(1,lens.length);
  const avgWord=words.reduce((a,w)=>a+w.length,0)/words.length;
  const longRatio=words.filter(w=>w.length>=9).length/words.length;

  const lemmas=words.map(lemma);
  const content=lemmas.filter(w=>w.length>=4);

  let known=0, levelTotal=0, advanced=0, unknown=0;
  for(const w of content){
    const l=getEfllexLevel(w);
    if(l){
      known++;
      levelTotal+=l;
      if(l>=4) advanced++;
    } else {
      // Unknown lexical items are often exactly the rare words missing from a learner corpus.
      // Give them C1-ish weight, but don't let names/oddities dominate the whole book.
      unknown++;
      levelTotal+=4.6;
      advanced++;
    }
  }

  const avgLexLevel=levelTotal/Math.max(1,content.length);
  const unknownRatio=unknown/Math.max(1,content.length);
  const advancedRatio=advanced/Math.max(1,content.length);

  const diversities:number[]=[];
  for(let i=0;i<lemmas.length;i+=500){
    const w=lemmas.slice(i,i+500); if(w.length<150) break;
    diversities.push(new Set(w).size/w.length);
  }
  const diversity=diversities.reduce((a,b)=>a+b,0)/Math.max(1,diversities.length);
  const clause=ss.map(clauseComplexity).reduce((a,b)=>a+b,0)/Math.max(1,ss.length);

  // EFLLex is the core signal. Syntax and lexical diversity refine it.
  // Score bands below map to A1..C2 and are deliberately broad.
  const lexicalScore=(avgLexLevel-1)*12.5;
  const advancedScore=Math.min(14,advancedRatio*42);
  const unknownScore=Math.min(10,unknownRatio*30);
  const sentenceScore=Math.max(0,Math.min(12,(avgSentence-8)*.8));
  const clauseScore=Math.min(8,clause*4);
  const diversityScore=Math.max(0,Math.min(8,(diversity-.40)*35));

  let score=lexicalScore+advancedScore+unknownScore+sentenceScore+clauseScore+diversityScore;

  // Avoid C2 from a few fantasy/place names alone.
  if(unknownRatio>.35 && avgLexLevel<3.0) score-=4;

  let level:CefrLevel;
  if(score<18) level='A1';
  else if(score<29) level='A2';
  else if(score<41) level='B1';
  else if(score<54) level='B2';
  else if(score<68) level='C1';
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
