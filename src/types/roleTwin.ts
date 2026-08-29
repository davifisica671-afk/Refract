export type RoleRequirementStatus = 'matched' | 'partial' | 'gap';

export interface RoleRequirement {
  id: string;
  label: string;
  category: string;
  priority: 'must' | 'important' | 'supporting';
  status: RoleRequirementStatus;
  evidence: string[];
  preparationNote: string;
}

export interface RoleTwinAnalysis {
  roleSummary: string;
  level: string;
  location: string;
  keywords: string[];
  requirements: RoleRequirement[];
  strengths: string[];
  gaps: string[];
  interviewThemes: string[];
  preparationPlan: string[];
  coverageScore: number;
}

export interface RoleTwin {
  id: string;
  company: string;
  roleTitle: string;
  jobDescription: string;
  analysis: RoleTwinAnalysis;
  companyDossier: {
    company?: string;
    summary?: string;
    products?: string[];
    culture?: string[];
    recent_news?: string[];
    interview_angles?: string[];
    talking_points?: string[];
    sources?: string[];
    generated_at?: string;
  } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
