import React, { useState, useMemo } from 'react';
import {
  useData,
  Employee,
  WorkforcePositionPlan,
  EmployeeMovementType,
} from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import {
  generateReportHtml,
  printViaIframe,
  downloadReportHtml,
  copyReportAsTsv,
  PrintReportConfig,
} from '../utils/reportPrinter';

type WorkforceTab =
  | 'org_chart'
  | 'headcount_planning'
  | 'branch_dept_cost'
  | 'movement_history';

type OrgChartMode = 'hierarchy' | 'department' | 'branch';

interface Props {
  mode?: 'admin' | 'manager';
}

export function WorkforcePlanning({ mode = 'admin' }: Props) {
  const {
    employees,
    allEmployees,
    departments,
    branches,
    getEmployeeBranch,
    recruitmentJobs,
    addRecruitmentJob,
    candidates,
    workforcePlans,
    saveWorkforcePlan,
    deleteWorkforcePlan,
    employeeMovements,
    recordEmployeeMovement,
    offboardingRecords,
    currentUser,
    currentEmployee,
    isCurrentUserManager,
    authorizedTeamEmployees,
  } = useData();
  const { currentCompany } = useTenant();

  const isManagerView =
    mode === 'manager' ||
    currentUser?.role === 'Department Supervisor' ||
    Boolean(currentEmployee && isCurrentUserManager);

  const canEditPlans =
    !isManagerView &&
    Boolean(
      currentUser &&
        (currentUser.role === 'Super Admin' ||
          currentUser.role === 'HR Manager' ||
          currentUser.permissions?.workforcePlanning ||
          currentUser.permissions?.employees)
    );

  const canViewSalaryCost = Boolean(
    currentUser &&
      (currentUser.role === 'Super Admin' ||
        currentUser.role === 'HR Manager' ||
        currentUser.role === 'Payroll Admin' ||
        currentUser.permissions?.payroll ||
        currentUser.permissions?.workforcePlanning)
  );

  // Scoped employee list based on RBAC
  const scopedEmployees = useMemo(() => {
    if (isManagerView) {
      return authorizedTeamEmployees.length > 0 ? authorizedTeamEmployees : employees;
    }
    return allEmployees.length > 0 ? allEmployees : employees;
  }, [isManagerView, authorizedTeamEmployees, allEmployees, employees]);

  const [activeTab, setActiveTab] = useState<WorkforceTab>('org_chart');
  const [orgMode, setOrgMode] = useState<OrgChartMode>('hierarchy');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('all');

  // Modals state
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState<{
    title: string;
    department: string;
    branch: string;
    approvedHeadcount: number;
    budgetedAvgSalary: number;
    priority: WorkforcePositionPlan['priority'];
    notes: string;
  }>({
    title: '',
    department: departments[0]?.name || 'Engineering',
    branch: 'All',
    approvedHeadcount: 3,
    budgetedAvgSalary: 45000,
    priority: 'standard',
    notes: '',
  });

  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementForm, setMovementForm] = useState<{
    employeeId: string;
    movementType: EmployeeMovementType;
    effectiveDate: string;
    toDepartment: string;
    toDesignation: string;
    toBranch: string;
    toSalary: number;
    toManagerName: string;
    reason: string;
    applyToEmployeeProfile: boolean;
  }>({
    employeeId: '',
    movementType: 'promotion',
    effectiveDate: new Date().toISOString().split('T')[0],
    toDepartment: '',
    toDesignation: '',
    toBranch: '',
    toSalary: 0,
    toManagerName: '',
    reason: '',
    applyToEmployeeProfile: true,
  });

  const [showPrintModal, setShowPrintModal] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'info' } | null>(null);
  const showToast = (text: string, type: 'success' | 'info' = 'success') => {
    setNotice({ text, type });
    setTimeout(() => setNotice(null), 4000);
  };

  // Authoritative helper to compute an employee's monthly gross salary
  const getEmpGrossSalary = (emp: Partial<Employee>): number => {
    const explicit = Number(emp.grossSalary);
    if (!isNaN(explicit) && explicit > 0) return explicit;
    const compSum =
      (Number(emp.basicSalary ?? emp.basic) || 0) +
      (Number(emp.houseRent) || 0) +
      (Number(emp.medical) || 0) +
      (Number(emp.conveyance ?? emp.transport) || 0) +
      (Number(emp.food) || 0);
    if (compSum > 0) return compSum;
    const b = Number(emp.basicSalary ?? emp.basic) || 0;
    return b > 0 ? b * 2 : 0;
  };

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return scopedEmployees.filter((emp) => {
      if (selectedDept !== 'all' && (emp.department || '').toLowerCase() !== selectedDept.toLowerCase()) {
        return false;
      }
      if (selectedBranch !== 'all' && getEmployeeBranch(emp).toLowerCase() !== selectedBranch.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          (emp.name || '').toLowerCase().includes(q) ||
          (emp.employeeId || '').toLowerCase().includes(q) ||
          (emp.designation || '').toLowerCase().includes(q) ||
          (emp.department || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [scopedEmployees, selectedDept, selectedBranch, searchQuery, getEmployeeBranch]);

  // =========================================================================
  // 1. SYNTHESIZED HEADCOUNT PLANS & VACANCY MATRIX
  // =========================================================================
  const positionMatrix = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        isSavedPlan: boolean;
        title: string;
        department: string;
        branch: string;
        approvedHeadcount: number;
        actualHeadcount: number;
        activeEmployees: Employee[];
        openJobVacancies: number;
        inPipelineCandidates: number;
        budgetedAvgSalary: number;
        actualMonthlyCost: number;
        priority: WorkforcePositionPlan['priority'];
        notes?: string;
      }
    >();

    // First seed from saved workforcePlans
    workforcePlans.forEach((plan) => {
      const key = `${plan.department.toLowerCase()}__${plan.title.toLowerCase()}`;
      map.set(key, {
        id: plan.id,
        isSavedPlan: true,
        title: plan.title,
        department: plan.department,
        branch: plan.branch || 'All',
        approvedHeadcount: plan.approvedHeadcount,
        actualHeadcount: 0,
        activeEmployees: [],
        openJobVacancies: 0,
        inPipelineCandidates: 0,
        budgetedAvgSalary: plan.budgetedAvgSalary,
        actualMonthlyCost: 0,
        priority: plan.priority || 'standard',
        notes: plan.notes,
      });
    });

    // Next, aggregate actual active employees by department + designation
    scopedEmployees
      .filter((e) => e.status !== 'inactive' && !e.accessTerminated)
      .forEach((emp) => {
        const dept = (emp.department || 'General').trim();
        const title = (emp.designation || 'Staff Member').trim();
        const key = `${dept.toLowerCase()}__${title.toLowerCase()}`;
        const empSalary = getEmpGrossSalary(emp);
        const existing = map.get(key);
        if (existing) {
          existing.actualHeadcount += 1;
          existing.activeEmployees.push(emp);
          existing.actualMonthlyCost += empSalary;
          if (!existing.budgetedAvgSalary && empSalary > 0) {
            existing.budgetedAvgSalary = empSalary;
          }
        } else {
          map.set(key, {
            id: `auto_${key}`,
            isSavedPlan: false,
            title,
            department: dept,
            branch: getEmployeeBranch(emp) || 'All',
            approvedHeadcount: 1, // baseline equals current or + open jobs
            actualHeadcount: 1,
            activeEmployees: [emp],
            openJobVacancies: 0,
            inPipelineCandidates: 0,
            budgetedAvgSalary: empSalary || 35000,
            actualMonthlyCost: empSalary,
            priority: 'standard',
          });
        }
      });

    // Next, fold in open RecruitmentJobs and active Candidates
    recruitmentJobs
      .filter((j) => j.status === 'open')
      .forEach((job) => {
        const dept = (job.department || 'General').trim();
        const title = (job.title || 'Open Position').trim();
        const key = `${dept.toLowerCase()}__${title.toLowerCase()}`;
        const jobCands = candidates.filter(
          (c) =>
            (c.jobId === job.id || c.jobTitle.toLowerCase() === title.toLowerCase()) &&
            c.stage !== 'rejected' &&
            c.stage !== 'hired'
        ).length;
        const existing = map.get(key);
        if (existing) {
          existing.openJobVacancies += Number(job.vacancies) || 1;
          existing.inPipelineCandidates += jobCands;
          if (!existing.isSavedPlan) {
            existing.approvedHeadcount = existing.actualHeadcount + existing.openJobVacancies;
          }
        } else {
          map.set(key, {
            id: `job_${job.id}`,
            isSavedPlan: false,
            title,
            department: dept,
            branch: 'All',
            approvedHeadcount: Number(job.vacancies) || 1,
            actualHeadcount: 0,
            activeEmployees: [],
            openJobVacancies: Number(job.vacancies) || 1,
            inPipelineCandidates: jobCands,
            budgetedAvgSalary: 40000,
            actualMonthlyCost: 0,
            priority: 'high',
            notes: `Linked to open recruitment job (${job.experience})`,
          });
        }
      });

    return Array.from(map.values())
      .map((item) => {
        const approved = Math.max(item.approvedHeadcount, item.isSavedPlan ? item.approvedHeadcount : item.actualHeadcount + item.openJobVacancies);
        const vacancyGap = Math.max(0, approved - item.actualHeadcount);
        const budgetedMonthlyCost = approved * (item.budgetedAvgSalary || 0);
        return {
          ...item,
          approvedHeadcount: approved,
          vacancyGap,
          budgetedMonthlyCost,
          fillRatePct: approved > 0 ? Math.min(100, Math.round((item.actualHeadcount / approved) * 100)) : 100,
        };
      })
      .filter((row) => {
        if (selectedDept !== 'all' && row.department.toLowerCase() !== selectedDept.toLowerCase()) return false;
        if (selectedBranch !== 'all' && row.branch !== 'All' && row.branch.toLowerCase() !== selectedBranch.toLowerCase()) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return row.title.toLowerCase().includes(q) || row.department.toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => b.vacancyGap - a.vacancyGap || b.actualHeadcount - a.actualHeadcount);
  }, [workforcePlans, scopedEmployees, recruitmentJobs, candidates, selectedDept, selectedBranch, searchQuery, getEmployeeBranch]);

  // Summary KPIs
  const summaryStats = useMemo(() => {
    const activeEmps = filteredEmployees.filter((e) => e.status !== 'inactive' && !e.accessTerminated);
    const totalActual = activeEmps.length;
    const totalApproved = positionMatrix.reduce((s, r) => s + r.approvedHeadcount, 0);
    const totalVacancies = positionMatrix.reduce((s, r) => s + r.vacancyGap, 0);
    const totalActualMonthlyCost = activeEmps.reduce((s, e) => s + getEmpGrossSalary(e), 0);
    const totalBudgetedMonthlyCost = positionMatrix.reduce((s, r) => s + r.budgetedMonthlyCost, 0);
    const avgCostPerEmployee = totalActual > 0 ? Math.round(totalActualMonthlyCost / totalActual) : 0;
    const uniquePositions = positionMatrix.length;
    return {
      totalActual,
      totalApproved: Math.max(totalApproved, totalActual),
      totalVacancies,
      totalActualMonthlyCost,
      totalBudgetedMonthlyCost,
      avgCostPerEmployee,
      uniquePositions,
    };
  }, [filteredEmployees, positionMatrix]);

  // =========================================================================
  // 2. ORGANIZATION CHART HIERARCHY BUILDER
  // =========================================================================
  const orgHierarchy = useMemo(() => {
    const activeEmps = filteredEmployees.filter((e) => e.status !== 'inactive' && !e.accessTerminated);

    // Build manager -> direct reports mapping
    const byId = new Map<string, Employee>();
    activeEmps.forEach((e) => {
      byId.set(e.id.toLowerCase(), e);
      if (e.employeeId) byId.set(e.employeeId.toLowerCase(), e);
    });

    const directReportsMap = new Map<string, Employee[]>();
    const topLeaders: Employee[] = [];

    activeEmps.forEach((emp) => {
      let mgr: Employee | undefined;
      if (emp.managerId) {
        mgr = byId.get(emp.managerId.toLowerCase());
      }
      if (!mgr && emp.managerName) {
        mgr = activeEmps.find((m) => m.id !== emp.id && m.name.toLowerCase() === emp.managerName!.toLowerCase());
      }
      // Also check Department Head if employee is not the department head themselves
      if (!mgr) {
        const deptObj = departments.find((d) => d.name.toLowerCase() === (emp.department || '').toLowerCase());
        if (deptObj?.head) {
          const headEmp = activeEmps.find(
            (m) => m.id !== emp.id && m.name.toLowerCase() === deptObj.head.trim().toLowerCase()
          );
          if (headEmp) mgr = headEmp;
        }
      }

      if (mgr && mgr.id !== emp.id) {
        const list = directReportsMap.get(mgr.id) || [];
        list.push(emp);
        directReportsMap.set(mgr.id, list);
      } else {
        topLeaders.push(emp);
      }
    });

    // Sort leaders so explicit managers or those with direct reports appear first
    topLeaders.sort((a, b) => {
      const aReports = (directReportsMap.get(a.id) || []).length;
      const bReports = (directReportsMap.get(b.id) || []).length;
      if (bReports !== aReports) return bReports - aReports;
      if (Boolean(b.isManager) !== Boolean(a.isManager)) return b.isManager ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return { topLeaders, directReportsMap };
  }, [filteredEmployees, departments]);

  // =========================================================================
  // 3. BRANCH & DEPARTMENT WORKFORCE COST BREAKDOWN
  // =========================================================================
  const departmentBreakdown = useMemo(() => {
    const deptNames = Array.from(
      new Set([
        ...departments.map((d) => d.name),
        ...scopedEmployees.map((e) => e.department || 'General'),
      ])
    ).filter(Boolean);

    return deptNames
      .map((dName) => {
        const deptObj = departments.find((d) => d.name.toLowerCase() === dName.toLowerCase());
        const emps = scopedEmployees.filter(
          (e) => (e.department || 'General').toLowerCase() === dName.toLowerCase() && e.status !== 'inactive'
        );
        const plans = positionMatrix.filter((p) => p.department.toLowerCase() === dName.toLowerCase());
        const approved = Math.max(
          emps.length,
          plans.reduce((s, p) => s + p.approvedHeadcount, 0)
        );
        const vacancies = Math.max(0, approved - emps.length);
        const monthlyCost = emps.reduce((s, e) => s + getEmpGrossSalary(e), 0);
        const avgSalary = emps.length > 0 ? Math.round(monthlyCost / emps.length) : 0;

        return {
          name: dName,
          code: deptObj?.code || dName.slice(0, 4).toUpperCase(),
          head: deptObj?.head || emps.find((e) => e.isManager)?.name || 'Unassigned',
          actual: emps.length,
          approved,
          vacancies,
          monthlyCost,
          annualCost: monthlyCost * 12,
          avgSalary,
        };
      })
      .sort((a, b) => b.monthlyCost - a.monthlyCost || b.actual - a.actual);
  }, [departments, scopedEmployees, positionMatrix]);

  const branchBreakdown = useMemo(() => {
    const branchNames = Array.from(
      new Set([
        ...branches.map((b) => b.name),
        ...scopedEmployees.map((e) => getEmployeeBranch(e)),
      ])
    ).filter(Boolean);

    return branchNames
      .map((bName) => {
        const bObj = branches.find((b) => b.name.toLowerCase() === bName.toLowerCase());
        const emps = scopedEmployees.filter(
          (e) => getEmployeeBranch(e).toLowerCase() === bName.toLowerCase() && e.status !== 'inactive'
        );
        const monthlyCost = emps.reduce((s, e) => s + getEmpGrossSalary(e), 0);
        const deptsCount = new Set(emps.map((e) => e.department)).size;
        return {
          name: bName,
          code: bObj?.code || 'BR',
          type: bObj?.type || 'branch',
          city: bObj?.city || 'Dhaka',
          manager: bObj?.managerName || 'Branch Manager',
          actual: emps.length,
          deptsCount,
          monthlyCost,
          annualCost: monthlyCost * 12,
          sharePct:
            summaryStats.totalActual > 0
              ? Math.round((emps.length / summaryStats.totalActual) * 100)
              : 0,
        };
      })
      .sort((a, b) => b.actual - a.actual);
  }, [branches, scopedEmployees, getEmployeeBranch, summaryStats.totalActual]);

  // =========================================================================
  // 4. COMBINED EMPLOYEE MOVEMENT HISTORY LEDGER
  // =========================================================================
  const combinedMovements = useMemo(() => {
    const list = [...employeeMovements];

    // Also include historical shift changes and offboarding exits if not already in employeeMovements
    scopedEmployees.forEach((emp) => {
      if (emp.joinDate) {
        const hasHireLog = list.some(
          (m) => (m.employeeId === emp.id || m.employeeCode === emp.employeeId) && m.movementType === 'new_hire'
        );
        if (!hasHireLog) {
          list.push({
            id: `join_${emp.id}`,
            employeeId: emp.id,
            employeeCode: emp.employeeId || emp.id,
            employeeName: emp.name,
            movementType: 'new_hire',
            effectiveDate: emp.joinDate,
            toDepartment: emp.department,
            toDesignation: emp.designation,
            toBranch: getEmployeeBranch(emp),
            toSalary: getEmpGrossSalary(emp),
            reason: 'Initial Joining / Onboarding',
            recordedBy: 'HR System',
            createdAt: emp.joinDate,
            companyId: emp.companyId || 'default',
          });
        }
      }
    });

    offboardingRecords.forEach((off) => {
      const hasExitLog = list.some(
        (m) => (m.employeeId === off.employeeId || m.employeeCode === off.employeeCode) && m.movementType === 'exit'
      );
      if (!hasExitLog) {
        list.push({
          id: `exit_${off.id}`,
          employeeId: off.employeeId,
          employeeCode: off.employeeCode,
          employeeName: off.employeeName,
          movementType: 'exit',
          effectiveDate: off.lastWorkingDay || off.initiatedDate,
          fromDepartment: off.department,
          fromDesignation: off.designation,
          fromBranch: off.branch || 'Head Office',
          reason: `${off.exitType.toUpperCase()}: ${off.reason}`,
          recordedBy: off.initiatedBy,
          createdAt: off.createdAt,
          companyId: off.companyId,
        });
      }
    });

    return list
      .filter((m) => {
        if (movementTypeFilter !== 'all' && m.movementType !== movementTypeFilter) return false;
        if (selectedDept !== 'all') {
          const matchDept =
            (m.toDepartment || '').toLowerCase() === selectedDept.toLowerCase() ||
            (m.fromDepartment || '').toLowerCase() === selectedDept.toLowerCase();
          if (!matchDept) return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            m.employeeName.toLowerCase().includes(q) ||
            m.employeeCode.toLowerCase().includes(q) ||
            (m.toDesignation || '').toLowerCase().includes(q) ||
            (m.reason || '').toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => String(b.effectiveDate || b.createdAt).localeCompare(String(a.effectiveDate || a.createdAt)));
  }, [employeeMovements, scopedEmployees, offboardingRecords, movementTypeFilter, selectedDept, searchQuery, getEmployeeBranch]);

  // Handlers
  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planForm.title.trim()) return;
    await saveWorkforcePlan({
      ...(editingPlanId && !editingPlanId.startsWith('auto_') && !editingPlanId.startsWith('job_')
        ? { id: editingPlanId }
        : {}),
      title: planForm.title,
      department: planForm.department,
      branch: planForm.branch,
      approvedHeadcount: Number(planForm.approvedHeadcount) || 1,
      budgetedAvgSalary: Number(planForm.budgetedAvgSalary) || 0,
      priority: planForm.priority,
      notes: planForm.notes,
    });
    setShowPlanModal(false);
    setEditingPlanId(null);
    showToast(`Saved headcount plan for ${planForm.title}`);
  };

  const handleOpenMovementModalForEmp = (emp?: Employee) => {
    const target = emp || scopedEmployees[0];
    if (!target) return;
    setMovementForm({
      employeeId: target.id,
      movementType: 'promotion',
      effectiveDate: new Date().toISOString().split('T')[0],
      toDepartment: target.department || '',
      toDesignation: target.designation || '',
      toBranch: getEmployeeBranch(target),
      toSalary: getEmpGrossSalary(target),
      toManagerName: target.managerName || '',
      reason: '',
      applyToEmployeeProfile: true,
    });
    setShowMovementModal(true);
  };

  const handleSaveMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmp = scopedEmployees.find(
      (emp) => emp.id === movementForm.employeeId || emp.employeeId === movementForm.employeeId
    );
    if (!targetEmp) return;

    await recordEmployeeMovement({
      employeeId: targetEmp.id,
      employeeCode: targetEmp.employeeId || targetEmp.id,
      employeeName: targetEmp.name,
      movementType: movementForm.movementType,
      effectiveDate: movementForm.effectiveDate,
      fromDepartment: targetEmp.department,
      toDepartment: movementForm.toDepartment || targetEmp.department,
      fromDesignation: targetEmp.designation,
      toDesignation: movementForm.toDesignation || targetEmp.designation,
      fromBranch: getEmployeeBranch(targetEmp),
      toBranch: movementForm.toBranch || getEmployeeBranch(targetEmp),
      fromSalary: getEmpGrossSalary(targetEmp),
      toSalary: Number(movementForm.toSalary) || getEmpGrossSalary(targetEmp),
      fromManagerName: targetEmp.managerName || '—',
      toManagerName: movementForm.toManagerName || targetEmp.managerName || '—',
      reason: movementForm.reason || 'Official HR Workforce Movement Order',
      applyToEmployeeProfile: movementForm.applyToEmployeeProfile,
    });

    setShowMovementModal(false);
    showToast(`Recorded ${movementForm.movementType.replace(/_/g, ' ')} for ${targetEmp.name}`);
  };

  const workforceReportConfig = useMemo<PrintReportConfig>(() => {
    const baseFilters = [
      { label: 'View Mode', value: activeTab === 'org_chart' ? 'Organization Hierarchy & Directory' : activeTab === 'branch_dept_cost' ? 'Branch & Department Cost' : activeTab === 'movement_history' ? 'Employee Movement History' : 'Headcount & Vacancy Plan' },
      { label: 'Department', value: selectedDept === 'all' ? 'All Departments' : selectedDept },
      { label: 'Branch', value: selectedBranch === 'all' ? 'All Branches' : selectedBranch },
    ];

    const baseMetrics = [
      { label: 'Approved Headcount', value: summaryStats.totalApproved, highlight: true },
      { label: 'Actual Active Staff', value: summaryStats.totalActual, highlight: true },
      { label: 'Open Vacancies', value: summaryStats.totalVacancies },
      { label: 'Branches / Depts', value: `${branchBreakdown.length} / ${departmentBreakdown.length}` },
      ...(canViewSalaryCost
        ? [
            { label: 'Actual Monthly Cost', value: `৳${summaryStats.totalActualMonthlyCost.toLocaleString()}`, highlight: true },
            { label: 'Budgeted Monthly Cost', value: `৳${summaryStats.totalBudgetedMonthlyCost.toLocaleString()}` },
          ]
        : []),
    ];

    if (activeTab === 'branch_dept_cost') {
      return {
        title: 'Branch & Department Workforce Cost & Headcount Report',
        subtitle: `${currentCompany?.name || 'WorkNest Enterprise'} • Departmental Headcount, Vacancies & Payroll Cost Breakdown`,
        period: `As of ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        orientation: 'landscape',
        filters: baseFilters,
        metrics: baseMetrics,
        headers: [
          'Department',
          'Code',
          'Department Head',
          'Approved Seats',
          'Active Staff',
          'Open Vacancies',
          ...(canViewSalaryCost ? ['Avg Salary (৳)', 'Monthly Cost (৳)', 'Annualized Cost (৳)'] : []),
        ],
        rows: departmentBreakdown.map((d) => [
          d.name,
          d.code,
          d.head,
          d.approved,
          d.actual,
          d.vacancies,
          ...(canViewSalaryCost
            ? [
                `৳${d.avgSalary.toLocaleString()}`,
                `৳${d.monthlyCost.toLocaleString()}`,
                `৳${d.annualCost.toLocaleString()}`,
              ]
            : []),
        ]),
      };
    }

    if (activeTab === 'movement_history') {
      return {
        title: 'Employee Movement, Promotion & Transfer Ledger',
        subtitle: `${currentCompany?.name || 'WorkNest Enterprise'} • Official History of Promotions, Transfers, Joins & Exits`,
        period: `As of ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        orientation: 'landscape',
        filters: baseFilters,
        metrics: baseMetrics,
        headers: [
          'Effective Date',
          'Employee Name',
          'Employee ID',
          'Movement Type',
          'From Dept / Role',
          'To Dept / Role',
          'Branch',
          'Reason / Order Note',
        ],
        rows: combinedMovements.map((m) => [
          m.effectiveDate || '—',
          m.employeeName,
          m.employeeCode,
          m.movementType.replace(/_/g, ' ').toUpperCase(),
          `${m.fromDepartment || '—'} (${m.fromDesignation || '—'})`,
          `${m.toDepartment || m.fromDepartment || '—'} (${m.toDesignation || m.fromDesignation || '—'})`,
          m.toBranch || m.fromBranch || 'Head Office',
          m.reason || 'Official HR Movement',
        ]),
      };
    }

    return {
      title: 'Workforce Planning, Headcount & Organizational Cost Report',
      subtitle: `${currentCompany?.name || 'WorkNest Enterprise'} • Approved vs Actual Headcount, Vacancy Tracking & Branch Cost`,
      period: `As of ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      orientation: 'landscape',
      filters: baseFilters,
      metrics: baseMetrics,
      headers: [
        'Position / Designation',
        'Department',
        'Branch',
        'Priority',
        'Approved Seats',
        'Actual Staff',
        'Vacancy Gap',
        'Fill Rate',
        ...(canViewSalaryCost ? ['Actual Monthly Cost (৳)', 'Budgeted Cost (৳)'] : []),
      ],
      rows: positionMatrix.map((r) => [
        r.title,
        r.department,
        r.branch,
        r.priority.toUpperCase(),
        r.approvedHeadcount,
        r.actualHeadcount,
        r.vacancyGap,
        `${r.fillRatePct}%`,
        ...(canViewSalaryCost
          ? [`৳${r.actualMonthlyCost.toLocaleString()}`, `৳${r.budgetedMonthlyCost.toLocaleString()}`]
          : []),
      ]),
    };
  }, [
    activeTab,
    selectedDept,
    selectedBranch,
    summaryStats,
    branchBreakdown.length,
    departmentBreakdown,
    combinedMovements,
    positionMatrix,
    canViewSalaryCost,
    currentCompany?.name,
  ]);

  const handlePrintWorkforceReport = () => {
    setShowPrintModal(true);
  };

  const handleExecutePrint = async () => {
    setIsPrinting(true);
    try {
      const html = generateReportHtml(workforceReportConfig);
      await printViaIframe(html);
      showToast('Print dialog prepared. Select your printer or "Save as PDF".');
    } finally {
      setTimeout(() => setIsPrinting(false), 400);
    }
  };

  const handleExportCsv = () => {
    const headers = workforceReportConfig.headers;
    const rows = workforceReportConfig.rows;
    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Workforce_Planning_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length} workforce records to CSV.`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-lg shadow-sm">
              🏛️
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Workforce Planning &amp; Organization Architecture
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Interactive Org Chart, Approved vs Actual Headcount, Vacancy Tracking, Branch Workforce Cost &amp; Movement Ledger
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handlePrintWorkforceReport}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
          >
            <span>🖨️</span>
            <span>Print Workforce Report</span>
          </button>
          <button
            onClick={handleExportCsv}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center space-x-1.5 cursor-pointer"
          >
            <span>📥</span>
            <span>Export CSV</span>
          </button>
          {canEditPlans && (
            <>
              <button
                onClick={() => handleOpenMovementModalForEmp()}
                className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                <span>🔄</span>
                <span>Record Transfer / Promotion</span>
              </button>
              <button
                onClick={() => {
                  setEditingPlanId(null);
                  setPlanForm({
                    title: '',
                    department: departments[0]?.name || 'Engineering',
                    branch: 'All',
                    approvedHeadcount: 3,
                    budgetedAvgSalary: 45000,
                    priority: 'standard',
                    notes: '',
                  });
                  setShowPlanModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                <span>➕</span>
                <span>Add Position Plan</span>
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="px-4 py-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-between">
          <span>✅ {notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-700 hover:text-emerald-950 font-black">
            ✕
          </button>
        </div>
      )}

      {/* Executive KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Approved Headcount
          </span>
          <span className="text-2xl font-black text-slate-900 mt-1 block">
            {summaryStats.totalApproved}
          </span>
          <span className="text-[11px] text-slate-500">Across {summaryStats.uniquePositions} positions</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
            Actual Active Staff
          </span>
          <span className="text-2xl font-black text-emerald-600 mt-1 block">
            {summaryStats.totalActual}
          </span>
          <span className="text-[11px] text-emerald-700 font-semibold">
            {summaryStats.totalApproved > 0
              ? `${Math.round((summaryStats.totalActual / summaryStats.totalApproved) * 100)}% Seat Fill Rate`
              : '100% Filled'}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
            Open Vacancies
          </span>
          <span className="text-2xl font-black text-amber-600 mt-1 block">
            {summaryStats.totalVacancies}
          </span>
          <span className="text-[11px] text-slate-500">Approved minus actual</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
            Branches &amp; Units
          </span>
          <span className="text-2xl font-black text-indigo-700 mt-1 block">
            {branchBreakdown.length} / {departmentBreakdown.length}
          </span>
          <span className="text-[11px] text-slate-500">Branches / Departments</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider block">
            Monthly Workforce Cost
          </span>
          <span className="text-xl font-black text-violet-700 mt-1 block font-mono">
            {canViewSalaryCost ? `৳${summaryStats.totalActualMonthlyCost.toLocaleString()}` : 'Restricted'}
          </span>
          <span className="text-[11px] text-slate-500">
            {canViewSalaryCost ? `Avg ৳${summaryStats.avgCostPerEmployee.toLocaleString()}/emp` : 'Payroll Admin Only'}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-teal-600 uppercase tracking-wider block">
            Staff Movements
          </span>
          <span className="text-2xl font-black text-teal-700 mt-1 block">
            {combinedMovements.length}
          </span>
          <span className="text-[11px] text-slate-500">Promotions, transfers &amp; joins</span>
        </div>
      </div>

      {/* Navigation Tabs + Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'org_chart', label: 'Organization Chart', icon: '🌳' },
            { id: 'headcount_planning', label: 'Headcount & Vacancies', icon: '🎯' },
            { id: 'branch_dept_cost', label: 'Branch & Dept Workforce Cost', icon: '🏢' },
            { id: 'movement_history', label: 'Employee Movement History', icon: '🔄' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as WorkforceTab)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                activeTab === t.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
          >
            <option value="all">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
          >
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search position, staff, ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 w-48"
          />
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: ORGANIZATION CHART                                                 */}
      {/* ========================================================================= */}
      {activeTab === 'org_chart' && (
        <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/80 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Interactive Organization Chart &amp; Reporting Structure
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Live reporting chains across {currentCompany?.name || 'WorkNest HR'} ({filteredEmployees.length} personnel)
              </p>
            </div>
            <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-xl">
              {[
                { id: 'hierarchy', label: 'Reporting Hierarchy' },
                { id: 'department', label: 'By Department' },
                { id: 'branch', label: 'By Branch / Office' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setOrgMode(m.id as OrgChartMode)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    orgMode === m.id ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {filteredEmployees.length === 0 ? (
            <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <p className="text-sm font-bold text-slate-700">No employees match the selected filters</p>
              <p className="text-xs text-slate-400 mt-1">Clear filters or add employees to visualize the organization chart.</p>
            </div>
          ) : orgMode === 'hierarchy' ? (
            <div className="space-y-6">
              {/* Top Executive Root Banner */}
              <div className="flex justify-center">
                <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-4 rounded-2xl shadow-md text-center max-w-md w-full border border-indigo-500/30">
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300 block">
                    Corporate Executive Board
                  </span>
                  <h4 className="text-base font-black mt-0.5">
                    {currentCompany?.name || 'WorkNest Enterprise HQ'}
                  </h4>
                  <p className="text-[11px] text-slate-300 mt-1">
                    {summaryStats.totalActual} Active Personnel • {departmentBreakdown.length} Departments • {branchBreakdown.length} Locations
                  </p>
                </div>
              </div>

              {/* Reporting Chains */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {orgHierarchy.topLeaders.map((leader) => {
                  const reports = orgHierarchy.directReportsMap.get(leader.id) || [];
                  return (
                    <div
                      key={leader.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3 flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        {/* Leader Card */}
                        <div className="bg-white p-3.5 rounded-xl border border-indigo-200/80 shadow-2xs flex items-start justify-between gap-2">
                          <div className="flex items-center space-x-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white font-black text-sm flex items-center justify-center shrink-0">
                              {leader.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-xs font-black text-slate-900 truncate">{leader.name}</p>
                                {(leader.isManager || reports.length > 0) && (
                                  <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[9px] font-black uppercase">
                                    Manager ({reports.length})
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] font-semibold text-indigo-700 truncate">
                                {leader.designation || 'Staff'}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate">
                                {leader.department} • {getEmployeeBranch(leader)} ({leader.employeeId})
                              </p>
                            </div>
                          </div>
                          {canEditPlans && (
                            <button
                              onClick={() => handleOpenMovementModalForEmp(leader)}
                              title="Promote / Transfer / Reassign"
                              className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 text-[10px] font-bold shrink-0 cursor-pointer"
                            >
                              Move
                            </button>
                          )}
                        </div>

                        {/* Direct Reports Tree */}
                        {reports.length > 0 && (
                          <div className="pl-4 border-l-2 border-indigo-200 space-y-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                              Direct Reports ({reports.length})
                            </span>
                            {reports.map((rep) => (
                              <div
                                key={rep.id}
                                className="bg-white p-2.5 rounded-xl border border-slate-200/90 flex items-center justify-between gap-2 hover:border-indigo-300 transition-colors"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-800 truncate">{rep.name}</p>
                                  <p className="text-[10px] text-slate-500 truncate">
                                    {rep.designation} • <span className="font-mono">{rep.employeeId}</span>
                                  </p>
                                </div>
                                {canEditPlans && (
                                  <button
                                    onClick={() => handleOpenMovementModalForEmp(rep)}
                                    className="px-2 py-1 rounded-lg bg-slate-50 hover:bg-indigo-50 text-[10px] font-semibold text-indigo-600 cursor-pointer shrink-0"
                                  >
                                    Move
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : orgMode === 'department' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {departmentBreakdown.map((dept) => {
                const deptEmps = filteredEmployees.filter(
                  (e) => (e.department || 'General').toLowerCase() === dept.name.toLowerCase()
                );
                return (
                  <div key={dept.name} className="rounded-2xl border border-slate-200 p-4 bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                      <div>
                        <span className="text-[10px] font-mono font-bold text-indigo-600 uppercase">{dept.code}</span>
                        <h4 className="text-sm font-black text-slate-900">{dept.name}</h4>
                        <p className="text-[11px] text-slate-500">Head: {dept.head}</p>
                      </div>
                      <div className="text-right">
                        <span className="px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-800 text-xs font-black">
                          {dept.actual} / {dept.approved} Staff
                        </span>
                        {dept.vacancies > 0 && (
                          <span className="block text-[10px] font-bold text-amber-600 mt-1">
                            {dept.vacancies} Open Vacancies
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                      {deptEmps.map((emp) => (
                        <div
                          key={emp.id}
                          className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 truncate">{emp.name}</p>
                            <p className="text-[10px] text-indigo-700 font-semibold truncate">{emp.designation}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{emp.employeeId}</p>
                          </div>
                          {canEditPlans && (
                            <button
                              onClick={() => handleOpenMovementModalForEmp(emp)}
                              className="text-[10px] font-bold text-slate-500 hover:text-indigo-600 px-1.5 py-1 rounded bg-slate-50 cursor-pointer"
                            >
                              ⇄
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {branchBreakdown.map((br) => {
                const brEmps = filteredEmployees.filter(
                  (e) => getEmployeeBranch(e).toLowerCase() === br.name.toLowerCase()
                );
                return (
                  <div key={br.name} className="rounded-2xl border border-slate-200 p-4 bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                      <div>
                        <span className="text-[10px] font-mono font-bold text-teal-600 uppercase">
                          {br.code} • {br.city}
                        </span>
                        <h4 className="text-sm font-black text-slate-900">{br.name}</h4>
                        <p className="text-[11px] text-slate-500">Manager: {br.manager}</p>
                      </div>
                      <div className="text-right">
                        <span className="px-2.5 py-1 rounded-full bg-teal-100 text-teal-800 text-xs font-black">
                          {br.actual} Staff ({br.sharePct}%)
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                      {brEmps.map((emp) => (
                        <div
                          key={emp.id}
                          className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 truncate">{emp.name}</p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {emp.designation} • {emp.department}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: HEADCOUNT PLANNING & VACANCY TRACKING                              */}
      {/* ========================================================================= */}
      {activeTab === 'headcount_planning' && (
        <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Position &amp; Designation Headcount Matrix (Approved vs Actual)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Track approved seat quotas, live active headcount, open vacancies, candidate pipeline, and position cost
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {positionMatrix.length} Positions Tracked
            </span>
          </div>

          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
                  <th className="pb-3">Position / Designation</th>
                  <th className="pb-3">Department &amp; Branch</th>
                  <th className="pb-3">Priority</th>
                  <th className="pb-3 text-center">Approved</th>
                  <th className="pb-3 text-center">Actual</th>
                  <th className="pb-3 text-center">Vacancy Gap</th>
                  <th className="pb-3">Fill Progress</th>
                  {canViewSalaryCost && <th className="pb-3 text-right">Actual vs Budget Cost</th>}
                  {canEditPlans && <th className="pb-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {positionMatrix.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 pr-3">
                      <div className="font-bold text-slate-900">{row.title}</div>
                      {row.inPipelineCandidates > 0 && (
                        <span className="text-[10px] font-semibold text-indigo-600">
                          🎯 {row.inPipelineCandidates} candidates in pipeline
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 pr-3">
                      <div className="font-semibold text-slate-700">{row.department}</div>
                      <span className="text-[10px] text-slate-400">{row.branch}</span>
                    </td>
                    <td className="py-3.5 pr-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          row.priority === 'critical'
                            ? 'bg-rose-100 text-rose-800'
                            : row.priority === 'high'
                            ? 'bg-amber-100 text-amber-800'
                            : row.priority === 'growth'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {row.priority}
                      </span>
                    </td>
                    <td className="py-3.5 text-center font-mono font-black text-slate-900">
                      {row.approvedHeadcount}
                    </td>
                    <td className="py-3.5 text-center font-mono font-black text-emerald-700">
                      {row.actualHeadcount}
                    </td>
                    <td className="py-3.5 text-center">
                      {row.vacancyGap > 0 ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-mono font-black text-[11px]">
                          {row.vacancyGap} Open
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                          Filled
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 pr-3 w-36">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              row.fillRatePct >= 100
                                ? 'bg-emerald-500'
                                : row.fillRatePct >= 60
                                ? 'bg-indigo-500'
                                : 'bg-amber-500'
                            }`}
                            style={{ width: `${row.fillRatePct}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono font-bold text-slate-600">{row.fillRatePct}%</span>
                      </div>
                    </td>
                    {canViewSalaryCost && (
                      <td className="py-3.5 text-right font-mono">
                        <div className="font-bold text-slate-900">৳{row.actualMonthlyCost.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-400">
                          Budget: ৳{row.budgetedMonthlyCost.toLocaleString()}
                        </div>
                      </td>
                    )}
                    {canEditPlans && (
                      <td className="py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center space-x-1.5">
                          <button
                            onClick={() => {
                              setEditingPlanId(row.id);
                              setPlanForm({
                                title: row.title,
                                department: row.department,
                                branch: row.branch,
                                approvedHeadcount: row.approvedHeadcount,
                                budgetedAvgSalary:
                                  row.budgetedAvgSalary ||
                                  (row.actualHeadcount > 0
                                    ? Math.round(row.actualMonthlyCost / row.actualHeadcount)
                                    : 40000),
                                priority: row.priority,
                                notes: row.notes || '',
                              });
                              setShowPlanModal(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 font-bold text-[11px] cursor-pointer"
                          >
                            Edit Plan
                          </button>
                          {row.vacancyGap > 0 && row.openJobVacancies === 0 && (
                            <button
                              onClick={() => {
                                addRecruitmentJob({
                                  title: row.title,
                                  department: row.department,
                                  vacancies: row.vacancyGap,
                                  type: 'Full-time',
                                  experience: '2-4 years',
                                  status: 'open',
                                  postedDate: new Date().toISOString().split('T')[0],
                                  applicantsCount: 0,
                                });
                                showToast(`Opened recruitment requisition for ${row.title} (${row.vacancyGap} seats)`);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-[11px] cursor-pointer border border-amber-200"
                            >
                              + Post Job
                            </button>
                          )}
                          {row.isSavedPlan && (
                            <button
                              onClick={() => deleteWorkforcePlan(row.id)}
                              className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[11px] cursor-pointer"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: BRANCH & DEPARTMENT WORKFORCE COST                                 */}
      {/* ========================================================================= */}
      {activeTab === 'branch_dept_cost' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Branch-wise Workforce & Cost */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Branch &amp; Location Workforce Distribution
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Head Office &amp; Branch-wise headcount, active departments, and monthly payroll commitment
              </p>
            </div>
            <div className="space-y-3">
              {branchBreakdown.map((br) => (
                <div key={br.name} className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-indigo-600 uppercase">
                        {br.code} • {br.city}
                      </span>
                      <h4 className="text-sm font-black text-slate-900">{br.name}</h4>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-800 text-xs font-black">
                      {br.actual} Staff ({br.sharePct}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
                    <span>Active Departments: <strong>{br.deptsCount}</strong></span>
                    {canViewSalaryCost && (
                      <span className="font-mono font-bold text-slate-900">
                        Monthly Cost: ৳{br.monthlyCost.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Department-wise Headcount & Cost */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Department Workforce Cost &amp; Seat Utilization
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Approved vs actual headcount and annualized compensation projection by department
              </p>
            </div>
            <div className="space-y-3">
              {departmentBreakdown.map((d) => (
                <div key={d.name} className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-violet-600 uppercase">{d.code}</span>
                      <h4 className="text-sm font-black text-slate-900">{d.name}</h4>
                      <p className="text-[11px] text-slate-500">Head: {d.head}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black text-slate-900">
                        {d.actual} / {d.approved} Seats
                      </span>
                      {d.vacancies > 0 && (
                        <span className="block text-[10px] font-bold text-amber-600">
                          {d.vacancies} Vacancies
                        </span>
                      )}
                    </div>
                  </div>
                  {canViewSalaryCost && (
                    <div className="flex items-center justify-between text-xs text-slate-600 pt-1 border-t border-slate-200/60">
                      <span>
                        Monthly: <strong className="font-mono text-slate-900">৳{d.monthlyCost.toLocaleString()}</strong>
                      </span>
                      <span>
                        Avg/Staff: <strong className="font-mono">৳{d.avgSalary.toLocaleString()}</strong>
                      </span>
                      <span>
                        Annual: <strong className="font-mono text-indigo-700">৳{d.annualCost.toLocaleString()}</strong>
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: EMPLOYEE MOVEMENT HISTORY                                          */}
      {/* ========================================================================= */}
      {activeTab === 'movement_history' && (
        <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Employee Movement, Promotion &amp; Transfer History
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Audit trail of promotions, inter-department/branch transfers, salary revisions, joins, and exits
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={movementTypeFilter}
                onChange={(e) => setMovementTypeFilter(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
              >
                <option value="all">All Movement Types</option>
                <option value="promotion">Promotions</option>
                <option value="department_transfer">Department Transfers</option>
                <option value="branch_transfer">Branch Transfers</option>
                <option value="designation_change">Designation Changes</option>
                <option value="salary_revision">Salary Revisions</option>
                <option value="new_hire">New Hires / Joins</option>
                <option value="exit">Exits / Offboarding</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
                  <th className="pb-3">Effective Date</th>
                  <th className="pb-3">Employee</th>
                  <th className="pb-3">Movement Type</th>
                  <th className="pb-3">Department / Branch Transition</th>
                  <th className="pb-3">Designation Transition</th>
                  {canViewSalaryCost && <th className="pb-3">Salary Revision</th>}
                  <th className="pb-3">Reason / Order Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {combinedMovements.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <td className="py-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                      {m.effectiveDate}
                    </td>
                    <td className="py-3">
                      <div className="font-bold text-slate-900">{m.employeeName}</div>
                      <span className="text-[10px] font-mono text-indigo-600">{m.employeeCode}</span>
                    </td>
                    <td className="py-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          m.movementType === 'promotion'
                            ? 'bg-emerald-100 text-emerald-800'
                            : m.movementType === 'new_hire'
                            ? 'bg-indigo-100 text-indigo-800'
                            : m.movementType === 'exit'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {m.movementType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 text-slate-700">
                      {m.fromDepartment && m.toDepartment && m.fromDepartment !== m.toDepartment ? (
                        <span>
                          {m.fromDepartment} → <strong>{m.toDepartment}</strong>
                        </span>
                      ) : (
                        <span>{m.toDepartment || m.fromDepartment || '—'}</span>
                      )}
                      {m.fromBranch && m.toBranch && m.fromBranch !== m.toBranch && (
                        <div className="text-[10px] text-teal-700 font-semibold">
                          Branch: {m.fromBranch} → {m.toBranch}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-slate-700">
                      {m.fromDesignation && m.toDesignation && m.fromDesignation !== m.toDesignation ? (
                        <span>
                          {m.fromDesignation} → <strong>{m.toDesignation}</strong>
                        </span>
                      ) : (
                        <span>{m.toDesignation || m.fromDesignation || '—'}</span>
                      )}
                    </td>
                    {canViewSalaryCost && (
                      <td className="py-3 font-mono">
                        {m.fromSalary && m.toSalary && m.fromSalary !== m.toSalary ? (
                          <span className="text-emerald-700 font-bold">
                            ৳{m.fromSalary.toLocaleString()} → ৳{m.toSalary.toLocaleString()}
                          </span>
                        ) : m.toSalary ? (
                          <span>৳{m.toSalary.toLocaleString()}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                    <td className="py-3 text-slate-500 max-w-xs truncate">{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: ADD / EDIT WORKFORCE POSITION PLAN                               */}
      {/* ========================================================================= */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">
                {editingPlanId ? 'Update Position Headcount Plan' : 'New Position Headcount Plan'}
              </h3>
              <button
                onClick={() => setShowPlanModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSavePlan} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Position / Designation Title *</label>
                <input
                  type="text"
                  required
                  value={planForm.title}
                  onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
                  placeholder="e.g. Senior Software Engineer"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Department *</label>
                  <select
                    value={planForm.department}
                    onChange={(e) => setPlanForm({ ...planForm, department: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Branch</label>
                  <select
                    value={planForm.branch}
                    onChange={(e) => setPlanForm({ ...planForm, branch: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    <option value="All">All Branches</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Approved Seats *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={planForm.approvedHeadcount}
                    onChange={(e) => setPlanForm({ ...planForm, approvedHeadcount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Budgeted Salary (৳)</label>
                  <input
                    type="number"
                    min={0}
                    value={planForm.budgetedAvgSalary}
                    onChange={(e) => setPlanForm({ ...planForm, budgetedAvgSalary: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Hiring Priority</label>
                  <select
                    value={planForm.priority}
                    onChange={(e) =>
                      setPlanForm({ ...planForm, priority: e.target.value as WorkforcePositionPlan['priority'] })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="standard">Standard</option>
                    <option value="growth">Growth</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Planning Notes</label>
                <textarea
                  rows={2}
                  value={planForm.notes}
                  onChange={(e) => setPlanForm({ ...planForm, notes: e.target.value })}
                  placeholder="Optional justification or quarterly headcount notes..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPlanModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold cursor-pointer"
                >
                  Save Headcount Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: RECORD EMPLOYEE MOVEMENT / PROMOTION / TRANSFER                  */}
      {/* ========================================================================= */}
      {showMovementModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">
                Record Employee Promotion / Transfer / Movement
              </h3>
              <button
                onClick={() => setShowMovementModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveMovement} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Employee *</label>
                  <select
                    value={movementForm.employeeId}
                    onChange={(e) => {
                      const emp = scopedEmployees.find((x) => x.id === e.target.value);
                      setMovementForm({
                        ...movementForm,
                        employeeId: e.target.value,
                        toDepartment: emp?.department || movementForm.toDepartment,
                        toDesignation: emp?.designation || movementForm.toDesignation,
                        toBranch: emp ? getEmployeeBranch(emp) : movementForm.toBranch,
                        toSalary: emp ? getEmpGrossSalary(emp) : movementForm.toSalary,
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    {scopedEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.employeeId})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Movement Type *</label>
                  <select
                    value={movementForm.movementType}
                    onChange={(e) =>
                      setMovementForm({ ...movementForm, movementType: e.target.value as EmployeeMovementType })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    <option value="promotion">Promotion</option>
                    <option value="department_transfer">Department Transfer</option>
                    <option value="branch_transfer">Branch Transfer</option>
                    <option value="designation_change">Designation Change</option>
                    <option value="salary_revision">Salary Revision</option>
                    <option value="manager_reassignment">Manager Reassignment</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">New Department</label>
                  <select
                    value={movementForm.toDepartment}
                    onChange={(e) => setMovementForm({ ...movementForm, toDepartment: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">New Branch</label>
                  <select
                    value={movementForm.toBranch}
                    onChange={(e) => setMovementForm({ ...movementForm, toBranch: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">New Designation</label>
                  <input
                    type="text"
                    value={movementForm.toDesignation}
                    onChange={(e) => setMovementForm({ ...movementForm, toDesignation: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Effective Date *</label>
                  <input
                    type="date"
                    required
                    value={movementForm.effectiveDate}
                    onChange={(e) => setMovementForm({ ...movementForm, effectiveDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Revised Gross Salary (৳)</label>
                  <input
                    type="number"
                    min={0}
                    value={movementForm.toSalary}
                    onChange={(e) => setMovementForm({ ...movementForm, toSalary: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Reporting Manager Name</label>
                  <input
                    type="text"
                    value={movementForm.toManagerName}
                    onChange={(e) => setMovementForm({ ...movementForm, toManagerName: e.target.value })}
                    placeholder="Optional manager name"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Order Reason / Remarks *</label>
                <input
                  type="text"
                  required
                  value={movementForm.reason}
                  onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })}
                  placeholder="e.g. Annual appraisal promotion & department expansion"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <label className="flex items-center space-x-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={movementForm.applyToEmployeeProfile}
                  onChange={(e) =>
                    setMovementForm({ ...movementForm, applyToEmployeeProfile: e.target.checked })
                  }
                  className="rounded text-indigo-600"
                />
                <span className="font-semibold text-slate-700">
                  Immediately apply updated designation/department/branch/salary to Employee Profile
                </span>
              </label>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMovementModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-violet-600 text-white font-bold cursor-pointer"
                >
                  Record Movement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* WORKFORCE PLANNING PRINT & PDF PREVIEW MODAL                              */}
      {/* ========================================================================= */}
      {showPrintModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto print:p-0 print:bg-white"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPrintModal(false);
          }}
        >
          <div className="bg-white rounded-3xl max-w-6xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden print:max-h-none print:shadow-none print:border-0">
            {/* Modal Control Bar */}
            <div className="px-5 py-4 bg-slate-950 text-white flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/10 shrink-0 print:hidden">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-xl shrink-0 shadow-lg shadow-indigo-600/30">
                  🖨️
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-sm sm:text-base text-white truncate">
                      Workforce Planning — Print &amp; PDF Preview
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/25 text-indigo-300 border border-indigo-400/30 shrink-0">
                      Audit Ready
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {workforceReportConfig.title} • {workforceReportConfig.rows.length} Records
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExecutePrint}
                  disabled={isPrinting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
                >
                  <span>🖨️</span>
                  <span>{isPrinting ? 'Preparing Print...' : 'Print / Save as PDF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const html = generateReportHtml(workforceReportConfig);
                    downloadReportHtml('workforce_planning_report', html);
                    showToast('Downloaded standalone printable HTML report!');
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all border border-slate-700 cursor-pointer"
                >
                  <span>💾</span>
                  <span>Download HTML</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all border border-slate-700 cursor-pointer"
                >
                  <span>📥</span>
                  <span>Export CSV</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyReportAsTsv(workforceReportConfig.headers, workforceReportConfig.rows);
                    if (ok) showToast('Copied workforce table to clipboard!');
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all border border-slate-700 cursor-pointer"
                >
                  <span>📋</span>
                  <span>Copy Table</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowPrintModal(false)}
                  className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-rose-600 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer font-bold text-base ml-1"
                  aria-label="Close modal"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Printable Report Sheet */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-100 flex justify-center print:p-0 print:bg-white">
              <div className="bg-white rounded-xl shadow-md border border-slate-300/80 p-6 sm:p-8 w-full max-w-5xl text-slate-900 font-sans print:shadow-none print:border-0">
                {/* Corporate Header */}
                <div className="border-b-2 border-slate-900 pb-4 mb-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xl">🏛️</span>
                      <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                        {currentCompany?.name || 'WorkNest HRMS'} — Enterprise Workforce Operations
                      </h2>
                    </div>
                    <h3 className="text-base font-bold text-indigo-950 mt-1">
                      {workforceReportConfig.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {workforceReportConfig.subtitle}
                    </p>
                  </div>
                  <div className="text-left sm:text-right text-xs text-slate-600 space-y-0.5">
                    <p><strong className="text-slate-900">Period:</strong> {workforceReportConfig.period}</p>
                    <p><strong className="text-slate-900">Entries:</strong> {workforceReportConfig.rows.length} records</p>
                    <p><strong className="text-slate-900">Generated:</strong> {new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    <p><strong className="text-slate-900">Status:</strong> Official Workforce Audit</p>
                  </div>
                </div>

                {/* Filters */}
                <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap gap-2 items-center">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mr-1">
                    Applied Filters:
                  </span>
                  {workforceReportConfig.filters.map((f, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-700 shadow-2xs"
                    >
                      <strong className="text-slate-500 font-medium">{f.label}:</strong> {f.value}
                    </span>
                  ))}
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5 mb-6">
                  {workforceReportConfig.metrics.map((m, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-xl border ${
                        m.highlight
                          ? 'bg-indigo-50/70 border-indigo-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block truncate">
                        {m.label}
                      </span>
                      <span className="text-sm sm:text-base font-black text-slate-900 font-mono mt-1 block truncate">
                        {m.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Data Table */}
                <div className="overflow-x-auto border border-slate-300 rounded-xl mb-8">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-white">
                        {workforceReportConfig.headers.map((h, i) => (
                          <th
                            key={i}
                            className="px-3 py-2.5 font-bold text-[10px] tracking-wider uppercase border border-slate-800 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-800">
                      {workforceReportConfig.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={workforceReportConfig.headers.length}
                            className="px-4 py-8 text-center text-slate-400 italic"
                          >
                            No workforce records found matching the active filters.
                          </td>
                        </tr>
                      ) : (
                        workforceReportConfig.rows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className={rIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}
                          >
                            {row.map((cell, cIdx) => (
                              <td
                                key={cIdx}
                                className="px-3 py-2 border border-slate-200 text-[11px] whitespace-nowrap"
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Signatures */}
                <div className="pt-6 border-t border-slate-300 mt-6 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="border-t border-dashed border-slate-400 pt-2 mb-1"></div>
                    <p className="text-xs font-bold text-slate-900">Prepared By</p>
                    <p className="text-[10px] text-slate-500">HR Operations &amp; Workforce Planning</p>
                  </div>
                  <div>
                    <div className="border-t border-dashed border-slate-400 pt-2 mb-1"></div>
                    <p className="text-xs font-bold text-slate-900">Verified &amp; Audited By</p>
                    <p className="text-[10px] text-slate-500">Head of Human Resources</p>
                  </div>
                  <div>
                    <div className="border-t border-dashed border-slate-400 pt-2 mb-1"></div>
                    <p className="text-xs font-bold text-slate-900">Approved By</p>
                    <p className="text-[10px] text-slate-500">Managing Director / Authorized Signatory</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
