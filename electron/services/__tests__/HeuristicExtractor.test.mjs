// electron/services/__tests__/HeuristicExtractor.test.mjs
//
// D2 fix (PROFILE_INTELLIGENCE_RESEARCH_AND_REDESIGN.md §15 R2): o LLM-free
// fallback resume/JD parser. Its Apenas job é to populate o MINIMUM structured
// shape needed para profileFactsReady + o deterministic fast caminho quando o
// extraction LLM é unavailable (billing-blocked / timed oufora It mprecisa
//   - extrair a usable nnome skills, experience, projects, education,
//   - nunca fabricate (empty sections stay empty),
//   - produce a shape that satisfies o mesmo profileFactsReady predicate o
//     production caminho uses,
//   - ser pure (não LLM, não I/O).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const loadCompiled = (rel) =>
  import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/' + rel)).href);

const { heuristicResumeExtract, heuristicJDExtract } = await loadCompiled('HeuristicExtractor.js');
// Reuse o production readiness predicate então o testar proves real readiness.
const { profileFactsReady } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/manualProfileIntelligence.js')).href
);

const RESUME = `Evin John
Founder & Full-Stack Engineer
evin.john@example.com | +1 555 0100 | github.com/evinjohn | linkedin.com/in/evinjohn

SUMMARY
Final-year B.Tech CSE student and founder building AI copilots.

SKILLS
Languages: TypeScript, Python, Go, SQL
Frameworks: React, Next.js, FastAPI, Node.js
Cloud: AWS, GCP, Vercel
Databases: PostgreSQL, Redis, pgvector
AI/ML: PyTorch, LangChain, RAG
Tools: Git, Docker, Figma

EXPERIENCE
Founder at Refract (2024-01 - Present)
- Built a real-time meeting copilot used by thousands.
- Designed the multi-provider STT and LLM fallback chain.
Software Engineer Intern at Aetherbot AI (2023-05 - 2023-08)
- Shipped a vector-search retrieval pipeline.

PROJECTS
ABTest-Framework: A/B testing library with stats engine. React, Node.js
SQL-Copilot: Natural-language to SQL with pgvector retrieval. Python, FastAPI

EDUCATION
B.Tech in Computer Science, Cochin University (2021-08 - 2025-05)
`;

describe('heuristicResumeExtract', () => {
  const r = heuristicResumeExtract(RESUME);

  test('extracts the candidate name from the first line', () => {
    assert.equal(r.identity.name, 'Evin John');
  });

  test('extracts contact fields by regex', () => {
    assert.equal(r.identity.email, 'evin.john@example.com');
    assert.match(r.identity.github || '', /evinjohn/);
    assert.match(r.identity.linkedin || '', /evinjohn/);
  });

  test('categorizes skills into the v2 buckets', () => {
    assert.ok(r.skills.languages.includes('TypeScript'));
    assert.ok(r.skills.languages.includes('Python'));
    assert.ok(r.skills.frameworks.includes('React'));
    assert.ok(r.skills.cloud.includes('AWS'));
    assert.ok(r.skills.databases.includes('PostgreSQL'));
    assert.ok(r.skills.ml.includes('PyTorch'));
  });

  test('extracts experience entries with role and company', () => {
    assert.ok(r.experience.length >= 1);
    const founder = r.experience.find((e) => /refract/i.test(e.company) || /founder/i.test(e.role));
    assert.ok(founder, 'should find the Refract / Founder entry');
  });

  test('extracts project names', () => {
    const names = r.projects.map((p) => p.name);
    assert.ok(names.some((n) => /ABTest-Framework/i.test(n)), `projects: ${names.join(', ')}`);
    assert.ok(names.some((n) => /SQL-Copilot/i.test(n)), `projects: ${names.join(', ')}`);
  });

  test('extracts an education entry', () => {
    assert.ok(r.education.length >= 1);
    assert.match(JSON.stringify(r.education[0]), /Cochin|Computer Science|B\.?Tech/i);
  });

  test('the result satisfies the production profileFactsReady predicate', () => {
    assert.equal(profileFactsReady(r), true);
  });

  test('stamps the extraction mode as heuristic', () => {
    assert.equal(r._extraction_mode, 'heuristic');
  });

  test('never fabricates: empty resume yields empty (not-ready) shape', () => {
    const empty = heuristicResumeExtract('');
    assert.equal(profileFactsReady(empty), false);
    assert.deepEqual(empty.experience, []);
    assert.deepEqual(empty.projects, []);
  });

  test('a name-only resume is still ready (name alone is usable)', () => {
    const r2 = heuristicResumeExtract('Jane Q. Public\nSoftware Engineer\n');
    assert.equal(r2.identity.name, 'Jane Q. Public');
    assert.equal(profileFactsReady(r2), true);
  });

  test('does not mistake an ALL-CAPS section header for a name', () => {
    const r3 = heuristicResumeExtract('RESUME\nSKILLS\nPython');
    assert.notEqual(r3.identity.name, 'RESUME');
    assert.notEqual(r3.identity.name, 'SKILLS');
  });

  test('produces complete CategorizedSkills shape (all 7 keys present)', () => {
    for (const k of ['languages', 'frameworks', 'cloud', 'databases', 'ml', 'devops', 'tools']) {
      assert.ok(Array.isArray(r.skills[k]), `missing skills bucket ${k}`);
    }
  });
});

const JD = `Senior Data Analyst
Acme Analytics — Remote (US)

About the role
We are hiring a Senior Data Analyst to own our experimentation platform.

Requirements
- 5+ years SQL and Python
- Experience with A/B testing and statistics
- Strong data visualization skills

Nice to have
- dbt, Snowflake

Responsibilities
- Build dashboards and self-serve analytics
- Partner with product on experiment design
`;

describe('heuristicJDExtract', () => {
  const jd = heuristicJDExtract(JD);

  test('extracts a title', () => {
    assert.match(jd.title, /Data Analyst/i);
  });

  test('extracts requirements as a non-empty list', () => {
    assert.ok(jd.requirements.length >= 1, `requirements: ${JSON.stringify(jd.requirements)}`);
  });

  test('valid enum defaults so downstream never crashes', () => {
    assert.ok(['intern', 'entry', 'mid', 'senior', 'staff', 'principal'].includes(jd.level));
    assert.ok(['full_time', 'part_time', 'contract', 'internship'].includes(jd.employment_type));
  });

  test('empty JD still returns a valid shape (no throw, fallback title)', () => {
    const j2 = heuristicJDExtract('');
    assert.equal(typeof j2.title, 'string');
    assert.ok(Array.isArray(j2.requirements));
  });
});
