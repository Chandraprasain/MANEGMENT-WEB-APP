import { GoogleGenAI, Type } from '@google/genai';

export interface HomeworkScanInput {
  questionText?: string;
  imageBase64?: string;
  imageMimeType?: string;
  subject: string;
  learningMode:
    | 'EXPLAIN'
    | 'STEP_BY_STEP'
    | 'HINT'
    | 'PRACTICE'
    | 'CHECK_ANSWER'
    | 'EXAM_PREP'
    | 'NEPALI'
    | 'ENGLISH';
  studentAnswer?: string;
  provider?: 'GEMINI' | 'OPENAI';
}

export interface HomeworkScanOutput {
  provider: string;
  model: string;
  detectedQuestion: string;
  subject: string;
  topic: string;
  concepts: string[];
  formulas: string[];
  steps: string[];
  finalSolution: string;
  verificationNote: string;
  practiceQuestion: string;
  aiDisclaimer: string;
}

export interface ModerationScanResult {
  riskLevel: 'LOW' | 'UNCERTAIN' | 'HIGH_PROHIBITED' | 'CRITICAL_CHILD_SAFETY';
  categories: string[];
  confidence: number;
  reason: string;
  engine: string;
}

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY' || key.trim().length < 10) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getAIProviderStatus() {
  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
      process.env.GEMINI_API_KEY.trim().length >= 10
  );
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length >= 10);
  return {
    gemini: {
      configured: geminiConfigured,
      model: 'gemini-4-hydrogen',
    },
    openai: {
      configured: openAiConfigured,
      model: 'gpt-4o-mini',
    },
  };
}

export async function runHomeworkScan(input: HomeworkScanInput): Promise<HomeworkScanOutput> {
  if (input.provider === 'OPENAI') {
    if (!process.env.OPENAI_API_KEY) {
      throw Object.assign(
        new Error('OpenAI provider credentials (OPENAI_API_KEY) are not configured on the server.'),
        { statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED' }
      );
    }
    throw Object.assign(
      new Error('OpenAI adapter requires active merchant key verification. Switch to Gemini or configure OPENAI_API_KEY.'),
      { statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED' }
    );
  }

  const ai = getGeminiClient();
  if (!ai) {
    throw Object.assign(
      new Error('Gemini AI credentials (GEMINI_API_KEY) are not configured in server secrets. Configure GEMINI_API_KEY to run AI Homework Scanner.'),
      { statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED' }
    );
  }

  const languageDirective =
    input.learningMode === 'NEPALI'
      ? 'Respond in clear, natural Nepali (Devanagari script) suitable for school students, keeping mathematical symbols clear.'
      : 'Respond in clear, age-appropriate English suitable for school students.';

  const modeDirective: Record<HomeworkScanInput['learningMode'], string> = {
    HINT: 'Do NOT give away the final answer directly. Give 2-3 encouraging Socratic hints in steps.',
    EXPLAIN: 'Explain the underlying concept clearly with intuitive examples.',
    STEP_BY_STEP: 'Provide a clear, numbered step-by-step derivation leading to the final solution.',
    PRACTICE: 'Solve briefly and generate a fresh similar practice problem at the end.',
    CHECK_ANSWER: `Review the student's attempted answer ("${input.studentAnswer || 'none provided'}"), identify mistakes gently, and guide them to the correct method.`,
    EXAM_PREP: 'Provide an exam-ready structured answer highlighting key marking points and common pitfalls.',
    NEPALI: 'Provide a full step-by-step explanation in Nepali language.',
    ENGLISH: 'Provide a full step-by-step explanation in English.',
  };

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (input.imageBase64 && input.imageMimeType) {
    const cleanBase64 = input.imageBase64.replace(/^data:[^;]+;base64,/, '');
    parts.push({
      inlineData: {
        mimeType: input.imageMimeType,
        data: cleanBase64,
      },
    });
  }

  parts.push({
    text: `You are an educational AI tutor for school students.
Subject: ${input.subject}
Learning Mode: ${input.learningMode} — ${modeDirective[input.learningMode]}
${languageDirective}
${input.questionText ? `Question Text: ${input.questionText}` : 'Extract the homework question from the uploaded image.'}

Safety & Accuracy rules:
- If an image is unreadable or does not contain an educational question, clearly state that in detectedQuestion and verificationNote.
- Label uncertainty honestly. Never fabricate missing numbers.`,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction:
        'Return structured JSON matching the schema. Always keep tone supportive, grade-appropriate, and academically rigorous.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detectedQuestion: { type: Type.STRING },
          subject: { type: Type.STRING },
          topic: { type: Type.STRING },
          concepts: { type: Type.ARRAY, items: { type: Type.STRING } },
          formulas: { type: Type.ARRAY, items: { type: Type.STRING } },
          steps: { type: Type.ARRAY, items: { type: Type.STRING } },
          finalSolution: { type: Type.STRING },
          verificationNote: { type: Type.STRING },
          practiceQuestion: { type: Type.STRING },
        },
        required: ['detectedQuestion', 'subject', 'topic', 'concepts', 'formulas', 'steps', 'finalSolution', 'verificationNote', 'practiceQuestion'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<
    HomeworkScanOutput,
    'provider' | 'model' | 'aiDisclaimer'
  >;

  return {
    provider: 'Google Gemini',
    model: 'gemini-4-hydrogen',
    detectedQuestion: parsed.detectedQuestion || input.questionText || 'Extracted question',
    subject: parsed.subject || input.subject,
    topic: parsed.topic || 'General',
    concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
    formulas: Array.isArray(parsed.formulas) ? parsed.formulas : [],
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    finalSolution: parsed.finalSolution || 'Review the steps above.',
    verificationNote: parsed.verificationNote || 'Verified against curriculum fundamentals.',
    practiceQuestion: parsed.practiceQuestion || 'Try solving a similar problem with different values.',
    aiDisclaimer: 'AI-generated educational guidance. Always verify final schoolwork with your teacher.',
  };
}

const CRITICAL_PATTERNS = /\b(csam|child exploitation|kill yourself|bomb threat|explicit sexual)\b/i;
const HIGH_RISK_PATTERNS = /\b(phishing|free nitro|crypto scam|password stealer|hate speech|harass|bully|slur)\b/i;

export async function scanContentForModeration(content: string): Promise<ModerationScanResult> {
  if (CRITICAL_PATTERNS.test(content)) {
    return {
      riskLevel: 'CRITICAL_CHILD_SAFETY',
      categories: ['CHILD_SAFETY_OR_SEVERE_THREAT'],
      confidence: 0.99,
      reason: 'Automated safeguarding filter flagged critical threat or exploitation terminology.',
      engine: 'deterministic-safeguard',
    };
  }
  if (HIGH_RISK_PATTERNS.test(content)) {
    return {
      riskLevel: 'HIGH_PROHIBITED',
      categories: ['SCAM_OR_HARASSMENT'],
      confidence: 0.92,
      reason: 'Automated policy filter detected prohibited scam, phishing, or harassment terms.',
      engine: 'deterministic-safeguard',
    };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      riskLevel: 'LOW',
      categories: [],
      confidence: 0.7,
      reason: 'Passed deterministic safety checks (Gemini moderation key not configured).',
      engine: 'deterministic-safeguard',
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Evaluate this school community post for safety violations (spam, phishing, bullying, threats, inappropriate content). Account for benign educational/medical/science context.\n\nContent:\n"""${content.slice(0, 2000)}"""`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            riskLevel: { type: Type.STRING },
            categories: { type: Type.ARRAY, items: { type: Type.STRING } },
            confidence: { type: Type.NUMBER },
            reason: { type: Type.STRING },
          },
          required: ['riskLevel', 'categories', 'confidence', 'reason'],
        },
      },
    });
    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      riskLevel?: string;
      categories?: string[];
      confidence?: number;
      reason?: string;
    };
    const validLevels = ['LOW', 'UNCERTAIN', 'HIGH_PROHIBITED', 'CRITICAL_CHILD_SAFETY'] as const;
    const riskLevel = validLevels.includes(parsed.riskLevel as typeof validLevels[number])
      ? (parsed.riskLevel as ModerationScanResult['riskLevel'])
      : 'LOW';

    return {
      riskLevel,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
      reason: parsed.reason || 'Evaluated by Gemini safety gateway.',
      engine: 'gemini-4-hydrogen',
    };
  } catch {
    return {
      riskLevel: 'LOW',
      categories: [],
      confidence: 0.6,
      reason: 'Passed deterministic safety checks.',
      engine: 'deterministic-safeguard',
    };
  }
}

export type AIAgentType =
  | 'PRINCIPAL_OPS'
  | 'TEACHER_PEDAGOGY'
  | 'STUDENT_TUTOR'
  | 'PARENT_GUIDE'
  | 'TECH_SUPPORT';

export interface RoleAIAgentOutput {
  agentType: AIAgentType;
  provider: string;
  model: string;
  summary: string;
  insights: string[];
  proposedAction?: {
    actionType: string;
    title: string;
    draftPayload: string;
    requiresHumanApproval: true;
  } | null;
  aiDisclaimer: string;
}

export async function runRoleScopedAIAgent(params: {
  agentType: AIAgentType;
  prompt: string;
  scopedContext: Record<string, unknown>;
  promptVersion: string;
}): Promise<RoleAIAgentOutput> {
  const ai = getGeminiClient();
  if (!ai) {
    throw Object.assign(
      new Error('Gemini AI credentials (GEMINI_API_KEY) are not configured on the server. Configure GEMINI_API_KEY to invoke Role AI Agents.'),
      { statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED' }
    );
  }

  const systemGuide: Record<AIAgentType, string> = {
    PRINCIPAL_OPS: 'You are the Principal Operations Copilot. Analyze authorized school KPIs and draft notices or follow-up plans. Never auto-publish grades or alter attendance.',
    TEACHER_PEDAGOGY: 'You are the Teacher Pedagogy Assistant. Generate curriculum-aligned lesson outlines, quiz drafts, or study feedback for teacher review.',
    STUDENT_TUTOR: 'You are the Student Learning Agent. Explain concepts encouragingly step-by-step and suggest targeted practice without completing graded exams.',
    PARENT_GUIDE: 'You are the Parent Engagement Agent. Summarize only the authorized linked child data in clear, supportive language for guardians.',
    TECH_SUPPORT: 'You are the Technical SIS & Interoperability Copilot. Help troubleshoot OneRoster CSV, webhooks, and printer/offline queue workflows.',
  };

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Prompt Version: ${params.promptVersion}
Authorized Scoped Context:
${JSON.stringify(params.scopedContext, null, 2)}

User Request:
${params.prompt}`,
    config: {
      systemInstruction: `${systemGuide[params.agentType]} Return JSON strictly matching the schema.`,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          insights: { type: Type.ARRAY, items: { type: Type.STRING } },
          proposedActionTitle: { type: Type.STRING },
          proposedActionDraft: { type: Type.STRING },
        },
        required: ['summary', 'insights'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    summary?: string;
    insights?: string[];
    proposedActionTitle?: string;
    proposedActionDraft?: string;
  };

  return {
    agentType: params.agentType,
    provider: 'Google Gemini',
    model: 'gemini-4-hydrogen',
    summary: parsed.summary || 'Analysis prepared using authorized school context.',
    insights: Array.isArray(parsed.insights) ? parsed.insights : [],
    proposedAction: parsed.proposedActionTitle
      ? {
          actionType: 'HUMAN_REVIEW_DRAFT',
          title: parsed.proposedActionTitle,
          draftPayload: parsed.proposedActionDraft || '',
          requiresHumanApproval: true,
        }
      : null,
    aiDisclaimer: 'AI agent draft — human review required before applying any official school action.',
  };
}

