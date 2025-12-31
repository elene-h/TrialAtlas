
export interface Trial {
  id: string;
  nctId: string;
  title: string;
  status: string;
  phase: string[];
  condition: string[];
  intervention: string[];
  sponsor: string;
  startDate?: string;
  primaryCompletionDate?: string;
  description?: string;
  briefSummary?: string;
  molecularTargets?: string[];
  lastUpdateDate?: string;
  locations?: number;
  studyType?: string;
  relevanceScore?: number; // 0-100
  relevanceReason?: string; // AI explanation for the match
  primaryOutcomes?: string[];
  secondaryOutcomes?: string[];
  enrollmentCount?: number;
}

export interface DeepTrialMetrics {
  identification: {
    trialId: string;
    officialTitle: string;
    sponsorCollaborators: string;
    regulatoryStatus: string;
    recruitmentStatus: string;
  };
  design: {
    phase: string;
    studyType: string;
    allocation: string;
    masking: string;
    controlType: string;
    designLogic: string;
  };
  population: {
    targetPopulation: string;
    inclusionCriteria: string;
    exclusionCriteria: string;
    demographics: string;
    sampleSize: string;
    geographicScope: string;
  };
  intervention: {
    type: string;
    dosageAdministration: string;
    frequencyDuration: string;
    comparatorDetails: string;
    treatmentArms: string;
  };
  outcomes: {
    primaryOutcomes: string;
    secondaryOutcomes: string;
    exploratoryOutcomes: string;
  };
  statistical: {
    sap: string;
    primaryEstimand: string;
    effectMeasures: string;
    powerJustification: string;
    alphaLevel: string;
    missingDataHandling: string;
  };
  safety: {
    adverseEventsFocus: string;
    stoppingCriteria: string;
    dsmbOversight: string;
    riskMitigation: string;
  };
  ethics: {
    ethicsApproval: string;
    informedConsent: string;
    privacyProtection: string;
    gcpCompliance: string;
  };
  operational: {
    timelineOperational: string;
    enrollmentRate: string;
    dropoutRateEstimate: string;
    sitePerformance: string;
  };
  results: {
    postedResultsStatus: string;
    endpointsMet: string;
    effectSizes: string;
    publicationStatus: string;
  };
}

export interface SearchProfile {
  conditions: string[];
  interventions: string[];
  targets: string[];
  synonyms: string[];
  suggestedQuery: string;
}

export interface TrialFilters {
  statuses: string[];
  phases: string[];
}

export interface PublicationFilters {
  dateFrom: string;
  dateTo: string;
  journal: string;
  author: string;
}

export interface Publication {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  pubDate: string;
  doi?: string;
  abstract?: string;
  relevanceScore?: number;
  relevanceReason?: string;
}

export interface PublicationAnalysis {
  why: string;
  how: string;
  what: string;
  meaning: string;
  statisticalRelevance: string;
  clinicalRelevance: string;
  kpis: {
    trialType: string;
    blinding: string;
    population: string;
    safetyConcerns: string;
    possibleBiases: string;
    goldStandards: string;
    quality: string;
    robustness: string;
  };
}

export interface TrialGroup {
  groupName: string;
  moaDescription: string;
  trialIds: string[];
}

export interface PipelinePhase {
  phaseName: string;
  groups: TrialGroup[];
}

export interface PipelineData {
  phases: PipelinePhase[];
}

export interface ComparisonMatrix {
  headers: string[];
  rows: {
    label: string;
    values: string[];
  }[];
  strategicSummary?: string;
}

export type SortOrder = 'relevance' | 'newest';

export interface SearchState {
  trials: Trial[];
  publications: Publication[];
  loading: boolean;
  error: string | null;
  query: string;
  filters: TrialFilters;
  pubFilters: PublicationFilters;
  sortOrder: SortOrder;
  profile?: SearchProfile;
}

export enum AppTab {
  DASHBOARD = 'DASHBOARD',
  TRIALS = 'TRIALS',
  LITERATURE = 'LITERATURE',
  PIPELINE = 'PIPELINE',
  TRIAL_COMPARISON = 'TRIAL_COMPARISON',
  TRIAL_METRICS = 'TRIAL_METRICS',
  SYSTEM_ARCH = 'SYSTEM_ARCH'
}
