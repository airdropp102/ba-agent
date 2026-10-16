#!/usr/bin/env node
/** Static prompt measurements only: no provider imports, credentials, or model calls. */
import {readFileSync} from 'node:fs';
import {ANALYSIS_SKILLS,analysisPolicyFor,buildAnalysisPrompt,buildPrototypePrompt,promptMetadata} from '../src/ba-prompts.js';
import {validateCorpus} from '../src/live-acceptance.js';

const args=process.argv.slice(2);
try {
 if(args.some((arg,i)=>!(arg==='--corpus'||(i>0&&args[i-1]==='--corpus')))||args.filter(x=>x==='--corpus').length>1)throw new Error('Use eval:prompts [--corpus /private/reviewed.json]');
 const index=args.indexOf('--corpus');
 if(index>=0&&!args[index+1])throw new Error('Missing --corpus file');
 const reviewed=index>=0;
 const corpus=JSON.parse(readFileSync(reviewed?args[index+1]:new URL('../eval/ba-gold-v1.json',import.meta.url),'utf8'));
 const admission=reviewed?validateCorpus(corpus):null;
 // Reconstruct the previous assembly algorithm against the SAME current skill files.
 // This isolates selection/truncation; it is not a historical whole-prompt snapshot.
 const legacy=[...ANALYSIS_SKILLS,'ba-analyzing-erp'].map(name=>readFileSync(new URL(`../skills/${name}/SKILL.md`,import.meta.url),'utf8').replace(/^---\n[\s\S]*?\n---\n/,'').slice(0,4600)).join('\n\n--- DOMAIN RULE ---\n');
 const baselineBytes=Buffer.byteLength(legacy);
 const profiles=[['general',null],['erp',{domain:'erp'}]].map(([domain,profile])=>{
  const policyBytes=Buffer.byteLength(analysisPolicyFor(profile));
  return {domain,prompt:promptMetadata(buildAnalysisPrompt(profile)),policyBytes,baselinePolicyBytes:baselineBytes,savedPolicyBytes:baselineBytes-policyBytes,savedPolicyPercent:Number(((baselineBytes-policyBytes)/baselineBytes*100).toFixed(2))};
 });
 const report={schemaVersion:'ba.prompt-measurements.v1',mode:'offline-static',baseline:'Previous skill-selection/truncation algorithm using current skill files; policy bytes only.',profiles,prototype:promptMetadata(buildPrototypePrompt()),corpus:{kind:reviewed?'reviewed-admission-checked':'synthetic-fixture',caseCount:corpus.cases.length,sha256:admission?.corpusHash??null,explicitErpCases:corpus.cases.filter(c=>c.solutionProfile?.domain==='erp').length},semanticQuality:{status:'NOT_MEASURED',reason:'Requires actual predictions, two independent BA judgments and adjudication.'},usage:{inputTokens:null,outputTokens:null,costUsd:null,status:'UNKNOWN'},externalCalls:0,caveat:'Byte reduction does not establish token savings, accuracy, latency or customer approval. Corpus admission checks attestations, not reviewer identity. No release decision is made.'};
 console.log(JSON.stringify(report,null,2));
} catch(error){console.error('Prompt evaluation error:',error.message);process.exitCode=2;}
