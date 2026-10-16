import { GoogleGenAI } from '@google/genai';

// Server-side rate limiting bucket per tenant + actor
const serverRateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 25;

function checkServerAiRateLimit(actorKey: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = serverRateLimitMap.get(actorKey);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    serverRateLimitMap.set(actorKey, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (bucket.count >= MAX_REQUESTS_PER_MINUTE) {
    const retryAfterSec = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart)) / 1000);
    return { allowed: false, retryAfterSec };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

export interface AuthorizedAiHrRequestPayload {
  prompt: string;
  insightCategory?:
    | 'general_qa'
    | 'attendance_insights'
    | 'absence_trends'
    | 'overtime_analysis'
    | 'workforce_summary'
    | 'payroll_insights'
    | 'recruitment_insights'
    | 'performance_summary'
    | 'anomaly_detection'
    | 'executive_report';
  tenantContext: {
    companyId: string;
    companyName: string;
    currency: string;
    timezone: string;
    selectedMonth: string;
    selectedBranch: string;
  };
  actorContext: {
    actorId: string;
    actorName: string;
    actorRole: string;
    isSuperAdmin: boolean;
    assignedDepartment?: string;
    assignedBranch?: string;
    permissions: {
      payroll: boolean;
      recruitment: boolean;
      performance: boolean;
      attendance: boolean;
      leave: boolean;
      learningSkills: boolean;
      careerTalentSuccession: boolean;
    };
  };
  authorizedMetricsSummary: Record<string, any>;
}

export async function handleAiHrIntelligenceRequest(
  rawBody: string
): Promise<{ statusCode: number; body: Record<string, any> }> {
  let payload: AuthorizedAiHrRequestPayload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return {
      statusCode: 400,
      body: { success: false, error: 'Invalid JSON request payload.' },
    };
  }

  // 1. Validate Authentication & Tenant Isolation Context
  const companyId = String(payload?.tenantContext?.companyId || '').trim();
  const actorId = String(payload?.actorContext?.actorId || '').trim();
  const actorRole = String(payload?.actorContext?.actorRole || '').trim();
  const prompt = String(payload?.prompt || '').trim();

  if (!companyId || !actorId || !actorRole) {
    return {
      statusCode: 403,
      body: {
        success: false,
        error: 'Unauthorized: Valid tenant and role context required for AI HR Intelligence.',
      },
    };
  }

  if (!prompt) {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: 'Prompt question or analysis topic is required.',
      },
    };
  }

  // 2. Enforce Server-Side Rate Limiting per Tenant + Actor
  const rateKey = `${companyId}:${actorId}`;
  const rateRes = checkServerAiRateLimit(rateKey);
  if (!rateRes.allowed) {
    return {
      statusCode: 429,
      body: {
        success: false,
        error: `Rate limit reached for AI HR Intelligence. Please wait ${rateRes.retryAfterSec}s before sending another query.`,
      },
    };
  }

  // 3. Enforce Strict Permission Filtering on Authorized Metrics Summary before sending to Gemini
  const perms = payload.actorContext.permissions || {
    payroll: false,
    recruitment: false,
    performance: false,
    attendance: true,
    leave: true,
    learningSkills: false,
    careerTalentSuccession: false,
  };
  const isSuper = Boolean(payload.actorContext.isSuperAdmin || actorRole === 'Super Admin');

  const sanitizedSummary = { ...(payload.authorizedMetricsSummary || {}) };
  if (!isSuper && !perms.payroll) {
    delete sanitizedSummary.payrollSummary;
    delete sanitizedSummary.salaryBreakdown;
    delete sanitizedSummary.topOvertimeCostEmployees;
  }
  if (!isSuper && !perms.recruitment) {
    delete sanitizedSummary.recruitmentSummary;
  }
  if (!isSuper && !perms.performance) {
    delete sanitizedSummary.performanceSummary;
  }
  if (!isSuper && !perms.careerTalentSuccession) {
    delete sanitizedSummary.successionSummary;
    delete sanitizedSummary.talentPoolSummary;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      body: {
        success: true,
        source: 'deterministic_engine',
        aiText: null,
        message: 'Using built-in authoritative WorkNest HR analytical engine.',
      },
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemInstruction = [
      `You are the Enterprise AI HR Intelligence Engine inside WorkNest HR for tenant "${payload.tenantContext.companyName}" (Tenant ID: ${companyId}).`,
      `Active Period: ${payload.tenantContext.selectedMonth} | Branch Scope: ${payload.tenantContext.selectedBranch} | Currency: ${payload.tenantContext.currency} | Timezone: ${payload.tenantContext.timezone}.`,
      `Current User: ${payload.actorContext.actorName} (Role: ${actorRole}${payload.actorContext.assignedDepartment ? `, Dept Scope: ${payload.actorContext.assignedDepartment}` : ''}).`,
      `CRITICAL SECURITY & DATA INTEGRITY RULES:`,
      `1. Answer ONLY using the provided authorized tenant metrics JSON. Never invent employees, attendance records, weekends, shifts, or salary figures.`,
      `2. In WorkNest HR, Roster is the ONLY authority for Weekend/Off days, and Shift times are authoritative for late/early/overtime.`,
      `3. Respect user permissions: if payroll, recruitment, or succession metrics are omitted due to role restrictions, politely state that those figures require corresponding role authorization.`,
      `4. Structure your response clearly with concise executive bullet points, key findings, and actionable HR recommendations.`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Authorized WorkNest HR Data Snapshot (Tenant: ${companyId}):\n${JSON.stringify(sanitizedSummary, null, 2)}\n\nUser Question / Request (${payload.insightCategory || 'general_qa'}):\n${prompt}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction,
        temperature: 0.2,
      },
    });

    const aiText = response.text || '';
    return {
      statusCode: 200,
      body: {
        success: true,
        source: 'gemini-3.8-flash',
        aiText: aiText.trim() || null,
      },
    };
  } catch (err: any) {
    console.warn('[AI HR Intelligence Server Warning]:', err?.message || err);
    return {
      statusCode: 200,
      body: {
        success: true,
        source: 'deterministic_fallback',
        aiText: null,
        warning: err?.message || 'AI model unavailable; using deterministic HR analytics.',
      },
    };
  }
}
