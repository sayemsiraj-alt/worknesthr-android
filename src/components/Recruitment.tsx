import { useState, useRef, useMemo } from 'react';
import { useData, RecruitmentJob, Candidate, CandidateStage } from '../context/DataContext';

const STAGES: { id: CandidateStage; label: string; color: string; badgeBg: string }[] = [
  { id: 'applied', label: 'Applied', color: 'text-slate-700', badgeBg: 'bg-slate-100 text-slate-700' },
  { id: 'screening', label: 'Screening', color: 'text-blue-700', badgeBg: 'bg-blue-100 text-blue-700' },
  { id: 'interview', label: 'Interview Scheduled', color: 'text-purple-700', badgeBg: 'bg-purple-100 text-purple-700' },
  { id: 'offer', label: 'Job Offer', color: 'text-amber-700', badgeBg: 'bg-amber-100 text-amber-700' },
  { id: 'hired', label: 'Hired & Onboarded', color: 'text-emerald-700', badgeBg: 'bg-emerald-100 text-emerald-700' },
  { id: 'rejected', label: 'Rejected', color: 'text-rose-700', badgeBg: 'bg-rose-100 text-rose-700' },
];

export function Recruitment() {
  const {
    recruitmentJobs,
    addRecruitmentJob,
    updateRecruitmentJobStatus,
    candidates,
    addCandidate,
    addCandidatesBatch,
    updateCandidateStage,
    updateCandidate,
    deleteCandidate,
    hireCandidate,
    departments,
    addNotification,
  } = useData();

  // Navigation tab: 'pipeline' (Candidates / Applicants) vs 'jobs' (Job Circulars)
  const [activeTab, setActiveTab] = useState<'pipeline' | 'jobs'>('pipeline');

  // Modals
  const [showJobModal, setShowJobModal] = useState(false);
  const [showAddCandidateModal, setShowAddCandidateModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showHireModal, setShowHireModal] = useState<Candidate | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [jobFilter, setJobFilter] = useState<string>('all');

  // CSV Import State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [csvText, setCsvText] = useState('');
  const [csvError, setCsvError] = useState('');
  const [csvSuccessMsg, setCsvSuccessMsg] = useState('');
  const [parsedPreview, setParsedPreview] = useState<Omit<Candidate, 'id'>[]>([]);

  // Job Opening Form
  const [jobFormData, setJobFormData] = useState({
    title: '',
    department: departments[0]?.name || 'Engineering',
    vacancies: 1,
    type: 'Full-time',
    experience: '1-3 years',
    status: 'open' as 'open' | 'closed',
  });

  // Single Candidate Form
  const [candidateForm, setCandidateForm] = useState<Omit<Candidate, 'id'>>({
    name: '',
    phone: '',
    email: '',
    jobId: '',
    jobTitle: recruitmentJobs[0]?.title || 'Senior Full Stack Engineer',
    department: recruitmentJobs[0]?.department || 'Engineering',
    stage: 'applied',
    appliedDate: new Date().toISOString().split('T')[0],
    interviewDate: '',
    expectedSalary: 35000,
    experience: '1-2 years',
    notes: '',
  });

  // Hired Salary Input
  const [hireSalary, setHireSalary] = useState<number>(35000);

  // Handle Job Submit
  const handleJobSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addRecruitmentJob({
      ...jobFormData,
      postedDate: new Date().toISOString().split('T')[0],
      applicantsCount: 0,
    });
    addNotification({
      title: 'Job Position Created',
      message: `${jobFormData.title} job posting has been published`,
      read: false,
      type: 'recruitment',
      targetPage: 'recruitment',
    });
    setShowJobModal(false);
  };

  // Handle Single Candidate Submit
  const handleCandidateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidateForm.name.trim() || !candidateForm.phone.trim()) {
      alert('Candidate Name and Phone Number are required.');
      return;
    }

    await addCandidate(candidateForm);
    addNotification({
      title: 'New Candidate Registered',
      message: `${candidateForm.name} (${candidateForm.phone}) added for ${candidateForm.jobTitle}`,
      read: false,
      type: 'recruitment',
      targetPage: 'recruitment',
    });

    setShowAddCandidateModal(false);
    setCandidateForm({
      name: '',
      phone: '',
      email: '',
      jobId: recruitmentJobs[0]?.id || '',
      jobTitle: recruitmentJobs[0]?.title || 'Officer',
      department: recruitmentJobs[0]?.department || 'General',
      stage: 'applied',
      appliedDate: new Date().toISOString().split('T')[0],
      interviewDate: '',
      expectedSalary: 30000,
      experience: '',
      notes: '',
    });
  };

  // CSV Parsing Logic (supporting both comma & semicolon, quotes, headers: Name, Phone, Email, Position/Job, Expected Salary, Experience)
  const parseCSVContent = (content: string) => {
    setCsvError('');
    setCsvSuccessMsg('');
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      setCsvError('CSV file must have a header row and at least one candidate record.');
      setParsedPreview([]);
      return;
    }

    // Determine delimiter
    const headerLine = lines[0];
    const delimiter = headerLine.includes(';') ? ';' : ',';
    const rawHeaders = headerLine.split(delimiter).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

    // Find column indexes
    const nameIdx = rawHeaders.findIndex(h => h.includes('name'));
    const phoneIdx = rawHeaders.findIndex(h => h.includes('phone') || h.includes('mobile') || h.includes('contact'));
    const emailIdx = rawHeaders.findIndex(h => h.includes('email') || h.includes('mail'));
    const jobIdx = rawHeaders.findIndex(h => h.includes('position') || h.includes('job') || h.includes('title') || h.includes('role'));
    const deptIdx = rawHeaders.findIndex(h => h.includes('dept') || h.includes('department'));
    const salaryIdx = rawHeaders.findIndex(h => h.includes('salary') || h.includes('expected'));
    const expIdx = rawHeaders.findIndex(h => h.includes('exp') || h.includes('experience'));
    const notesIdx = rawHeaders.findIndex(h => h.includes('note') || h.includes('remark') || h.includes('status'));

    if (nameIdx === -1) {
      setCsvError('Could not locate "Name" column in CSV header. Please make sure header contains Name, Phone, etc.');
      setParsedPreview([]);
      return;
    }

    const previewList: Omit<Candidate, 'id'>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
      const name = row[nameIdx] || '';
      if (!name) continue;

      const phone = phoneIdx !== -1 ? (row[phoneIdx] || '') : '';
      const email = emailIdx !== -1 ? (row[emailIdx] || '') : '';
      const jobTitle = jobIdx !== -1 && row[jobIdx] ? row[jobIdx] : (recruitmentJobs[0]?.title || 'Applicant');
      const dept = deptIdx !== -1 && row[deptIdx] ? row[deptIdx] : (recruitmentJobs[0]?.department || 'General');
      const salary = salaryIdx !== -1 ? (Number(row[salaryIdx].replace(/[^0-9]/g, '')) || 30000) : 30000;
      const exp = expIdx !== -1 ? (row[expIdx] || '') : '';
      const notes = notesIdx !== -1 ? (row[notesIdx] || '') : 'Imported via CSV batch';

      previewList.push({
        name,
        phone: phone || 'N/A',
        email,
        jobTitle,
        department: dept,
        stage: 'applied',
        appliedDate: new Date().toISOString().split('T')[0],
        expectedSalary: salary,
        experience: exp,
        notes,
      });
    }

    if (previewList.length === 0) {
      setCsvError('No valid rows found in CSV data.');
      setParsedPreview([]);
    } else {
      setParsedPreview(previewList);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      const text = event.target?.result as string;
      setCsvText(text);
      parseCSVContent(text);
    };
    reader.readAsText(file);
  };

  const handleImportBatch = async () => {
    if (parsedPreview.length === 0) return;
    const count = await addCandidatesBatch(parsedPreview);
    addNotification({
      title: 'CSV Candidates Imported',
      message: `Successfully imported ${count} candidates into the recruitment pipeline`,
      read: false,
      type: 'recruitment',
      targetPage: 'recruitment',
    });
    setCsvSuccessMsg(`Successfully imported ${count} candidates!`);
    setTimeout(() => {
      setShowCsvModal(false);
      setParsedPreview([]);
      setCsvText('');
      setCsvSuccessMsg('');
    }, 1200);
  };

  // Download Sample CSV template
  const downloadSampleCsv = () => {
    const sample = `Name,Phone,Email,Position,Department,Expected Salary,Experience,Notes
Md. Aminul Islam,+880 1712-345678,aminul@example.com,Senior Full Stack Engineer,Engineering,65000,4 years,Full stack web developer
Farzana Akter,+880 1823-456789,farzana@example.com,HR Operations Specialist,Human Resources,35000,2 years,Experienced in attendance & payroll
Saiful Bari,+880 1934-567890,saiful@example.com,Senior Full Stack Engineer,Engineering,60000,3 years,React and Node.js specialist`;

    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'candidates_sample_import.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Hire Action
  const confirmHire = async () => {
    if (!showHireModal) return;
    await hireCandidate(showHireModal, hireSalary);
    addNotification({
      title: 'Candidate Hired & Onboarded',
      message: `${showHireModal.name} has been hired and enrolled into Employee Management at ৳${hireSalary.toLocaleString()}`,
      read: false,
      type: 'recruitment',
      targetPage: 'employee',
    });
    setShowHireModal(null);
  };

  // Filtered candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter(cand => {
      const matchSearch =
        cand.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cand.phone.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (cand.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        cand.jobTitle.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStage = stageFilter === 'all' || cand.stage === stageFilter;
      const matchJob = jobFilter === 'all' || cand.jobTitle === jobFilter || cand.jobId === jobFilter;
      return matchSearch && matchStage && matchJob;
    });
  }, [candidates, searchQuery, stageFilter, jobFilter]);

  // Stage counts for pipeline overview
  const stageStats = useMemo(() => {
    const counts: Record<string, number> = {
      all: candidates.length,
      applied: 0,
      screening: 0,
      interview: 0,
      offer: 0,
      hired: 0,
      rejected: 0,
    };
    candidates.forEach(c => {
      if (counts[c.stage] !== undefined) counts[c.stage]++;
    });
    return counts;
  }, [candidates]);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Recruitment &amp; Applicant Tracking</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Collect interviewee phone numbers &amp; names, batch import candidates via CSV, and track pipeline through hiring
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* CSV Import Button */}
          <button
            id="btn-csv-import"
            onClick={() => {
              setParsedPreview([]);
              setCsvError('');
              setCsvSuccessMsg('');
              setShowCsvModal(true);
            }}
            className="flex-1 sm:flex-none justify-center px-3 sm:px-3.5 py-2 sm:py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <span>📥</span>
            <span>Import (CSV)</span>
          </button>

          {/* Add Single Candidate */}
          <button
            id="btn-add-candidate"
            onClick={() => setShowAddCandidateModal(true)}
            className="flex-1 sm:flex-none justify-center px-3 sm:px-3.5 py-2 sm:py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <span>👤</span>
            <span>+ Candidate</span>
          </button>

          {/* Post Job Opening */}
          <button
            id="btn-post-job"
            onClick={() => setShowJobModal(true)}
            className="w-full sm:w-auto justify-center px-3 sm:px-3.5 py-2 sm:py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl shadow-xs font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <span>➕</span>
            <span>Post Job</span>
          </button>
        </div>
      </div>

      {/* Primary Tab Navigation: Candidates vs Job Openings */}
      <div className="flex items-center space-x-4 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('pipeline')}
          className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center space-x-2 ${
            activeTab === 'pipeline'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>👥 Candidates Pipeline ({candidates.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('jobs')}
          className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center space-x-2 ${
            activeTab === 'jobs'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>📋 Job Openings ({recruitmentJobs.length})</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: CANDIDATES PIPELINE & INTERVIEW COLLECTION                        */}
      {/* ========================================================================= */}
      {activeTab === 'pipeline' && (
        <div className="space-y-5">
          {/* Pipeline Stage Quick Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {STAGES.map(s => (
              <button
                key={s.id}
                onClick={() => setStageFilter(stageFilter === s.id ? 'all' : s.id)}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  stageFilter === s.id
                    ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20 shadow-xs'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <p className="text-[11px] font-semibold text-slate-500">{s.label}</p>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-xl font-extrabold text-slate-800">{stageStats[s.id] || 0}</span>
                  {s.id === 'hired' && <span className="text-xs">🎉</span>}
                  {s.id === 'interview' && <span className="text-xs">📅</span>}
                </div>
              </button>
            ))}
          </div>

          {/* Search & Filters Bar */}
          <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <input
                type="text"
                placeholder="🔍 Search candidate name, phone number, position or email..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>
            <div>
              <select
                value={stageFilter}
                onChange={e => setStageFilter(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              >
                <option value="all">All Pipeline Stages ({candidates.length})</option>
                {STAGES.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label} ({stageStats[s.id] || 0})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <select
                value={jobFilter}
                onChange={e => setJobFilter(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              >
                <option value="all">All Job Positions</option>
                {recruitmentJobs.map(j => (
                  <option key={j.id} value={j.title}>
                    {j.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Candidate Table */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[850px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">CANDIDATE INFO</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">CONTACT &amp; PHONE</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">POSITION APPLIED</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">EXPECTED SALARY</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">CURRENT STAGE</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">INTERVIEW / NOTES</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">STAGE ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-400">
                        <div className="text-4xl mb-2">📋</div>
                        <p className="font-semibold text-slate-600">No candidates found in this view</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Collect candidate phone &amp; name via "+ Add Candidate" or import an existing CSV file
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredCandidates.map(cand => {
                      const stageObj = STAGES.find(s => s.id === cand.stage) || STAGES[0];

                      return (
                        <tr key={cand.id} className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center space-x-3">
                              <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 font-bold flex items-center justify-center text-sm shadow-xs">
                                {cand.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-slate-800">{cand.name}</div>
                                <div className="text-xs text-slate-400">Applied: {cand.appliedDate}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs font-semibold text-indigo-700 flex items-center space-x-1">
                              <span>📞</span>
                              <span>{cand.phone}</span>
                            </div>
                            {cand.email && <div className="text-[11px] text-slate-500">{cand.email}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-800">{cand.jobTitle}</div>
                            {cand.department && <div className="text-xs text-slate-400">{cand.department}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-slate-700">
                              ৳ {(cand.expectedSalary || 0).toLocaleString()}
                            </span>
                            {cand.experience && (
                              <div className="text-[11px] text-slate-400">{cand.experience}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${stageObj.badgeBg}`}>
                              {stageObj.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 max-w-[200px]">
                            {cand.interviewDate ? (
                              <div className="text-xs text-purple-700 font-semibold flex items-center space-x-1">
                                <span>📅</span>
                                <span>{cand.interviewDate}</span>
                              </div>
                            ) : null}
                            <div className="text-xs text-slate-500 truncate" title={cand.notes || ''}>
                              {cand.notes || <span className="text-slate-300 italic">No notes</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end space-x-1.5">
                              {/* Quick Stage Dropdown */}
                              <select
                                value={cand.stage}
                                onChange={e => {
                                  const newStage = e.target.value as CandidateStage;
                                  if (newStage === 'hired') {
                                    setHireSalary(cand.expectedSalary || 35000);
                                    setShowHireModal(cand);
                                  } else {
                                    updateCandidateStage(cand.id, newStage);
                                  }
                                }}
                                className="text-xs px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                {STAGES.map(s => (
                                  <option key={s.id} value={s.id}>
                                    Move to: {s.label}
                                  </option>
                                ))}
                              </select>

                              {/* Direct Hire Button */}
                              {cand.stage !== 'hired' && (
                                <button
                                  onClick={() => {
                                    setHireSalary(cand.expectedSalary || 35000);
                                    setShowHireModal(cand);
                                  }}
                                  className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold hover:bg-emerald-100 transition-all"
                                  title="Hire and automatically create employee record"
                                >
                                  Hire ✓
                                </button>
                              )}

                              {/* Details/Edit */}
                              <button
                                onClick={() => setSelectedCandidate(cand)}
                                className="px-2 py-1 text-xs border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-100"
                              >
                                Edit
                              </button>

                              {/* Delete */}
                              <button
                                onClick={() => {
                                  if (confirm(`Remove candidate ${cand.name}?`)) {
                                    deleteCandidate(cand.id);
                                  }
                                }}
                                className="px-2 py-1 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: JOB OPENINGS & CIRCULARS (ORIGINAL CORE PRESERVED)                */}
      {/* ========================================================================= */}
      {activeTab === 'jobs' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recruitmentJobs.map((job: RecruitmentJob) => (
            <div
              key={job.id}
              className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 text-base">{job.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {job.department} • {job.type}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase ${
                      job.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {job.status}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>Vacancies:</span>
                    <span className="font-bold">{job.vacancies}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Experience:</span>
                    <span className="font-bold">{job.experience}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Applicants in Pipeline:</span>
                    <span className="font-bold text-indigo-600">
                      {candidates.filter(c => c.jobTitle === job.title || c.jobId === job.id).length || job.applicantsCount}{' '}
                      candidates
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Posted Date:</span>
                    <span>{job.postedDate}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => {
                    setJobFilter(job.title);
                    setActiveTab('pipeline');
                  }}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
                >
                  View Applicants →
                </button>
                <button
                  onClick={() => updateRecruitmentJobStatus(job.id, job.status === 'open' ? 'closed' : 'open')}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Mark as {job.status === 'open' ? 'Closed' : 'Open'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CSV FILE IMPORT MODAL                                            */}
      {/* ========================================================================= */}
      {showCsvModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">📥</span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Import Candidate List via CSV</h3>
                  <p className="text-xs text-slate-500">
                    Upload interviewees with Name, Phone Number, Position, and Notes
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCsvModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Template Download & Instructions */}
              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between text-xs text-indigo-900">
                <div>
                  <p className="font-semibold">Need the CSV template?</p>
                  <p className="text-indigo-700/80 mt-0.5">Required columns: <strong>Name, Phone</strong>. Optional: Email, Position, Expected Salary, Experience, Notes.</p>
                </div>
                <button
                  type="button"
                  onClick={downloadSampleCsv}
                  className="px-3 py-1.5 bg-white border border-indigo-200 hover:bg-indigo-50 font-bold text-indigo-700 rounded-lg shadow-xs"
                >
                  Download Sample CSV
                </button>
              </div>

              {/* Upload Drop Zone */}
              <div className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-2xl p-6 text-center transition-all bg-slate-50/50">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="text-3xl mb-2">📁</div>
                <p className="text-sm font-semibold text-slate-700">Choose a CSV file or drag &amp; drop</p>
                <p className="text-xs text-slate-400 mt-1">Supports standard CSV exports from Excel, Google Sheets, or portals</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold"
                >
                  Select CSV File
                </button>
              </div>

              {/* Direct Paste Alternative */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Or Paste CSV / Comma Separated Text:
                </label>
                <textarea
                  rows={4}
                  value={csvText}
                  onChange={e => {
                    setCsvText(e.target.value);
                    parseCSVContent(e.target.value);
                  }}
                  placeholder="Name,Phone,Email,Position&#10;Kamal Hossain,+880 1711223344,kamal@example.com,Senior Engineer"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Error Message */}
              {csvError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
                  ⚠️ {csvError}
                </div>
              )}

              {/* Success Message */}
              {csvSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold">
                  ✓ {csvSuccessMsg}
                </div>
              )}

              {/* Parsed Preview Table */}
              {parsedPreview.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>Parsed Candidates ({parsedPreview.length} found)</span>
                    <span className="text-emerald-600">✓ Ready to import</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left">Name</th>
                          <th className="px-3 py-2 text-left">Phone</th>
                          <th className="px-3 py-2 text-left">Position</th>
                          <th className="px-3 py-2 text-left">Salary</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedPreview.map((c, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-semibold text-slate-800">{c.name}</td>
                            <td className="px-3 py-1.5 font-mono text-indigo-700">{c.phone}</td>
                            <td className="px-3 py-1.5 text-slate-600">{c.jobTitle}</td>
                            <td className="px-3 py-1.5 text-slate-600">৳ {c.expectedSalary?.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowCsvModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={parsedPreview.length === 0}
                onClick={handleImportBatch}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
              >
                Import {parsedPreview.length} Candidates
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ADD SINGLE CANDIDATE MODAL                                       */}
      {/* ========================================================================= */}
      {showAddCandidateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">👤</span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Record Interview Candidate</h3>
                  <p className="text-xs text-slate-500">Collect candidate phone number, name &amp; interview details</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCandidateModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCandidateSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Candidate Full Name *</label>
                  <input
                    type="text"
                    required
                    value={candidateForm.name}
                    onChange={e => setCandidateForm({ ...candidateForm, name: e.target.value })}
                    placeholder="e.g. Mahfuzur Rahman"
                    className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={candidateForm.phone}
                    onChange={e => setCandidateForm({ ...candidateForm, phone: e.target.value })}
                    placeholder="e.g. +880 1712-345678"
                    className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Email Address</label>
                  <input
                    type="email"
                    value={candidateForm.email || ''}
                    onChange={e => setCandidateForm({ ...candidateForm, email: e.target.value })}
                    placeholder="e.g. mahfuz@example.com"
                    className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Target Position / Role *</label>
                  <select
                    value={candidateForm.jobTitle}
                    onChange={e => {
                      const selectedJob = recruitmentJobs.find(j => j.title === e.target.value);
                      setCandidateForm({
                        ...candidateForm,
                        jobTitle: e.target.value,
                        jobId: selectedJob?.id || '',
                        department: selectedJob?.department || candidateForm.department,
                      });
                    }}
                    className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    {recruitmentJobs.map(j => (
                      <option key={j.id} value={j.title}>
                        {j.title} ({j.department})
                      </option>
                    ))}
                    <option value="General Applicant">General Applicant / Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Initial Pipeline Stage</label>
                  <select
                    value={candidateForm.stage}
                    onChange={e => setCandidateForm({ ...candidateForm, stage: e.target.value as CandidateStage })}
                    className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    {STAGES.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Interview Date</label>
                  <input
                    type="date"
                    value={candidateForm.interviewDate || ''}
                    onChange={e => setCandidateForm({ ...candidateForm, interviewDate: e.target.value })}
                    className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Expected Salary (৳)</label>
                  <input
                    type="number"
                    step="1000"
                    value={candidateForm.expectedSalary || ''}
                    onChange={e => setCandidateForm({ ...candidateForm, expectedSalary: Number(e.target.value) })}
                    placeholder="35000"
                    className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Experience / Skills Summary</label>
                <input
                  type="text"
                  value={candidateForm.experience || ''}
                  onChange={e => setCandidateForm({ ...candidateForm, experience: e.target.value })}
                  placeholder="e.g. 3 years in React, Node.js and SQL"
                  className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Interviewer Notes &amp; Observations</label>
                <textarea
                  rows={3}
                  value={candidateForm.notes || ''}
                  onChange={e => setCandidateForm({ ...candidateForm, notes: e.target.value })}
                  placeholder="Notes from initial phone screening or interview impressions..."
                  className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowAddCandidateModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
                >
                  Save Candidate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: HIRE CANDIDATE & AUTO-ONBOARD TO EMPLOYEE MANAGEMENT             */}
      {/* ========================================================================= */}
      {showHireModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center space-x-3 pb-3 border-b border-slate-100">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-2xl flex items-center justify-center text-emerald-600">
                🎉
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Hire Candidate</h3>
                <p className="text-xs text-slate-500">Auto-convert into an active Employee profile</p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                <p className="font-bold text-slate-800">{showHireModal.name}</p>
                <p className="text-xs text-slate-600">Phone: {showHireModal.phone}</p>
                <p className="text-xs text-slate-600">Position: {showHireModal.jobTitle}</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700">Official Gross Salary (BDT) *</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-2 text-sm font-bold text-slate-400">৳</span>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={hireSalary}
                    onChange={e => setHireSalary(Number(e.target.value))}
                    className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-xl font-bold text-slate-800 text-base focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Basic (50%), House Rent (30%), Medical (10%), Transport (10%) will be automatically calculated.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowHireModal(null)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmHire}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
              >
                Confirm Hire &amp; Onboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: EDIT CANDIDATE MODAL                                             */}
      {/* ========================================================================= */}
      {selectedCandidate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Edit Candidate Details</h3>
              <button
                type="button"
                onClick={() => setSelectedCandidate(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Name</label>
                  <input
                    type="text"
                    value={selectedCandidate.name}
                    onChange={e => setSelectedCandidate({ ...selectedCandidate, name: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Phone</label>
                  <input
                    type="tel"
                    value={selectedCandidate.phone}
                    onChange={e => setSelectedCandidate({ ...selectedCandidate, phone: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Pipeline Stage</label>
                  <select
                    value={selectedCandidate.stage}
                    onChange={e => setSelectedCandidate({ ...selectedCandidate, stage: e.target.value as CandidateStage })}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                  >
                    {STAGES.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Interview Date</label>
                  <input
                    type="date"
                    value={selectedCandidate.interviewDate || ''}
                    onChange={e => setSelectedCandidate({ ...selectedCandidate, interviewDate: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Notes &amp; Feedback</label>
                <textarea
                  rows={3}
                  value={selectedCandidate.notes || ''}
                  onChange={e => setSelectedCandidate({ ...selectedCandidate, notes: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setSelectedCandidate(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await updateCandidate(selectedCandidate.id, selectedCandidate);
                    setSelectedCandidate(null);
                  }}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold"
                >
                  Update Candidate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: POST JOB OPENING (ORIGINAL FORM PRESERVED)                       */}
      {/* ========================================================================= */}
      {showJobModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 animate-slide-down">
            <h3 className="text-lg font-bold mb-4">Post New Job Opening</h3>
            <form onSubmit={handleJobSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Job Title *</label>
                <input
                  type="text"
                  required
                  value={jobFormData.title}
                  onChange={e => setJobFormData({ ...jobFormData, title: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Department</label>
                <input
                  type="text"
                  required
                  value={jobFormData.department}
                  onChange={e => setJobFormData({ ...jobFormData, department: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Vacancies</label>
                  <input
                    type="number"
                    min={1}
                    value={jobFormData.vacancies}
                    onChange={e => setJobFormData({ ...jobFormData, vacancies: Number(e.target.value) })}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Employment Type</label>
                  <select
                    value={jobFormData.type}
                    onChange={e => setJobFormData({ ...jobFormData, type: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                  >
                    <option value="Full-time">Full-time</option>
                    <option value="Part-time">Part-time</option>
                    <option value="Contract">Contract</option>
                  </select>
                </div>
              </div>
              <div className="flex space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowJobModal(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold"
                >
                  Post Job
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
