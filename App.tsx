
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Trial, SearchState, AppTab, Publication, PublicationAnalysis, TrialFilters, PublicationFilters, SortOrder, PipelineData, ComparisonMatrix, DeepTrialMetrics } from './types';
import { searchTrials } from './services/ctgov';
import { searchPublications, fetchAbstract } from './services/pubmed';
import { askAgent, analyzePublication, askContextSpecific, optimizeSearchQuery, rankAndScoreResults, categorizePipeline, generateComparisonMatrix, generateDeepTrialMetrics } from './services/geminiService';
import TrialCard from './components/TrialCard';
import Dashboard from './components/Dashboard';
import ArchitectureDiagram from './components/ArchitectureDiagram';

const STATUS_OPTIONS = [
  { label: 'Recruiting', value: 'RECRUITING' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Active', value: 'ACTIVE_NOT_RECRUITING' },
  { label: 'Withdrawn', value: 'WITHDRAWN' }
];

const PHASE_OPTIONS = [
  { label: 'Phase 1', value: 'PHASE1' },
  { label: 'Phase 2', value: 'PHASE2' },
  { label: 'Phase 3', value: 'PHASE3' }
];

type UserRole = 'RESEARCHER' | 'REGULATORY' | 'STRATEGY' | 'OPERATIONS';

type ChatContext = 
  | { type: 'global' } 
  | { type: 'trial'; data: Trial } 
  | { type: 'publication'; data: Publication; analysis: PublicationAnalysis | null };

const App: React.FC = () => {
  const [state, setState] = useState<SearchState>({
    trials: [],
    publications: [],
    loading: false,
    error: null,
    query: 'KRAS G12C Inhibitors in Lung Cancer',
    filters: { statuses: [], phases: [] },
    pubFilters: { dateFrom: '', dateTo: '', journal: '', author: '' },
    sortOrder: 'relevance'
  });
  
  const [tab, setTab] = useState<AppTab>(AppTab.DASHBOARD);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTrial, setSelectedTrial] = useState<Trial | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<{paper: Publication, analysis: PublicationAnalysis | null} | null>(null);
  const [paperAnalyzing, setPaperAnalyzing] = useState(false);
  
  // Advanced State
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);
  const [comparisonMatrix, setComparisonMatrix] = useState<ComparisonMatrix | null>(null);
  const [selectedForComparison, setSelectedForComparison] = useState<string[]>([]);
  const [loadingPipeline, setLoadingPipeline] = useState(false);
  const [loadingComparison, setLoadingComparison] = useState(false);

  // Deep Metrics States
  const [deepMetrics, setDeepMetrics] = useState<DeepTrialMetrics | null>(null);
  const [loadingDeepMetrics, setLoadingDeepMetrics] = useState(false);
  const [activeUserRole, setActiveUserRole] = useState<UserRole>('RESEARCHER');
  const [auditTrialId, setAuditTrialId] = useState<string | null>(null);

  // Architecture Image State
  const [archImageUrl, setArchImageUrl] = useState<string | null>(null);
  const [generatingArch, setGeneratingArch] = useState(false);

  // Chat States
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'agent'; text: string }[]>([]);
  const [userInput, setUserInput] = useState('');
  const [chatContext, setChatContext] = useState<ChatContext>({ type: 'global' });
  const [isTyping, setIsTyping] = useState(false);
  
  // Local Filtering States
  const [localTrialQuery, setLocalTrialQuery] = useState('');
  const [localPubJournalQuery, setLocalPubJournalQuery] = useState('');
  const [trialSortBy, setTrialSortBy] = useState<'date' | 'phase' | 'title'>('date');
  
  // Local Refinement States (Facets)
  const [selectedPhases, setSelectedPhases] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [enrollmentMin, setEnrollmentMin] = useState<number>(0);
  const [industryOnly, setIndustryOnly] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const performSearch = useCallback(async (searchQuery: string, currentFilters: TrialFilters, currentPubFilters: PublicationFilters, sort: SortOrder) => {
    setState(prev => ({ ...prev, loading: true, error: null, query: searchQuery, sortOrder: sort }));
    setSelectedTrial(null);
    setSelectedPaper(null);
    setPipelineData(null);
    setComparisonMatrix(null);
    setDeepMetrics(null);
    setSelectedForComparison([]);
    setChatContext({ type: 'global' });
    setChatHistory([]);
    
    try {
      const profile = await optimizeSearchQuery(searchQuery);
      const [trialResults, pubResults] = await Promise.all([
        searchTrials(profile.suggestedQuery || searchQuery, currentFilters, sort),
        searchPublications(searchQuery, currentPubFilters, sort)
      ]);
      
      setState(prev => ({ 
        ...prev, 
        trials: trialResults, 
        publications: pubResults,
        profile,
        loading: false 
      }));

      (async () => {
        try {
          const itemsToScore = [...trialResults.slice(0, 15), ...pubResults.slice(0, 15)];
          const scoresMap = await rankAndScoreResults(searchQuery, itemsToScore);
          
          setState(prev => ({
            ...prev,
            trials: prev.trials.map(t => scoresMap[t.nctId] ? {
              ...t,
              relevanceScore: scoresMap[t.nctId].score,
              relevanceReason: scoresMap[t.nctId].reason
            } : t),
            publications: prev.publications.map(p => scoresMap[p.pmid] ? {
              ...p,
              relevanceScore: scoresMap[p.pmid].score,
              relevanceReason: scoresMap[p.pmid].reason
            } : p)
          }));
        } catch (e) {
          console.error("Background enrichment failed", e);
        }
      })();

    } catch (err) {
      console.error(err);
      setState(prev => ({ ...prev, error: "Semantic service degraded. Showing basic registry results.", loading: false }));
    }
  }, []);

  useEffect(() => {
    performSearch(state.query, state.filters, state.pubFilters, state.sortOrder);
  }, []);

  const handleGenerateArch = async () => {
    setGeneratingArch(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `A clean, professional 3D isometric technical architecture diagram for a clinical intelligence web application called 'TrialAtlas'. The diagram shows data flowing from 'Registry APIs' (ClinicalTrials.gov, PubMed) through a central 'AI Synthesis Core' powered by Google Gemini, and outputting to a 'Researcher Dashboard' with charts and protocol audits. Use a professional blue, indigo, and slate color palette. High-tech, futuristic aesthetic, vector art style, white background. Labels should include 'Data Ingest', 'Gemini AI Logic', and 'Analytics UI'.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          imageConfig: { aspectRatio: "16:9" }
        }
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          setArchImageUrl(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
    } catch (e) {
      console.error(e);
      setState(p => ({ ...p, error: "Failed to generate architecture diagram." }));
    } finally {
      setGeneratingArch(false);
    }
  };

  const handleGeneratePipeline = async () => {
    setLoadingPipeline(true);
    try {
      const data = await categorizePipeline(state.trials);
      setPipelineData(data);
    } catch (e) {
      console.error(e);
      setState(p => ({ ...p, error: "Pipeline synthesis failed." }));
    } finally {
      setLoadingPipeline(false);
    }
  };

  const handleGenerateComparison = async () => {
    if (selectedForComparison.length < 2) return;
    setLoadingComparison(true);
    try {
      const selectedTrials = state.trials.filter(t => selectedForComparison.includes(t.nctId));
      const matrix = await generateComparisonMatrix(selectedTrials);
      setComparisonMatrix(matrix);
    } catch (e) {
      console.error(e);
      setState(p => ({ ...p, error: "Comparison synthesis failed." }));
    } finally {
      setLoadingComparison(false);
    }
  };

  const toggleComparisonSelection = (nctId: string) => {
    setSelectedForComparison(prev => 
      prev.includes(nctId) ? prev.filter(id => id !== nctId) : [...prev, nctId]
    );
  };

  const handleGenerateDeepMetrics = async (trial: Trial) => {
    setAuditTrialId(trial.nctId);
    setLoadingDeepMetrics(true);
    setDeepMetrics(null);
    setTab(AppTab.TRIAL_METRICS);
    setSelectedTrial(null);

    try {
      const data = await generateDeepTrialMetrics(trial);
      setDeepMetrics(data);
    } catch (e) {
      console.error("Audit failed:", e);
      setState(prev => ({ ...prev, error: "Clinical Audit failed to synthesize." }));
    } finally {
      setLoadingDeepMetrics(false);
    }
  };

  const roleHighlights = useMemo(() => {
    const roles: Record<UserRole, (keyof DeepTrialMetrics)[]> = {
      RESEARCHER: ['design', 'outcomes', 'statistical', 'population'],
      REGULATORY: ['identification', 'ethics', 'safety', 'results'],
      STRATEGY: ['results', 'operational', 'intervention', 'identification'],
      OPERATIONS: ['operational', 'population', 'ethics', 'safety']
    };
    return roles[activeUserRole];
  }, [activeUserRole]);

  const filteredTrials = useMemo(() => {
    let results = [...state.trials].filter(t => {
      const matchesSearch = t.title.toLowerCase().includes(localTrialQuery.toLowerCase()) ||
                            t.nctId.toLowerCase().includes(localTrialQuery.toLowerCase()) ||
                            t.sponsor.toLowerCase().includes(localTrialQuery.toLowerCase());
      
      const matchesPhase = selectedPhases.length === 0 || t.phase.some(p => selectedPhases.includes(p));
      const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(t.status);
      const matchesEnrollment = (t.enrollmentCount || 0) >= enrollmentMin;
      const matchesSponsor = !industryOnly || (!t.sponsor.toLowerCase().includes('university') && !t.sponsor.toLowerCase().includes('hospital'));

      return matchesSearch && matchesPhase && matchesStatus && matchesEnrollment && matchesSponsor;
    });

    return results.sort((a, b) => {
      if (state.sortOrder === 'relevance') return (b.relevanceScore || 0) - (a.relevanceScore || 0);
      if (trialSortBy === 'date') return (new Date(b.startDate || 0).getTime()) - (new Date(a.startDate || 0).getTime());
      if (trialSortBy === 'phase') return (b.phase[0] || '').localeCompare(a.phase[0] || '');
      return a.title.localeCompare(b.title);
    });
  }, [state.trials, localTrialQuery, trialSortBy, state.sortOrder, selectedPhases, selectedStatuses, enrollmentMin, industryOnly]);

  const handleSendMessage = async () => {
    if (!userInput.trim() || isTyping) return;
    const msg = userInput;
    setUserInput('');
    setIsTyping(true);
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    
    try {
      let response = '';
      if (chatContext.type === 'global') {
        response = await askAgent(msg, state.trials);
      } else {
        response = await askContextSpecific(msg, chatContext as any);
      }
      setChatHistory(prev => [...prev, { role: 'agent', text: response }]);
    } catch (e) {
      setChatHistory(prev => [...prev, { role: 'agent', text: "Error processing request." }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    performSearch(state.query, state.filters, state.pubFilters, state.sortOrder);
  };

  const filteredPublications = useMemo(() => {
    return state.publications.filter(pub => 
      pub.journal.toLowerCase().includes(localPubJournalQuery.toLowerCase()) ||
      pub.title.toLowerCase().includes(localPubJournalQuery.toLowerCase())
    );
  }, [state.publications, localPubJournalQuery]);

  const handlePaperClick = async (paper: Publication) => {
    setPaperAnalyzing(true);
    setSelectedPaper({ paper, analysis: null });
    try {
      const abstract = await fetchAbstract(paper.pmid);
      const analysis = await analyzePublication(paper, abstract);
      setSelectedPaper({ paper, analysis });
    } catch (e) {
      console.error(e);
    } finally {
      setPaperAnalyzing(false);
    }
  };

  const toggleLocalPhase = (p: string) => {
    setSelectedPhases(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const toggleLocalStatus = (s: string) => {
    setSelectedStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-indigo-100 selection:text-indigo-700">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-indigo-200 shadow-xl cursor-pointer" onClick={() => setTab(AppTab.DASHBOARD)}>
            <i className="fa-solid fa-microscope text-white text-lg"></i>
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">TrialAtlas</h1>
            <p className="text-[10px] text-indigo-500 font-black uppercase tracking-[2px]">Precision Discovery Engine</p>
          </div>
        </div>

        <div className="relative w-full md:w-2/3 lg:w-1/2 flex gap-3">
          <form onSubmit={handleSearchSubmit} className="relative flex-grow">
            <input
              type="text"
              value={state.query}
              onChange={(e) => setState(prev => ({ ...prev, query: e.target.value }))}
              placeholder="E.g. mRNA Vaccine Phase 3 Breast Cancer..."
              className="w-full pl-12 pr-4 py-3 bg-slate-100 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
            <i className="fa-solid fa-magnifying-glass absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
          </form>
          <button onClick={() => setTab(AppTab.TRIALS)} className="bg-slate-900 text-white px-6 py-3 rounded-2xl text-xs font-black uppercase hover:bg-black transition-colors">Analyze</button>
        </div>
      </header>

      <main className="flex-grow p-6 md:p-10 max-w-[1600px] mx-auto w-full">
        {state.loading ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-6">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center"><i className="fa-solid fa-dna text-indigo-400 animate-pulse"></i></div>
            </div>
            <div className="text-center">
               <p className="text-slate-900 font-black uppercase tracking-widest text-sm mb-1">Optimizing Semantic Graph</p>
               <p className="text-slate-400 font-bold italic text-xs">Cross-referencing PubMed and ClinicalTrials.gov V2...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            {/* Tab Navigation */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-1">
              <div className="flex gap-8 overflow-x-auto whitespace-nowrap">
                {(Object.keys(AppTab) as Array<keyof typeof AppTab>).map(key => (
                  <button
                    key={key}
                    onClick={() => setTab(AppTab[key])}
                    className={`pb-4 px-1 text-xs font-black uppercase tracking-widest transition-all relative ${
                      tab === AppTab[key] ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {key.replace(/_/g, ' ')}
                    {tab === AppTab[key] && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full"></div>}
                  </button>
                ))}
              </div>
              
              <div className="pb-2 flex items-center bg-slate-100 p-1.5 rounded-2xl shrink-0">
                <button onClick={() => setState(p => ({...p, sortOrder: 'relevance'}))} className={`px-4 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all ${state.sortOrder === 'relevance' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>Relevance</button>
                <button onClick={() => setState(p => ({...p, sortOrder: 'newest'}))} className={`px-4 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all ${state.sortOrder === 'newest' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>Newest</button>
              </div>
            </div>

            {tab === AppTab.DASHBOARD && <Dashboard trials={state.trials} />}

            {tab === AppTab.TRIALS && (
              <div className="grid grid-cols-12 gap-8 animate-in fade-in duration-700">
                {/* Facet Sidebar */}
                <aside className="col-span-12 lg:col-span-3 space-y-8">
                   <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm sticky top-32">
                      <div className="flex items-center justify-between mb-8">
                         <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[2px]">Local Refinements</h3>
                         <button onClick={() => { setSelectedPhases([]); setSelectedStatuses([]); setEnrollmentMin(0); setIndustryOnly(false); }} className="text-[9px] font-black text-indigo-500 uppercase">Reset</button>
                      </div>

                      <div className="space-y-8">
                        <section>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Clinical Phase</p>
                          <div className="flex flex-wrap gap-2">
                             {PHASE_OPTIONS.map(opt => (
                               <button 
                                 key={opt.value} 
                                 onClick={() => toggleLocalPhase(opt.value)}
                                 className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${selectedPhases.includes(opt.value) ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-slate-50 border-slate-100 text-slate-500 hover:border-slate-300'}`}
                               >
                                 {opt.label}
                               </button>
                             ))}
                          </div>
                        </section>

                        <section>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Study Status</p>
                          <div className="space-y-2">
                             {STATUS_OPTIONS.map(opt => (
                               <label key={opt.value} className="flex items-center gap-3 cursor-pointer group">
                                  <input 
                                    type="checkbox" 
                                    checked={selectedStatuses.includes(opt.value)}
                                    onChange={() => toggleLocalStatus(opt.value)}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  <span className={`text-[11px] font-bold transition-colors ${selectedStatuses.includes(opt.value) ? 'text-indigo-600' : 'text-slate-600 group-hover:text-slate-900'}`}>{opt.label}</span>
                               </label>
                             ))}
                          </div>
                        </section>
                      </div>
                   </div>
                </aside>

                {/* Main Results Area */}
                <div className="col-span-12 lg:col-span-9 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredTrials.map(trial => (
                      <TrialCard 
                        key={trial.id} 
                        trial={trial} 
                        isCompareSelected={selectedForComparison.includes(trial.nctId)}
                        onToggleCompare={toggleComparisonSelection}
                        onSelect={(t) => setSelectedTrial(t)} 
                        onAnalyze={(t) => handleGenerateDeepMetrics(t)} 
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === AppTab.PIPELINE && (
              <div className="space-y-8 animate-in fade-in duration-500">
                {!pipelineData && !loadingPipeline ? (
                  <div className="py-32 flex flex-col items-center justify-center bg-white rounded-[3rem] border-2 border-dashed border-slate-200 text-center p-12">
                    <i className="fa-solid fa-diagram-project text-5xl mb-6 text-slate-200"></i>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-[3px] mb-4">Strategic Pipeline Synthesis</h3>
                    <p className="text-xs text-slate-400 max-w-sm mb-10 leading-relaxed italic">"Group current studies by Mechanism of Action (MoA) and Drug Class across clinical phases."</p>
                    <button onClick={handleGeneratePipeline} className="bg-indigo-600 text-white px-10 py-4 rounded-[2rem] text-[11px] font-black uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all">Synthesize Map</button>
                  </div>
                ) : loadingPipeline ? (
                  <div className="py-32 flex flex-col items-center justify-center gap-6 bg-white rounded-[3rem]">
                    <div className="w-16 h-16 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
                    <span className="text-xs font-black text-slate-900 uppercase tracking-[4px]">Generating Competitive Map...</span>
                  </div>
                ) : pipelineData && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {pipelineData.phases.map((phase, idx) => (
                      <div key={idx} className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm">
                        <h4 className="text-[12px] font-black text-slate-900 uppercase tracking-[4px] mb-8 border-b border-slate-200 pb-4 flex items-center justify-between">
                          {phase.phaseName}
                          <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-lg text-slate-500">{phase.groups.length} MoAs</span>
                        </h4>
                        <div className="space-y-8">
                           {phase.groups.map((group, gIdx) => (
                             <div key={gIdx} className="bg-slate-50/50 p-6 rounded-[2rem] border border-slate-100 hover:border-indigo-200 transition-colors">
                               <h5 className="text-[11px] font-black text-indigo-600 uppercase tracking-widest mb-2">{group.groupName}</h5>
                               <p className="text-[10px] text-slate-500 leading-relaxed mb-4">{group.moaDescription}</p>
                               <div className="flex flex-wrap gap-2">
                                  {group.trialIds.map(id => (
                                    <span key={id} className="text-[9px] font-mono font-bold text-slate-400 bg-white px-2 py-1 rounded-md border border-slate-100">{id}</span>
                                  ))}
                               </div>
                             </div>
                           ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === AppTab.TRIAL_COMPARISON && (
              <div className="space-y-8 animate-in fade-in duration-500">
                {!comparisonMatrix && !loadingComparison ? (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                    <div className="lg:col-span-1 bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm">
                       <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-widest mb-6">Comparison Candidates</h3>
                       <div className="space-y-3 mb-8 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                          {state.trials.slice(0, 20).map(t => (
                            <label key={t.nctId} className={`flex items-center gap-4 p-4 rounded-2xl border cursor-pointer transition-all ${selectedForComparison.includes(t.nctId) ? 'border-indigo-600 bg-indigo-50 shadow-sm' : 'border-slate-100 hover:border-slate-300'}`}>
                               <input 
                                 type="checkbox" 
                                 checked={selectedForComparison.includes(t.nctId)}
                                 onChange={() => toggleComparisonSelection(t.nctId)}
                                 className="sr-only"
                               />
                               <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedForComparison.includes(t.nctId) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
                                  {selectedForComparison.includes(t.nctId) && <i className="fa-solid fa-check text-[10px]"></i>}
                               </div>
                               <div className="min-w-0">
                                 <p className="text-[10px] font-black text-slate-900 truncate uppercase">{t.nctId}</p>
                                 <p className="text-[11px] font-medium text-slate-500 truncate leading-tight">{t.title}</p>
                               </div>
                            </label>
                          ))}
                       </div>
                       <button 
                         onClick={handleGenerateComparison} 
                         disabled={selectedForComparison.length < 2}
                         className="w-full bg-slate-900 text-white py-4 rounded-[1.5rem] text-[11px] font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-black transition-all"
                       >
                         Construct Matrix ({selectedForComparison.length} selected)
                       </button>
                    </div>
                    <div className="lg:col-span-2 py-32 border-2 border-dashed border-slate-200 rounded-[3rem] flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 italic text-sm text-center p-12">
                      <i className="fa-solid fa-table-columns text-5xl mb-6 opacity-10"></i>
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-[3px] mb-4">Side-by-Side Analytics</h3>
                      <p className="max-w-xs">Select 2-4 candidates from the registry list to perform an AI-driven structural comparison.</p>
                    </div>
                  </div>
                ) : loadingComparison ? (
                  <div className="py-32 flex flex-col items-center justify-center gap-6 bg-white rounded-[3rem] border border-slate-100 shadow-sm">
                    <div className="w-16 h-16 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
                    <span className="text-xs font-black text-slate-900 uppercase tracking-[4px]">Auditing Selection...</span>
                  </div>
                ) : comparisonMatrix && (
                  <div className="space-y-8 animate-in zoom-in-95 duration-500">
                    <div className="bg-indigo-600 text-white p-12 rounded-[3rem] shadow-2xl">
                      <h3 className="text-[11px] font-black uppercase tracking-[4px] opacity-70 mb-4">Strategic Synthesis</h3>
                      <p className="text-lg font-bold leading-relaxed">{comparisonMatrix.strategicSummary}</p>
                    </div>
                    
                    <div className="bg-white rounded-[3rem] border border-slate-100 shadow-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-100">
                              <th className="p-8 text-[11px] font-black text-slate-400 uppercase tracking-widest min-w-[200px]">Clinical Parameter</th>
                              {comparisonMatrix.headers.map(h => (
                                <th key={h} className="p-8 text-[11px] font-black text-indigo-600 uppercase tracking-widest min-w-[250px]">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {comparisonMatrix.rows.map((row, idx) => (
                              <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                                <td className="p-8 text-[11px] font-black text-slate-900 uppercase tracking-widest bg-slate-50/10">{row.label}</td>
                                {row.values.map((v, vIdx) => (
                                  <td key={vIdx} className="p-8 text-xs font-medium text-slate-600 leading-relaxed">{v}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <button onClick={() => setComparisonMatrix(null)} className="text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">← Back to Selection</button>
                  </div>
                )}
              </div>
            )}

            {tab === AppTab.TRIAL_METRICS && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="bg-slate-900 text-white p-12 rounded-[3rem] shadow-2xl relative overflow-hidden">
                   <div className="absolute top-0 right-0 p-12 opacity-10"><i className="fa-solid fa-microscope text-[180px]"></i></div>
                   <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-8">
                         <div className="px-4 py-1.5 bg-indigo-500/20 border border-indigo-500/40 rounded-full text-[10px] font-black uppercase tracking-[2px] text-indigo-300">Advanced Audit Mode</div>
                      </div>
                      <h2 className="text-3xl font-black mb-6 tracking-tight">Clinical Trial Deep Metrics</h2>
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Perspective Lens</span>
                        <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10">
                           {(['RESEARCHER', 'REGULATORY', 'STRATEGY', 'OPERATIONS'] as UserRole[]).map(role => (
                             <button 
                               key={role} 
                               onClick={() => setActiveUserRole(role)}
                               className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeUserRole === role ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                             >
                               {role}
                             </button>
                           ))}
                        </div>
                      </div>
                   </div>
                </div>

                {!auditTrialId || (!deepMetrics && !loadingDeepMetrics) ? (
                  <div className="py-32 border-2 border-dashed border-slate-200 rounded-[3rem] flex flex-col items-center text-slate-400 bg-white text-center p-12">
                     <i className="fa-solid fa-robot text-5xl mb-6 opacity-10"></i>
                     <h3 className="text-sm font-black text-slate-900 uppercase tracking-[3px] mb-4">AI Audit Standby</h3>
                     <p className="text-xs font-medium max-w-sm mb-10 leading-relaxed text-slate-400 italic">"Select a protocol from the discovery registry and trigger the 'Audit' sequence to generate technical benchmarking."</p>
                     <button onClick={() => setTab(AppTab.TRIALS)} className="bg-indigo-600 text-white px-10 py-4 rounded-[2rem] text-[11px] font-black uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all">Explore Discovery Hub</button>
                  </div>
                ) : loadingDeepMetrics ? (
                  <div className="py-32 flex flex-col items-center justify-center space-y-8 bg-white rounded-[3rem] border border-slate-100 shadow-sm">
                    <div className="w-20 h-20 border-8 border-slate-50 border-t-indigo-600 rounded-full animate-spin shadow-inner"></div>
                    <div className="text-center">
                      <p className="text-sm font-black text-slate-900 uppercase tracking-[4px] mb-2 animate-pulse">Analyzing Protocol {auditTrialId}</p>
                      <p className="text-[11px] text-slate-400 font-bold max-w-xs leading-relaxed">Extracting SAP parameters, primary estimands, and safety stopping criteria from registry endpoints...</p>
                    </div>
                  </div>
                ) : deepMetrics && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8">
                    {[
                      { id: 'identification', title: '1. Identification', icon: 'fa-fingerprint', color: 'indigo', data: deepMetrics.identification },
                      { id: 'design', title: '2. Study Design', icon: 'fa-compass-drafting', color: 'blue', data: deepMetrics.design },
                      { id: 'population', title: '3. Population', icon: 'fa-users-gear', color: 'cyan', data: deepMetrics.population },
                      { id: 'intervention', title: '4. Intervention', icon: 'fa-syringe', color: 'emerald', data: deepMetrics.intervention },
                      { id: 'outcomes', title: '5. Outcomes', icon: 'fa-bullseye', color: 'rose', data: deepMetrics.outcomes },
                      { id: 'statistical', title: '6. Statistics', icon: 'fa-chart-area', color: 'violet', data: deepMetrics.statistical },
                      { id: 'safety', title: '7. Safety', icon: 'fa-shield-heart', color: 'amber', data: deepMetrics.safety },
                      { id: 'ethics', title: '8. Ethics', icon: 'fa-gavel', color: 'slate', data: deepMetrics.ethics },
                      { id: 'operational', title: '9. Operational', icon: 'fa-stopwatch', color: 'teal', data: deepMetrics.operational },
                      { id: 'results', title: '10. Results', icon: 'fa-award', color: 'yellow', data: deepMetrics.results },
                    ].map((section) => (
                      <div 
                        key={section.id} 
                        className={`bg-white p-8 rounded-[2.5rem] border transition-all duration-500 relative group/card ${
                          roleHighlights.includes(section.id as any) 
                            ? `border-${section.color}-500 shadow-2xl shadow-${section.color}-100 ring-4 ring-${section.color}-500/5 scale-105 z-10` 
                            : 'border-slate-100 shadow-sm opacity-50 grayscale hover:opacity-100 hover:grayscale-0'
                        }`}
                      >
                         <div className="flex items-center justify-between mb-6">
                            <div className={`w-12 h-12 rounded-2xl bg-${section.color}-50 text-${section.color}-600 flex items-center justify-center text-lg`}>
                               <i className={`fa-solid ${section.icon}`}></i>
                            </div>
                            {roleHighlights.includes(section.id as any) && (
                              <span className={`text-[8px] font-black uppercase tracking-widest text-${section.color}-600 bg-${section.color}-50 px-2 py-1 rounded-full`}>High Priority</span>
                            )}
                         </div>
                         <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest mb-8 min-h-[30px]">{section.title}</h4>
                         <div className="space-y-6">
                            {Object.entries(section.data).map(([key, val]) => (
                              <div key={key}>
                                 <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-1.5">{key.replace(/([A-Z])/g, ' $1')}</p>
                                 <p className="text-[11px] font-bold text-slate-800 leading-tight">{val}</p>
                              </div>
                            ))}
                         </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Architecture Tab */}
            {tab === AppTab.SYSTEM_ARCH && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="bg-white p-12 rounded-[3rem] border border-slate-100 shadow-xl flex flex-col items-center text-center">
                  <div className="max-w-3xl mb-12">
                    <h2 className="text-2xl font-black text-slate-900 uppercase tracking-[4px] mb-4">Technical System Architecture</h2>
                    <p className="text-sm text-slate-500 leading-relaxed italic mb-8">
                      "TrialAtlas leverages a decentralized intelligence framework, connecting ClinicalTrials.gov and PubMed via the Google Gemini 3 synthesis engine."
                    </p>
                  </div>

                  <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-10">
                    {/* Deterministic SVG Architecture */}
                    <div className="space-y-6">
                       <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Standardized Architecture Diagram</h3>
                       <ArchitectureDiagram />
                    </div>

                    {/* AI Generation Control */}
                    <div className="space-y-6">
                       <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AI Imaginative Blueprint</h3>
                       {!archImageUrl && !generatingArch ? (
                        <div className="h-[400px] lg:h-full min-h-[400px] border-2 border-dashed border-slate-100 rounded-[2rem] flex flex-col items-center justify-center p-10 bg-slate-50/50">
                          <i className="fa-solid fa-object-group text-5xl text-slate-200 mb-8"></i>
                          <p className="text-[11px] text-slate-400 font-bold mb-8 italic">Use Gemini Image Generation to create a stylized 3D conceptual map.</p>
                          <button 
                            onClick={handleGenerateArch}
                            className="bg-indigo-600 text-white px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[2px] shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center gap-3"
                          >
                            <i className="fa-solid fa-wand-magic-sparkles"></i>
                            Generate Styled Map
                          </button>
                        </div>
                      ) : generatingArch ? (
                        <div className="h-full min-h-[400px] flex flex-col items-center justify-center gap-6 bg-slate-50 rounded-[2rem] border border-slate-100">
                           <div className="w-16 h-16 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
                           <p className="text-[10px] font-black text-slate-900 uppercase tracking-[4px] animate-pulse">Rendering Blueprint...</p>
                        </div>
                      ) : archImageUrl && (
                        <div className="w-full space-y-6 animate-in zoom-in-95 duration-700">
                           <div className="relative group overflow-hidden rounded-[2.5rem] shadow-xl border border-slate-200">
                              <img src={archImageUrl} alt="System Architecture" className="w-full h-auto object-cover" />
                              <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                 <a href={archImageUrl} download="TrialAtlas-Architecture-AI.png" className="bg-white text-slate-900 px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-2xl flex items-center gap-2">
                                    <i className="fa-solid fa-download"></i>
                                    Save
                                 </a>
                              </div>
                           </div>
                           <button onClick={() => setArchImageUrl(null)} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">← Regenerate Styled Map</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Literature Tab */}
            {tab === AppTab.LITERATURE && (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-10 animate-in fade-in duration-500">
                <div className="lg:col-span-1 space-y-6 max-h-[85vh] overflow-y-auto pr-2 custom-scrollbar">
                  <div className="flex flex-col gap-4 sticky top-0 bg-slate-50 py-2 z-10">
                    <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Evidence Hub</h3>
                    <input 
                      type="text" 
                      placeholder="Filter publications..." 
                      value={localPubJournalQuery}
                      onChange={(e) => setLocalPubJournalQuery(e.target.value)}
                      className="w-full pl-5 pr-5 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-bold outline-none shadow-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  {filteredPublications.map(pub => (
                    <div key={pub.pmid} onClick={() => handlePaperClick(pub)} className={`p-6 rounded-[2rem] border cursor-pointer transition-all duration-300 ${selectedPaper?.paper.pmid === pub.pmid ? 'border-indigo-600 bg-indigo-50 shadow-xl scale-[1.02]' : 'border-slate-100 bg-white hover:border-slate-300 shadow-sm'}`}>
                      <h4 className="text-[12px] font-bold text-slate-900 line-clamp-3 mb-3 leading-snug">{pub.title}</h4>
                      <div className="flex items-center justify-between">
                         <span className="text-[9px] text-indigo-500 font-black uppercase tracking-widest truncate max-w-[150px]">{pub.journal}</span>
                         <span className="text-[8px] font-mono text-slate-400">PMID: {pub.pmid}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="lg:col-span-3 min-h-[85vh]">
                  {!selectedPaper ? (
                    <div className="h-full border-2 border-dashed border-slate-200 rounded-[3rem] flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 p-12 text-center">
                      <i className="fa-solid fa-book-open-reader text-5xl mb-6 opacity-10"></i>
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-[3px] mb-4">Select Source Evidence</h3>
                      <p className="text-xs font-medium max-w-sm leading-relaxed text-slate-400 italic">Initialize the AI peer-review engine by selecting a publication from the list.</p>
                    </div>
                  ) : paperAnalyzing ? (
                    <div className="h-full flex flex-col items-center justify-center gap-6 bg-white rounded-[3rem] border border-slate-100 shadow-sm p-12">
                      <div className="w-16 h-16 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
                      <div className="text-center">
                        <p className="text-xs font-black text-slate-900 uppercase tracking-[4px] animate-pulse">Running AI Peer Review</p>
                        <p className="text-[10px] text-slate-400 font-bold mt-2">Synthesizing trial methodology, findings, and clinical KPIs...</p>
                      </div>
                    </div>
                  ) : selectedPaper.analysis && (
                    <div className="bg-white p-10 lg:p-14 rounded-[3rem] border border-slate-100 shadow-2xl animate-in slide-in-from-right-10 duration-500">
                      {/* Paper Header */}
                      <header className="mb-12">
                        <div className="flex flex-wrap items-center gap-4 mb-6">
                           <span className="bg-indigo-600 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[2px]">Scientific Review</span>
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{selectedPaper.paper.journal}</span>
                        </div>
                        <h2 className="text-3xl lg:text-4xl font-black mb-8 leading-tight text-slate-900">{selectedPaper.paper.title}</h2>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-t border-slate-100 pt-8">
                           <div className="max-w-2xl">
                             <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Authors</p>
                             <p className="text-xs font-bold text-slate-600 leading-relaxed">{selectedPaper.paper.authors.join(', ')}</p>
                           </div>
                           <div className="shrink-0">
                             <a 
                               href={`https://pubmed.ncbi.nlm.nih.gov/${selectedPaper.paper.pmid}/`} 
                               target="_blank" 
                               rel="noreferrer"
                               className="bg-slate-900 text-white px-8 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-black transition-all flex items-center gap-3 shadow-lg"
                             >
                               External Link
                               <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                             </a>
                           </div>
                        </div>
                      </header>

                      {/* Main Summary Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                        {[
                          { title: 'The Clinical Why (Rationale)', content: selectedPaper.analysis.why, icon: 'fa-lightbulb', color: 'amber' },
                          { title: 'The Methodological How (Design)', content: selectedPaper.analysis.how, icon: 'fa-flask', color: 'blue' },
                          { title: 'Major Findings (What)', content: selectedPaper.analysis.what, icon: 'fa-chart-simple', color: 'emerald' },
                          { title: 'Implications (Meaning)', content: selectedPaper.analysis.meaning, icon: 'fa-dna', color: 'indigo' },
                        ].map((sec, i) => (
                          <div key={i} className={`p-8 rounded-[2.5rem] bg-${sec.color}-50/30 border border-${sec.color}-100/50`}>
                             <div className="flex items-center gap-3 mb-4">
                               <div className={`w-8 h-8 rounded-xl bg-${sec.color}-50 text-${sec.color}-600 flex items-center justify-center text-xs`}>
                                 <i className={`fa-solid ${sec.icon}`}></i>
                               </div>
                               <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">{sec.title}</h4>
                             </div>
                             <p className="text-sm font-medium text-slate-700 leading-relaxed">{sec.content}</p>
                          </div>
                        ))}
                      </div>

                      {/* Relevance Scoreboard */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
                         <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
                            <div className="flex items-center gap-3 mb-6">
                               <i className="fa-solid fa-vial-circle-check text-violet-500"></i>
                               <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Statistical Relevance</h4>
                            </div>
                            <p className="text-sm font-medium text-slate-600 leading-relaxed">{selectedPaper.analysis.statisticalRelevance}</p>
                         </div>
                         <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
                            <div className="flex items-center gap-3 mb-6">
                               <i className="fa-solid fa-stethoscope text-rose-500"></i>
                               <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Clinical Impact</h4>
                            </div>
                            <p className="text-sm font-medium text-slate-600 leading-relaxed">{selectedPaper.analysis.clinicalRelevance}</p>
                         </div>
                      </div>

                      {/* Technical KPI Grid */}
                      <div className="border-t border-slate-100 pt-12">
                         <h4 className="text-[12px] font-black text-slate-900 uppercase tracking-[4px] mb-8 text-center">Trial Methodology KPIs</h4>
                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {[
                              { label: 'Trial Type', value: selectedPaper.analysis.kpis.trialType, icon: 'fa-folder-tree' },
                              { label: 'Blinding Mode', value: selectedPaper.analysis.kpis.blinding, icon: 'fa-eye-slash' },
                              { label: 'Population (N)', value: selectedPaper.analysis.kpis.population, icon: 'fa-users' },
                              { label: 'Safety Profile', value: selectedPaper.analysis.kpis.safetyConcerns, icon: 'fa-shield-virus' },
                              { label: 'Potential Biases', value: selectedPaper.analysis.kpis.possibleBiases, icon: 'fa-scale-unbalanced' },
                              { label: 'Gold Standards', value: selectedPaper.analysis.kpis.goldStandards, icon: 'fa-award' },
                              { label: 'Study Quality', value: selectedPaper.analysis.kpis.quality, icon: 'fa-check-double' },
                              { label: 'Robustness', value: selectedPaper.analysis.kpis.robustness, icon: 'fa-vault' }
                            ].map((kpi, i) => (
                              <div key={i} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                                 <div className="flex items-center gap-2 mb-3">
                                   <i className={`fa-solid ${kpi.icon} text-slate-300 text-[10px]`}></i>
                                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{kpi.label}</p>
                                 </div>
                                 <p className="text-[11px] font-bold text-slate-800 leading-tight">{kpi.value}</p>
                              </div>
                            ))}
                         </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Protocol Modal */}
      {selectedTrial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
          <div className="bg-white w-full max-w-5xl max-h-[90vh] rounded-[3rem] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">
            <div className="p-10 border-b border-slate-100 flex justify-between items-center bg-indigo-50/30">
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-indigo-100 shadow-2xl"><i className="fa-solid fa-file-medical text-white text-xl"></i></div>
                <div><span className="text-[11px] font-black text-indigo-500 mb-1 block tracking-[3px] uppercase">{selectedTrial.nctId}</span><h2 className="text-2xl font-black text-slate-900 leading-tight">{selectedTrial.title}</h2></div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => handleGenerateDeepMetrics(selectedTrial)} className="bg-indigo-600 text-white h-12 px-8 rounded-2xl text-xs font-black uppercase hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-xl shadow-indigo-100">Audit Protocol</button>
                <button onClick={() => setSelectedTrial(null)} className="w-12 h-12 rounded-2xl hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors bg-white border border-slate-100"><i className="fa-solid fa-xmark"></i></button>
              </div>
            </div>
            <div className="flex-grow overflow-y-auto p-12 space-y-12">
               <div className="bg-slate-50/50 p-10 rounded-[2.5rem] border border-slate-100">
                  <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest mb-6 border-b border-slate-200 pb-4">Scientific Abstract</h4>
                  <p className="text-[15px] text-slate-600 leading-relaxed font-medium">{selectedTrial.briefSummary}</p>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Terminal */}
      {chatOpen && (
        <div className="fixed bottom-24 right-10 w-full max-w-md h-[600px] bg-white rounded-[2.5rem] shadow-2xl z-40 flex flex-col border border-slate-200 overflow-hidden animate-in slide-in-from-bottom-20 duration-500">
          <div className="bg-slate-900 p-6 text-white flex justify-between items-center"><div className="flex items-center gap-3"><i className="fa-solid fa-robot text-indigo-400"></i><span className="text-xs font-black uppercase tracking-[3px]">TrialAtlas AI</span></div><button onClick={() => setChatOpen(false)} className="text-slate-500 hover:text-white"><i className="fa-solid fa-minus"></i></button></div>
          <div className="flex-grow p-6 overflow-y-auto space-y-6 bg-slate-50">
            {chatHistory.map((chat, idx) => (
              <div key={idx} className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] p-5 rounded-[1.5rem] text-[12px] leading-relaxed font-medium shadow-sm ${chat.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-slate-100 text-slate-700 rounded-bl-none'}`}>{chat.text}</div>
              </div>
            ))}
            {isTyping && <div className="flex justify-start"><div className="bg-white p-4 rounded-full shadow-sm"><div className="flex gap-1"><div className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce delay-100"></div><div className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce delay-200"></div></div></div></div>}
            <div ref={chatEndRef}></div>
          </div>
          <div className="p-6 border-t flex gap-3 bg-white">
            <input type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Clarify protocol endpoints..." className="flex-grow py-4 px-6 bg-slate-100 border-none rounded-2xl text-xs font-bold outline-none placeholder:text-slate-400" />
            <button onClick={handleSendMessage} className="bg-indigo-600 text-white w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-100 hover:scale-105 active:scale-95 transition-all"><i className="fa-solid fa-paper-plane"></i></button>
          </div>
        </div>
      )}
      <button onClick={() => setChatOpen(!chatOpen)} className={`fixed bottom-8 right-10 w-16 h-16 rounded-[2rem] shadow-2xl flex items-center justify-center z-40 transition-all duration-500 ${chatOpen ? 'bg-slate-800 rotate-180 scale-90' : 'bg-indigo-600 hover:scale-110 active:scale-95'}`}><i className={`fa-solid ${chatOpen ? 'fa-chevron-down' : 'fa-robot'} text-2xl text-white`}></i></button>
    </div>
  );
};

export default App;
