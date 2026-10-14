import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {figmaUiState,approvedGalleryScreens,screenPreviewUrl,projectToRestore} from '../public/figma-review-ui.js';

test('Prototype UI contract explains relay setup, manual plugin connection and channel ID',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/Start socket cursor-talk-to-figma-mcp/);
 assert.match(app,/Channel ID/);assert.match(app,/mở plugin TalkToFigma thủ công/i);
 assert.match(app,/aria-describedby/);assert.match(app,/role="status"|aria-live/);
});

test('Figma setup and review states distinguish stopped, queued, failed and review-ready',()=>{
 assert.equal(figmaUiState({relay:{state:'STOPPED'}}),'RELAY_STOPPED');
 assert.equal(figmaUiState({relay:{state:'STARTING'}}),'RELAY_STARTING');
 assert.equal(figmaUiState({relay:{state:'READY'},design:{state:'QUEUED'}}),'QUEUED');
 assert.equal(figmaUiState({relay:{state:'READY'},design:{state:'FAILED'}}),'FAILED');
 assert.equal(figmaUiState({relay:{state:'READY'},design:{state:'WAITING_FOR_REVIEW'}}),'WAITING_FOR_REVIEW');
});

test('Approved gallery excludes draft previews and groups approved screens by FR trace',()=>{
 const draft={state:'WAITING_FOR_REVIEW',screens:[{screenId:'SCR-001',requirementIds:['FR-001']}],approved:null};
 assert.deepEqual(approvedGalleryScreens(draft),[]);
 const approved={state:'APPROVED',approved:{screens:[{screenId:'SCR-001',requirementIds:['FR-001','FR-002']}]}};
 assert.deepEqual(approvedGalleryScreens(approved),approved.approved.screens);
 assert.equal(screenPreviewUrl('project-1','SCR-001'),'/api/projects/project-1/figma-design/previews/SCR-001');
});

test('Review actions include editable per-screen previews, Figma links, and revision feedback',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/figma-design\/review/);assert.match(app,/REQUEST_CHANGES/);assert.match(app,/APPROVE/);
 assert.match(app,/manifestDigest:design\.manifestDigest/);assert.match(app,/projectVersion:design\.draft\.projectVersion/);
 assert.match(app,/node-id=/);assert.match(app,/screenPreviewUrl\(p\.id,screen\.screenId\)/);
});

test('Reload restores the last project, or the most recently updated project as fallback',async()=>{
 const projects=[{id:'old',updatedAt:'2026-01-01T00:00:00Z'},{id:'new',updatedAt:'2026-02-01T00:00:00Z'}];
 assert.equal(projectToRestore(projects,'old'),projects[0]);
 assert.equal(projectToRestore(projects,'missing'),projects[1]);
 assert.equal(projectToRestore([],'missing'),null);
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/loadProjects\(\{restore:true\}\)/);
 assert.match(app,/ba-studio:lastProjectId/);
});
