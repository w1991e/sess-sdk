// The Skills extension (SEP-2640, io.modelcontextprotocol/skills) serving the one skill in
// skill-text.ts, built with the official server library's own catalog (Sess ledger L-351). The
// bytes are embedded in the package, never read from disk at run time, so the stdio server and the
// hosted HTTP composition serve exactly the same file. One catalog serves every server instance:
// buildToolServer attaches it to each McpServer it builds, before connecting.
import { SkillCatalog, memorySkillFiles } from '@modelcontextprotocol/server/ext/skills';
import { SKILL_MD, SKILL_NAME } from './skill-text.js';

export { SKILL_DESCRIPTION, SKILL_MD, SKILL_NAME } from './skill-text.js';

/** The address of the served SKILL.md (the library's default `skill://` root, no prefix). */
export const SKILL_URI: string = `skill://${SKILL_NAME}/SKILL.md`;

/**
 * The catalog. `strict`: a problem with the file (front matter, name, limits) fails the import
 * rather than serving a partial catalog. The file is the same for every user, so its cache scope
 * is public.
 */
export const SKILLS: SkillCatalog = await SkillCatalog.load(
  memorySkillFiles({ [`${SKILL_NAME}/SKILL.md`]: SKILL_MD }),
  {
    strict: true,
    cacheHint: { cacheScope: 'public', ttlMs: 0 },
    // The file is embedded and checked at load; nothing is written to stdout or stderr from here.
    onWarning: () => {},
  },
);
