import path from 'node:path';
import {homedir} from 'node:os';

/** Resolve the installed skill independently of the isolated design pack cwd. */
export const uiUxSkillPath=(env=process.env)=>path.join(env.CODEX_HOME||path.join(homedir(),'.codex'),'skills','ui-ux-pro-max','SKILL.md');
