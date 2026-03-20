#!/usr/bin/env node
/**
 * Shared bootstrap metadata for the dashboard organization model.
 *
 * This is the non-heuristic fallback used when org tables are unavailable or
 * have not been seeded yet. The dashboard can still render department-aware
 * agent views without depending on runtime inference from workspace paths.
 */

const DEPARTMENTS = [
  {
    slug: 'core-platform',
    name: 'Core Platform',
    description: 'Primary orchestration, repair, and core coding agents.',
    color: '#6366f1',
    icon: 'cpu',
    sortOrder: 10
  },
  {
    slug: 'content-publishing',
    name: 'Content & Publishing',
    description: 'Editorial, affiliate, publishing, QA, and related content operations.',
    color: '#22c55e',
    icon: 'file-text',
    sortOrder: 20
  },
  {
    slug: 'bug-fix-pipeline',
    name: 'Bug Fix Pipeline',
    description: 'Triaging, investigation, fixing, verification, and PR creation for bug work.',
    color: '#ef4444',
    icon: 'bug',
    sortOrder: 30
  },
  {
    slug: 'security-pipeline',
    name: 'Security Pipeline',
    description: 'Security scanning, prioritization, remediation, verification, and testing.',
    color: '#f59e0b',
    icon: 'shield',
    sortOrder: 40
  },
  {
    slug: 'feature-development',
    name: 'Feature Development',
    description: 'Feature planning, setup, implementation, testing, and review.',
    color: '#8b5cf6',
    icon: 'code',
    sortOrder: 50
  },
  {
    slug: 'web-properties',
    name: 'Web Properties',
    description: 'Property-specific agents responsible for site delivery and maintenance.',
    color: '#06b6d4',
    icon: 'globe',
    sortOrder: 60
  },
  {
    slug: 'media-vision',
    name: 'Media & Vision',
    description: 'Vision, image generation, prompt writing, and source selection.',
    color: '#ec4899',
    icon: 'image',
    sortOrder: 70
  },
  {
    slug: 'research-analysis',
    name: 'Research & Analysis',
    description: 'Research-heavy analytical work and integrity checks.',
    color: '#14b8a6',
    icon: 'search',
    sortOrder: 80
  },
  {
    slug: 'automation',
    name: 'Automation',
    description: 'Workflow automation and operational execution.',
    color: '#f97316',
    icon: 'zap',
    sortOrder: 90
  }
];

const AGENT_PROFILES = [
  {
    agentId: 'main',
    departmentSlug: 'core-platform',
    displayName: 'Main Agent',
    role: 'orchestrator',
    capabilities: ['orchestration', 'coding', 'analysis', 'memory']
  },
  {
    agentId: 'coder',
    departmentSlug: 'core-platform',
    displayName: 'Coder',
    role: 'specialist',
    capabilities: ['coding', 'debugging', 'refactoring']
  },
  {
    agentId: 'antfarm-medic',
    departmentSlug: 'core-platform',
    displayName: 'Antfarm Medic',
    role: 'specialist',
    capabilities: ['diagnostics', 'repair']
  },
  {
    agentId: 'affiliate-editorial',
    departmentSlug: 'content-publishing',
    displayName: 'Affiliate Editorial',
    role: 'specialist',
    capabilities: ['content', 'seo', 'affiliate']
  },
  {
    agentId: 'blog-reviewer',
    departmentSlug: 'content-publishing',
    displayName: 'Blog Reviewer',
    role: 'specialist',
    capabilities: ['content-review', 'qa', 'editing']
  },
  {
    agentId: 'blogger-affiliate-manager',
    departmentSlug: 'content-publishing',
    displayName: 'Blogger Affiliate Manager',
    role: 'specialist',
    capabilities: ['affiliate', 'management']
  },
  {
    agentId: 'blogger-inventory',
    departmentSlug: 'content-publishing',
    displayName: 'Blogger Inventory',
    role: 'specialist',
    capabilities: ['inventory', 'tracking']
  },
  {
    agentId: 'topic-planner',
    departmentSlug: 'content-publishing',
    displayName: 'Topic Planner',
    role: 'specialist',
    capabilities: ['planning', 'topics']
  },
  {
    agentId: 'product-finder',
    departmentSlug: 'content-publishing',
    displayName: 'Product Finder',
    role: 'specialist',
    capabilities: ['products', 'research']
  },
  {
    agentId: 'seo-rewriter',
    departmentSlug: 'content-publishing',
    displayName: 'SEO Rewriter',
    role: 'specialist',
    capabilities: ['seo', 'writing']
  },
  {
    agentId: 'blogger-publisher',
    departmentSlug: 'content-publishing',
    displayName: 'Blogger Publisher',
    role: 'specialist',
    capabilities: ['publishing', 'wordpress']
  },
  {
    agentId: 'qa-auditor',
    departmentSlug: 'content-publishing',
    displayName: 'QA Auditor',
    role: 'specialist',
    capabilities: ['quality', 'auditing']
  },
  {
    agentId: 'video-discoverer',
    departmentSlug: 'content-publishing',
    displayName: 'Video Discoverer',
    role: 'specialist',
    capabilities: ['video', 'discovery']
  },
  {
    agentId: 'benchmark-labs-writer',
    departmentSlug: 'content-publishing',
    displayName: 'Benchmark Labs Writer',
    role: 'specialist',
    capabilities: ['writing', 'benchmarks']
  },
  {
    agentId: 'bug-fix_triager',
    departmentSlug: 'bug-fix-pipeline',
    displayName: 'Triager',
    role: 'pipeline',
    capabilities: ['triage', 'classification']
  },
  {
    agentId: 'bug-fix_investigator',
    departmentSlug: 'bug-fix-pipeline',
    displayName: 'Investigator',
    role: 'pipeline',
    capabilities: ['investigation', 'debugging']
  },
  {
    agentId: 'bug-fix_setup',
    departmentSlug: 'bug-fix-pipeline',
    displayName: 'Setup',
    role: 'pipeline',
    capabilities: ['setup', 'environment']
  },
  {
    agentId: 'bug-fix_fixer',
    departmentSlug: 'bug-fix-pipeline',
    displayName: 'Fixer',
    role: 'pipeline',
    capabilities: ['coding', 'fixing']
  },
  {
    agentId: 'bug-fix_verifier',
    departmentSlug: 'bug-fix-pipeline',
    displayName: 'Verifier',
    role: 'pipeline',
    capabilities: ['verification', 'testing']
  },
  {
    agentId: 'bug-fix_pr',
    departmentSlug: 'bug-fix-pipeline',
    displayName: 'PR Creator',
    role: 'pipeline',
    capabilities: ['git', 'pull-requests']
  },
  {
    agentId: 'security-audit_scanner',
    departmentSlug: 'security-pipeline',
    displayName: 'Scanner',
    role: 'pipeline',
    capabilities: ['scanning', 'security']
  },
  {
    agentId: 'security-audit_prioritizer',
    departmentSlug: 'security-pipeline',
    displayName: 'Prioritizer',
    role: 'pipeline',
    capabilities: ['prioritization', 'risk-assessment']
  },
  {
    agentId: 'security-audit_setup',
    departmentSlug: 'security-pipeline',
    displayName: 'Setup',
    role: 'pipeline',
    capabilities: ['setup', 'environment']
  },
  {
    agentId: 'security-audit_fixer',
    departmentSlug: 'security-pipeline',
    displayName: 'Fixer',
    role: 'pipeline',
    capabilities: ['fixing', 'patching']
  },
  {
    agentId: 'security-audit_verifier',
    departmentSlug: 'security-pipeline',
    displayName: 'Verifier',
    role: 'pipeline',
    capabilities: ['verification', 'testing']
  },
  {
    agentId: 'security-audit_tester',
    departmentSlug: 'security-pipeline',
    displayName: 'Tester',
    role: 'pipeline',
    capabilities: ['testing', 'penetration']
  },
  {
    agentId: 'security-audit_pr',
    departmentSlug: 'security-pipeline',
    displayName: 'PR Creator',
    role: 'pipeline',
    capabilities: ['git', 'pull-requests']
  },
  {
    agentId: 'feature-dev_planner',
    departmentSlug: 'feature-development',
    displayName: 'Planner',
    role: 'pipeline',
    capabilities: ['planning', 'architecture']
  },
  {
    agentId: 'feature-dev_setup',
    departmentSlug: 'feature-development',
    displayName: 'Setup',
    role: 'pipeline',
    capabilities: ['setup', 'environment']
  },
  {
    agentId: 'feature-dev_developer',
    departmentSlug: 'feature-development',
    displayName: 'Developer',
    role: 'pipeline',
    capabilities: ['coding', 'implementation']
  },
  {
    agentId: 'feature-dev_verifier',
    departmentSlug: 'feature-development',
    displayName: 'Verifier',
    role: 'pipeline',
    capabilities: ['verification', 'review']
  },
  {
    agentId: 'feature-dev_tester',
    departmentSlug: 'feature-development',
    displayName: 'Tester',
    role: 'pipeline',
    capabilities: ['testing', 'qa']
  },
  {
    agentId: 'feature-dev_reviewer',
    departmentSlug: 'feature-development',
    displayName: 'Reviewer',
    role: 'pipeline',
    capabilities: ['review', 'code-review']
  },
  {
    agentId: '3dput',
    departmentSlug: 'web-properties',
    displayName: '3dput',
    role: 'specialist',
    capabilities: ['3d-printing', 'website']
  },
  {
    agentId: 'sailboats-fr',
    departmentSlug: 'web-properties',
    displayName: 'Sailboats Developer',
    role: 'specialist',
    capabilities: ['web-development', 'maritime']
  },
  {
    agentId: 'sailboats-fr-jobs',
    departmentSlug: 'web-properties',
    displayName: 'Sailboats Jobs',
    role: 'specialist',
    capabilities: ['jobs', 'scraping']
  },
  {
    agentId: 'sailing-yachts',
    departmentSlug: 'web-properties',
    displayName: 'Sailing Yachts Developer',
    role: 'specialist',
    capabilities: ['web-development', 'maritime']
  },
  {
    agentId: 'petergedeon',
    departmentSlug: 'web-properties',
    displayName: 'petergedeon.com Developer',
    role: 'specialist',
    capabilities: ['web-development', 'site-maintenance']
  },
  {
    agentId: 'vision-agent',
    departmentSlug: 'media-vision',
    displayName: 'Vision Processor',
    role: 'specialist',
    capabilities: ['vision', 'image-analysis']
  },
  {
    agentId: 'comfyui-image-agent',
    departmentSlug: 'media-vision',
    displayName: 'ComfyUI Image Agent',
    role: 'specialist',
    capabilities: ['image-generation', 'comfyui']
  },
  {
    agentId: 'image-prompt-writer',
    departmentSlug: 'media-vision',
    displayName: 'Image Prompt Writer',
    role: 'specialist',
    capabilities: ['prompts', 'writing']
  },
  {
    agentId: 'image-source-selector',
    departmentSlug: 'media-vision',
    displayName: 'Image Source Selector',
    role: 'specialist',
    capabilities: ['images', 'selection']
  },
  {
    agentId: 'image-ops_source-selector',
    departmentSlug: 'media-vision',
    displayName: 'Image Ops Source Selector',
    role: 'pipeline',
    capabilities: ['images', 'selection', 'pipeline']
  },
  {
    agentId: 'image-ops_prompt-writer',
    departmentSlug: 'media-vision',
    displayName: 'Image Ops Prompt Writer',
    role: 'pipeline',
    capabilities: ['prompts', 'writing', 'pipeline']
  },
  {
    agentId: 'image-ops_gen',
    departmentSlug: 'media-vision',
    displayName: 'Image Generator (ComfyUI)',
    role: 'pipeline',
    capabilities: ['image-generation', 'comfyui', 'pipeline']
  },
  {
    agentId: 'image-ops_qa',
    departmentSlug: 'media-vision',
    displayName: 'Image QA',
    role: 'pipeline',
    capabilities: ['qa', 'image-review', 'pipeline']
  },
  {
    agentId: 'us-spending-integrity',
    departmentSlug: 'research-analysis',
    displayName: 'US Spending Integrity',
    role: 'specialist',
    capabilities: ['research', 'data-integrity']
  },
  {
    agentId: 'dashboard-manager',
    departmentSlug: 'core-platform',
    displayName: 'Dashboard Manager',
    role: 'specialist',
    capabilities: ['dashboard', 'frontend', 'operations']
  },
  {
    agentId: 'default-agent',
    departmentSlug: 'automation',
    displayName: 'Serial Automator',
    role: 'specialist',
    capabilities: ['automation', 'workflows']
  }
];

function getDepartmentBySlug(slug) {
  return DEPARTMENTS.find((department) => department.slug === slug) || null;
}

function getAgentProfileById(agentId) {
  return AGENT_PROFILES.find((profile) => profile.agentId === agentId) || null;
}

module.exports = {
  DEPARTMENTS,
  AGENT_PROFILES,
  getDepartmentBySlug,
  getAgentProfileById
};
