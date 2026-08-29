import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildManualProfileBackendAnswer } = require('../../../dist-electron/electron/llm/profileAnswerBackend.js');

const PROFILES = [
  {
    id: 'backend-engineer',
    name: 'Aarav Menon',
    forbidden: ['Maya Iyer', 'Rahul Nair', 'Sara Thomas', 'Daniel Joseph', 'Sales Dashboard', 'Kubernetes Rollout', 'Roadmap Portal', 'Pipeline Sequencer'],
    resume: {
      identity: { name: 'Aarav Menon' },
      skills: ['Node.js', 'PostgreSQL', 'Redis'],
      experience: [{ role: 'Backend Engineer', company: 'LedgerWorks', bullets: ['Scaled payment APIs'] }],
      projects: [{ name: 'Inventory API', description: 'Real-time stock service', technologies: ['Node.js', 'PostgreSQL'] }],
    },
    jd: { title: 'Senior Backend Engineer', company: 'Nimbus Retail', requirements: ['Node.js services', 'PostgreSQL schema design'], technologies: ['Node.js', 'PostgreSQL', 'Redis'] },
    expected: ['Aarav Menon', 'Backend Engineer', 'LedgerWorks', 'Inventory API', 'Node.js', 'PostgreSQL', 'Senior Backend Engineer', 'Nimbus Retail'],
  },
  {
    id: 'data-analyst',
    name: 'Maya Iyer',
    forbidden: ['Aarav Menon', 'Rahul Nair', 'Sara Thomas', 'Daniel Joseph', 'Inventory API', 'Kubernetes Rollout', 'Roadmap Portal', 'Pipeline Sequencer'],
    resume: {
      identity: { name: 'Maya Iyer' },
      skills: ['SQL', 'Tableau', 'Python'],
      experience: [{ role: 'Data Analyst', company: 'BrightMetrics', bullets: ['Built revenue dashboards'] }],
      projects: [{ name: 'Sales Dashboard', description: 'Executive sales analytics', technologies: ['Tableau', 'SQL'] }],
    },
    jd: { title: 'Analytics Consultant', company: 'Northstar Insights', requirements: ['dashboard storytelling', 'SQL analysis'], technologies: ['SQL', 'Tableau'] },
    expected: ['Maya Iyer', 'Data Analyst', 'BrightMetrics', 'Sales Dashboard', 'SQL', 'Tableau', 'Analytics Consultant', 'Northstar Insights'],
  },
  {
    id: 'devops-engineer',
    name: 'Rahul Nair',
    forbidden: ['Aarav Menon', 'Maya Iyer', 'Sara Thomas', 'Daniel Joseph', 'Inventory API', 'Sales Dashboard', 'Roadmap Portal', 'Pipeline Sequencer'],
    resume: {
      identity: { name: 'Rahul Nair' },
      skills: ['Kubernetes', 'Terraform', 'AWS'],
      experience: [{ role: 'DevOps Engineer', company: 'CloudForge', bullets: ['Automated deployment platforms'] }],
      projects: [{ name: 'Kubernetes Rollout', description: 'Cluster migration program', technologies: ['Kubernetes', 'Terraform'] }],
    },
    jd: { title: 'Platform Reliability Engineer', company: 'Orbit Systems', requirements: ['cloud infrastructure', 'Kubernetes operations'], technologies: ['Kubernetes', 'AWS', 'Terraform'] },
    expected: ['Rahul Nair', 'DevOps Engineer', 'CloudForge', 'Kubernetes Rollout', 'Kubernetes', 'Terraform', 'Platform Reliability Engineer', 'Orbit Systems'],
  },
  {
    id: 'product-manager',
    name: 'Sara Thomas',
    forbidden: ['Aarav Menon', 'Maya Iyer', 'Rahul Nair', 'Daniel Joseph', 'Inventory API', 'Sales Dashboard', 'Kubernetes Rollout', 'Pipeline Sequencer'],
    resume: {
      identity: { name: 'Sara Thomas' },
      skills: ['Roadmapping', 'User Research', 'A/B Testing'],
      experience: [{ role: 'Product Manager', company: 'LaunchPad', bullets: ['Led checkout growth experiments'] }],
      projects: [{ name: 'Roadmap Portal', description: 'Customer feedback prioritization hub', technologies: ['Productboard', 'Amplitude'] }],
    },
    jd: { title: 'Growth Product Manager', company: 'Helio Apps', requirements: ['experimentation', 'customer discovery'], technologies: ['Amplitude', 'Productboard'] },
    expected: ['Sara Thomas', 'Product Manager', 'LaunchPad', 'Roadmap Portal', 'Roadmapping', 'User Research', 'Growth Product Manager', 'Helio Apps'],
  },
  {
    id: 'sales-development',
    name: 'Daniel Joseph',
    forbidden: ['Aarav Menon', 'Maya Iyer', 'Rahul Nair', 'Sara Thomas', 'Inventory API', 'Sales Dashboard', 'Kubernetes Rollout', 'Roadmap Portal'],
    resume: {
      identity: { name: 'Daniel Joseph' },
      skills: ['Prospecting', 'HubSpot', 'Cold Email'],
      experience: [{ role: 'Sales Development Rep', company: 'PipelineCo', bullets: ['Generated enterprise pipeline'] }],
      projects: [{ name: 'Pipeline Sequencer', description: 'Outbound campaign automation', technologies: ['HubSpot', 'Apollo'] }],
    },
    jd: { title: 'Enterprise SDR', company: 'QuotaSpring', requirements: ['outbound prospecting', 'CRM hygiene'], technologies: ['HubSpot', 'Apollo'] },
    expected: ['Daniel Joseph', 'Sales Development Rep', 'PipelineCo', 'Pipeline Sequencer', 'Prospecting', 'HubSpot', 'Enterprise SDR', 'QuotaSpring'],
  },
];

function makeOrchestrator(profile) {
  return {
    activeResume: { structured_data: profile.resume },
    activeJD: { structured_data: profile.jd },
  };
}

function answer(profile, question) {
  const result = buildManualProfileBackendAnswer({
    question,
    orchestrator: makeOrchestrator(profile),
    source: 'manual_input',
  });
  assert.ok(result.route, `${profile.id}: expected backend route for ${question}`);
  assert.equal(result.route.providerUsed, false);
  return result.route.answer;
}

function assertNoLeak(text, forbidden) {
  for (const value of forbidden) {
    assert.doesNotMatch(text, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `answer leaked ${value}: ${text}`);
  }
}

describe('backend profile answer path used by frontend chat IPC', () => {
  test('answers profile facts for five synthetic profiles from current structured backend state only', () => {
    for (const profile of PROFILES) {
      const name = answer(profile, 'what is my name?');
      assert.equal(name, `Your name is ${profile.name}.`);
      assertNoLeak(name, profile.forbidden);

      const experience = answer(profile, 'what are my experiences?');
      assert.match(experience, new RegExp(profile.expected[1], 'i'));
      assert.match(experience, new RegExp(profile.expected[2], 'i'));
      assertNoLeak(experience, profile.forbidden);

      const projects = answer(profile, 'what projects have I done?');
      assert.match(projects, new RegExp(profile.expected[3], 'i'));
      assertNoLeak(projects, profile.forbidden);

      const skills = answer(profile, 'what are my skills?');
      assert.match(skills, new RegExp(profile.expected[4], 'i'));
      assert.match(skills, new RegExp(profile.expected[5], 'i'));
      assertNoLeak(skills, profile.forbidden);

      const jdFit = answer(profile, 'how do I fit this JD?');
      assert.match(jdFit, new RegExp(profile.expected[6], 'i'));
      assert.match(jdFit, new RegExp(profile.expected[7], 'i'));
      assert.match(jdFit, new RegExp(profile.expected[4], 'i'));
      assertNoLeak(jdFit, profile.forbidden);
    }
  });

  test('resume replacement uses latest backend structured state without leaking old facts', () => {
    const orchestrator = makeOrchestrator(PROFILES[0]);
    let result = buildManualProfileBackendAnswer({ question: 'what is my name?', orchestrator, source: 'manual_input' });
    assert.equal(result.route?.answer, 'Your name is Aarav Menon.');

    orchestrator.activeResume = { structured_data: PROFILES[1].resume };
    orchestrator.activeJD = { structured_data: PROFILES[1].jd };

    result = buildManualProfileBackendAnswer({ question: 'what is my name?', orchestrator, source: 'manual_input' });
    assert.equal(result.route?.answer, 'Your name is Maya Iyer.');

    const projects = buildManualProfileBackendAnswer({ question: 'what projects have I done?', orchestrator, source: 'manual_input' });
    assert.match(projects.route?.answer || '', /Sales Dashboard/);
    assert.doesNotMatch(projects.route?.answer || '', /Aarav Menon|Inventory API/);
  });

  test('fresh backend object after restart loads latest persisted structured profile', () => {
    const latestPersisted = { resume: PROFILES[3].resume, jd: PROFILES[3].jd };
    const restartedOrchestrator = {
      activeResume: { structured_data: latestPersisted.resume },
      activeJD: { structured_data: latestPersisted.jd },
    };

    const result = buildManualProfileBackendAnswer({ question: 'what is my name?', orchestrator: restartedOrchestrator, source: 'manual_input' });
    assert.equal(result.route?.answer, 'Your name is Sara Thomas.');
  });

  test('multiple backend sessions do not cross-contaminate profile context', () => {
    const sessionA = makeOrchestrator(PROFILES[2]);
    const sessionB = makeOrchestrator(PROFILES[4]);

    const a = buildManualProfileBackendAnswer({ question: 'what projects have I done?', orchestrator: sessionA, source: 'manual_input' });
    const b = buildManualProfileBackendAnswer({ question: 'what projects have I done?', orchestrator: sessionB, source: 'manual_input' });

    assert.match(a.route?.answer || '', /Kubernetes Rollout/);
    assert.doesNotMatch(a.route?.answer || '', /Pipeline Sequencer|Daniel Joseph/);
    assert.match(b.route?.answer || '', /Pipeline Sequencer/);
    assert.doesNotMatch(b.route?.answer || '', /Kubernetes Rollout|Rahul Nair/);
  });
});
