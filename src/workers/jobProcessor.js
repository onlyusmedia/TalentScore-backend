const { Worker } = require('bullmq');
const { getRedisConnection } = require('../config/redis');
const Job = require('../models/Job');
const Role = require('../models/Role');
const Candidate = require('../models/Candidate');
const { sendJobUpdate } = require('../services/sse');
const { deductCredit } = require('../services/credit');
const { generatePresignedDownloadUrl } = require('../config/s3');

/**
 * BullMQ Worker
 * Processes queued jobs by calling n8n webhooks.
 * The worker enriches queue data (generates S3 URLs, fetches DB records),
 * sends it to n8n, and processes the AI response to update the database.
 */

const N8N_BASE = process.env.N8N_WEBHOOK_BASE_URL || 'http://localhost:5678';

/**
 * Build the payload to send to n8n for each job type.
 * This is where we enrich queue data with presigned URLs and DB records.
 */
const buildN8nPayload = async (type, data) => {
  switch (type) {
    case 'role-setup': {
      // Role setup already has all needed data from the queue
      return {
        roleId: data.roleId,
        jobDescription: data.jobDescription,
        priorities: data.priorities,
        payRange: data.payRange,
      };
    }

    case 'resume-parse': {
      // Generate a presigned S3 download URL for the resume
      const resumeDownloadUrl = await generatePresignedDownloadUrl(data.s3Key);

      // Fetch role for job description context
      const role = await Role.findById(data.roleId).lean();

      return {
        candidateId: data.candidateId,
        resumeDownloadUrl,
        jobDescription: role?.originalJobDescription || role?.improvedJobDescription || '',
        priorities: role?.priorities?.text || '',
      };
    }

    case 'generate-questions': {
      // Fetch role and candidates with parsed resumes
      const role = await Role.findById(data.roleId).lean();
      const candidates = await Candidate.find({
        _id: { $in: data.candidateIds },
        'resume.processingStatus': 'done',
      }).lean();

      return {
        roleId: data.roleId,
        jobDescription: role?.improvedJobDescription || role?.originalJobDescription || '',
        priorities: role?.priorities?.text || '',
        scoringCategories: role?.scoringCategories || [],
        candidates: candidates.map((c) => ({
          candidateId: c._id.toString(),
          name: c.name || 'Unknown',
          resumeSummary: c.resume?.summary || '',
          strengths: c.resume?.strengths || [],
          concerns: c.resume?.concerns || [],
        })),
      };
    }

    case 'score-candidates': {
      // Fetch role and candidates with all available data
      const role = await Role.findById(data.roleId).lean();
      const candidates = await Candidate.find({
        _id: { $in: data.candidateIds },
        'resume.processingStatus': 'done',
      }).lean();

      return {
        roleId: data.roleId,
        jobDescription: role?.improvedJobDescription || role?.originalJobDescription || '',
        priorities: role?.priorities?.text || '',
        scoringCategories: role?.scoringCategories || [],
        candidates: candidates.map((c) => ({
          candidateId: c._id.toString(),
          name: c.name || 'Unknown',
          resumeSummary: c.resume?.summary || '',
          strengths: c.resume?.strengths || [],
          concerns: c.resume?.concerns || [],
          interviewTranscript: c.interview?.transcriptRaw || null,
          interviewStructured: c.interview?.transcriptStructured || [],
        })),
      };
    }

    case 'transcribe-interview': {
      const payload = {
        candidateId: data.candidateId,
      };

      if (data.transcript) {
        // Text transcript — send directly
        payload.transcript = data.transcript;

        // Fetch planned interview questions for context
        const candidate = await Candidate.findById(data.candidateId).lean();
        payload.interviewQuestions = candidate?.interviewQuestions?.standard || [];
      }

      if (data.hasAudio && data.audioS3Key) {
        // Audio file — generate presigned download URL
        payload.audioDownloadUrl = await generatePresignedDownloadUrl(data.audioS3Key);
      }

      return payload;
    }

    default:
      return data;
  }
};

/**
 * Core processing logic for a job.
 * Separated from the BullMQ wrapper so it can be called synchronously on Vercel.
 */
const processJobLogic = async (type, data, internalId = null) => {
  const logId = internalId || `inline-${Date.now()}`;
  console.log(`[Processor] Processing ${type}: ${logId}`);

  // Update job status to processing
  if (data.jobId) {
    await Job.findByIdAndUpdate(data.jobId, {
      $set: { status: 'processing', progress: 10 },
    });
    // Send SSE update
    sendJobUpdate(data.userId, data.jobId, 'processing', 10);
  }

  // Map job types to n8n webhook paths
  const webhookMap = {
    'role-setup': '/webhook/role-setup',
    'resume-parse': '/webhook/resume-parse',
    'transcribe-interview': '/webhook/transcribe-interview',
    'generate-questions': '/webhook/generate-questions',
    'score-candidates': '/webhook/score-candidates',
  };

  const webhookPath = webhookMap[type];
  if (!webhookPath) {
    throw new Error(`Unknown job type: ${type}`);
  }

  try {
    // Build enriched payload for n8n (presigned URLs, DB data, etc.)
    const payload = await buildN8nPayload(type, data);
    console.log(`[Processor] Built payload for ${type}, sending to n8n...`);

    // Call n8n webhook — n8n processes AI and responds with results
    console.log(`[Processor] Sending payload to n8n ${type}:`, JSON.stringify(payload, null, 2));
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      const response = await fetch(`${N8N_BASE}${webhookPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': process.env.INTERNAL_API_KEY,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`n8n webhook failed (${response.status}): ${errorText}`);
      }

      // Parse the AI results from n8n's response
      const result = await response.json();
      console.log(`[Processor] ${type} got results from n8n, updating database...`);

      // Process the results based on job type
      await handleResult(type, data, result);

      console.log(`[Processor] ${type} completed successfully`);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`n8n webhook timed out after 60s for ${type}`);
      }
      throw error;
    }
  } catch (error) {
    console.error(`[Processor] ${type} failed:`, error.message);

    // If n8n is down, simulate processing for development
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      console.log(`[Processor] n8n unavailable — running in demo mode for ${type}`);
      await simulateDemoProcessing(type, data);
      return;
    }

    // Update job status to failed
    if (data.jobId) {
      await Job.findByIdAndUpdate(data.jobId, {
        $set: { status: 'failed', error: error.message },
      });
      sendJobUpdate(data.userId, data.jobId, 'failed', 0, { error: error.message });
    }
    throw error;
  }
};

const processJob = async (bullJob) => {
  const { type, data } = { type: bullJob.name, data: bullJob.data };
  return processJobLogic(type, data, bullJob.id);
};

/**
 * Process n8n webhook response and update database
 */
const handleResult = async (type, data, result) => {
  switch (type) {
    case 'role-setup': {
      const { roleId, improvedJobDescription, scoringCategories, marketFeedback } = result;

      await Role.findByIdAndUpdate(roleId || data.roleId, {
        $set: {
          improvedJobDescription,
          scoringCategories,
          marketFeedback,
          'processingStatus.jobPostImprovement': 'done',
          'processingStatus.categoryGeneration': 'done',
          status: 'active',
        },
      });

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100, { type: 'role-setup', roleId: roleId || data.roleId });
      console.log(`[Worker] Role setup complete: ${roleId || data.roleId}`);
      break;
    }

    case 'resume-parse': {
      const { candidateId, name, email, phone, summary, strengths, concerns, experience, skills } = result;

      await Candidate.findByIdAndUpdate(candidateId || data.candidateId, {
        $set: {
          name: name || 'Unknown',
          email: email || undefined,
          'resume.summary': summary,
          'resume.strengths': strengths || [],
          'resume.concerns': concerns || [],
          'resume.processingStatus': 'done',
          'resume.processedAt': new Date(),
        },
      });

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100, { type: 'resume-parsed', candidateId: candidateId || data.candidateId });
      console.log(`[Worker] Resume parsed: ${candidateId || data.candidateId} → ${name}`);
      break;
    }

    case 'generate-questions': {
      const { candidateId, questions } = result;

      await Candidate.findByIdAndUpdate(candidateId || data.candidateIds?.[0], {
        $set: {
          interviewQuestions: {
            ...questions,
            processingStatus: 'done',
            generatedAt: new Date(),
          },
        },
      });

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100, { type: 'questions-generated' });
      console.log(`[Worker] Questions generated for: ${candidateId || data.candidateIds?.[0]}`);
      break;
    }

    case 'score-candidates': {
      const { candidateId, roleId, scores } = result;
      const cId = candidateId || data.candidateIds?.[0];

      const candidate = await Candidate.findById(cId);

      await Candidate.findByIdAndUpdate(cId, {
        $set: {
          'scores.categories': scores.categories,
          'scores.overallScore': scores.overallScore,
          'scores.label': scores.label,
          'scores.executiveSummary': scores.executiveSummary,
          'scores.topStrengths': scores.topStrengths || [],
          'scores.topConcerns': scores.topConcerns || [],
          'scores.pastProblemMatch': scores.pastProblemMatch || {},
          'scores.interviewerFeedback': scores.interviewerFeedback || [],
          'scores.processingStatus': 'done',
          'scores.scoredAt': new Date(),
        },
      });

      // Deduct credit on successful scoring
      if (candidate && !candidate.creditDeducted) {
        try {
          await deductCredit(candidate.userId, candidate.roleId, candidate._id);
          await Candidate.findByIdAndUpdate(cId, {
            $set: { creditDeducted: true, creditDeductedAt: new Date() },
          });
        } catch (creditErr) {
          console.warn(`[Worker] Credit deduction failed for ${cId}:`, creditErr.message);
        }
      }

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100, { type: 'scoring-complete', candidateId: cId });
      console.log(`[Worker] Scoring complete: ${cId} → ${scores.label} (${scores.overallScore})`);
      break;
    }

    case 'transcribe-interview': {
      const { candidateId, transcriptRaw, transcriptStructured } = result;

      await Candidate.findByIdAndUpdate(candidateId || data.candidateId, {
        $set: {
          'interview.transcriptRaw': transcriptRaw,
          'interview.transcriptStructured': transcriptStructured || [],
          'interview.processingStatus': 'done',
          'interview.processedAt': new Date(),
        },
      });

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100, { type: 'interview-processed', candidateId: candidateId || data.candidateId });
      console.log(`[Worker] Interview processed: ${candidateId || data.candidateId}`);
      break;
    }
  }
};

/**
 * Demo mode: simulates AI processing when n8n is not available
 * This allows frontend development without the full AI stack
 */
const simulateDemoProcessing = async (type, data) => {
  switch (type) {
    case 'role-setup': {
      await new Promise((r) => setTimeout(r, 2000));

      await Role.findByIdAndUpdate(data.roleId, {
        $set: {
          improvedJobDescription: data.jobDescription + '\n\n[AI Enhanced: Added clarity on key responsibilities, success metrics, and team dynamics. Aligned with employer priorities.]',
          scoringCategories: [
            { name: 'Communication', description: 'Ability to clearly convey ideas and actively listen.', weight: 1, isCustom: false, keyIndicators: ['Clear articulation', 'Active listening'], redFlags: ['Vague responses', 'Interrupts frequently'] },
            { name: 'Accountability', description: 'Takes ownership of outcomes, both positive and negative.', weight: 1, isCustom: false, keyIndicators: ['Owns mistakes', 'Follows through'], redFlags: ['Blames others', 'Avoids responsibility'] },
            { name: 'Financial Awareness', description: 'Understands business metrics, margins, and financial impact.', weight: 1, isCustom: false, keyIndicators: ['Uses numbers', 'Understands P&L'], redFlags: ['No financial context', 'Ignores costs'] },
            { name: 'Proactiveness', description: 'Takes initiative without being asked, anticipates problems.', weight: 1, isCustom: false, keyIndicators: ['Self-starter', 'Anticipates needs'], redFlags: ['Waits for direction', 'Reactive only'] },
            { name: 'Problem Solving', description: 'Approaches challenges methodically and creates solutions.', weight: 1, isCustom: false, keyIndicators: ['Structured approach', 'Creative solutions'], redFlags: ['Panics under pressure', 'No clear methodology'] },
          ],
          marketFeedback: {
            salaryRange: { min: 70000, max: 130000 },
            warnings: ['Pay range appears competitive for this market.', 'Consider adding specific success metrics to the JD.'],
          },
          'processingStatus.jobPostImprovement': 'done',
          'processingStatus.categoryGeneration': 'done',
          status: 'active',
        },
      });

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }

    case 'resume-parse': {
      await new Promise((r) => setTimeout(r, 1500));

      const names = ['Alex Johnson', 'Sarah Chen', 'Michael Park', 'Emily Rodriguez', 'David Kim'];
      const randomName = names[Math.floor(Math.random() * names.length)];

      await Candidate.findByIdAndUpdate(data.candidateId, {
        $set: {
          name: randomName,
          email: `${randomName.toLowerCase().replace(' ', '.')}@email.com`,
          'resume.extractedText': 'Demo resume text — this would be the full extracted content from the PDF/DOCX.',
          'resume.summary': `${randomName} has 6+ years of experience in client management and business development. Previously at two mid-size firms with increasing responsibility. Shows progression from account coordinator to senior account manager.`,
          'resume.strengths': [
            'Strong client-facing experience with measurable results',
            'Progressive career growth with expanding scope',
            'Experience managing cross-functional teams',
          ],
          'resume.concerns': [
            'No evidence of P&L ownership despite senior title',
            'Gap in employment (8 months) unexplained',
            'Limited exposure to enterprise-level clients',
          ],
          'resume.processingStatus': 'done',
          'resume.processedAt': new Date(),
        },
      });

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }

    case 'generate-questions': {
      await new Promise((r) => setTimeout(r, 2000));

      for (const candidateId of data.candidateIds) {
        await Candidate.findByIdAndUpdate(candidateId, {
          $set: {
            interviewQuestions: {
              standard: [
                { question: 'Tell me about a time you had to take ownership of a failing project. What specifically did you do?', category: 'Accountability', followUp: 'If vague, ask: What was YOUR specific role in turning it around?' },
                { question: 'Describe a situation where you had to explain financial data to a non-financial stakeholder.', category: 'Financial Awareness', followUp: 'Ask for specific numbers and outcomes.' },
                { question: 'Walk me through how you handle a client who is unhappy with your team\'s delivery.', category: 'Communication', followUp: 'Ask: What was the result? Did you retain the client?' },
                { question: 'Tell me about a time you identified a problem before anyone else noticed and took action.', category: 'Proactiveness', followUp: 'What would have happened if you hadn\'t acted?' },
                { question: 'Describe a complex problem you solved. Walk me through your approach step by step.', category: 'Problem Solving', followUp: 'What alternatives did you consider?' },
              ],
              candidateSpecific: [
                { question: 'Your resume mentions managing key accounts but doesn\'t specify revenue size. Can you share the total revenue you were responsible for?', rationale: 'Verify financial scope claim', probing: 'If they can\'t give numbers, that\'s a red flag for financial awareness.' },
                { question: 'I notice an 8-month gap in your employment history. Can you walk me through what happened?', rationale: 'Address employment gap', probing: 'Listen for accountability vs. blaming.' },
                { question: 'You moved from a coordinator role to senior manager in 3 years. What made that possible?', rationale: 'Understand career progression', probing: 'Look for specific achievements vs. tenure-based promotion.' },
              ],
              behavioral: [
                { question: 'Tell me about a time a project failed and it was at least partially your fault. What happened?', targetBehavior: 'Detecting avoidance of accountability', redFlagAnswers: ['Blames team', 'Says it wasn\'t really their fault', 'Can\'t think of an example'] },
                { question: 'Describe a situation where you disagreed with your manager\'s approach. What did you do?', targetBehavior: 'Detecting passive behavior', redFlagAnswers: ['Just went along with it', 'Didn\'t say anything', 'Waited for someone else to speak up'] },
              ],
              processingStatus: 'done',
              generatedAt: new Date(),
            },
          },
        });
      }

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }

    case 'transcribe-interview': {
      await new Promise((r) => setTimeout(r, 2000));

      await Candidate.findByIdAndUpdate(data.candidateId, {
        $set: {
          'interview.transcriptRaw': 'Demo transcript — full text would appear here.',
          'interview.transcriptStructured': [
            { question: 'Tell me about a time you had to take ownership of a failing project.', answer: 'At my last company, we had a major client deliverable that was 3 weeks behind schedule. I stepped in and reorganized the team\'s workflow, set up daily standups, and personally took over the client communication. We delivered 1 week late but the client appreciated the transparency.', timestamp: '2:15' },
            { question: 'How do you handle financial trade-offs in your role?', answer: 'I always look at the margin impact. In my last role, I had to decide between two vendors — one was cheaper but had quality issues. I built a simple cost-benefit analysis showing that the cheaper option would actually cost us more in returns and reputation damage. We went with the pricier vendor and saw 15% fewer returns.', timestamp: '8:30' },
            { question: 'Tell me about a time a project failed and it was partially your fault.', answer: 'Honestly, that was more of a team issue. The project manager didn\'t set clear expectations and the timeline was unrealistic from the start. I did my part but the overall coordination was poor.', timestamp: '15:45' },
          ],
          'interview.processingStatus': 'done',
          'interview.processedAt': new Date(),
        },
      });

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }

    case 'score-candidates': {
      await new Promise((r) => setTimeout(r, 3000));

      for (const candidateId of data.candidateIds) {
        const candidate = await Candidate.findById(candidateId);
        const hasInterview = candidate?.interview?.processingStatus === 'done';

        const baseScores = [
          { categoryName: 'Communication', score: 7 + Math.floor(Math.random() * 3), explanation: 'Candidate communicates clearly with specific examples.', signals: { strengths: ['Clear articulation of complex situations'], risks: ['Occasionally verbose'], quotes: ['"I personally took over the client communication"'] } },
          { categoryName: 'Accountability', score: 3 + Math.floor(Math.random() * 5), explanation: hasInterview ? 'Mixed signals — showed ownership in one scenario but deflected in another.' : 'Resume shows progressive responsibility but no specific examples of owning failures.', signals: { strengths: ['Took ownership of delayed project'], risks: ['Deflected blame in failure scenario'], quotes: hasInterview ? ['"That was more of a team issue"'] : [] } },
          { categoryName: 'Financial Awareness', score: 6 + Math.floor(Math.random() * 3), explanation: 'Demonstrated understanding of margins and cost-benefit analysis.', signals: { strengths: ['Built cost-benefit analysis independently'], risks: ['Limited forecasting experience mentioned'], quotes: ['"I always look at the margin impact"'] } },
          { categoryName: 'Proactiveness', score: 5 + Math.floor(Math.random() * 4), explanation: 'Shows initiative in crisis situations but less evidence of proactive problem prevention.', signals: { strengths: ['Stepped in during project crisis'], risks: ['Examples are reactive rather than proactive'], quotes: [] } },
          { categoryName: 'Problem Solving', score: 6 + Math.floor(Math.random() * 3), explanation: 'Structured approach to vendor selection. Could demonstrate more complex problem-solving.', signals: { strengths: ['Systematic vendor evaluation'], risks: ['Limited examples of creative solutions'], quotes: [] } },
        ];

        const overall = +(baseScores.reduce((a, b) => a + b.score, 0) / baseScores.length).toFixed(1);
        const label = overall >= 7.5 ? 'Strong Hire' : overall >= 5.5 ? 'Consider' : 'Risky';

        await Candidate.findByIdAndUpdate(candidateId, {
          $set: {
            'scores.categories': baseScores,
            'scores.overallScore': overall,
            'scores.label': label,
            'scores.executiveSummary': `Candidate shows ${label === 'Strong Hire' ? 'strong' : label === 'Consider' ? 'moderate' : 'concerning'} alignment with role requirements. ${hasInterview ? 'Interview analysis complete.' : 'Note: Scores are preliminary — no interview data available.'}`,
            'scores.topStrengths': ['Clear communication style', 'Financial analysis capability'],
            'scores.topConcerns': ['Accountability patterns need further exploration', 'Limited proactive examples'],
            'scores.pastProblemMatch': {
              detected: baseScores[1].score < 6,
              details: baseScores[1].score < 6 ? 'Employer flagged "past hires lacked ownership." This candidate showed a similar pattern when discussing project failures.' : 'No concerning patterns detected matching employer\'s past issues.',
            },
            'scores.processingStatus': 'done',
            'scores.scoredAt': new Date(),
          },
        });
      }

      await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } });
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }
  }
};

const startWorker = () => {
  const worker = new Worker('talentscore', processJob, {
    connection: getRedisConnection(),
    concurrency: 3,
  });

  worker.on('completed', (job) => {
    console.log(`[Worker] Completed: ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Failed: ${job?.id}`, err.message);
  });

  console.log('[Worker] BullMQ worker started');
  return worker;
};

module.exports = { startWorker, processJobLogic };
