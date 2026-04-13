const { Worker } = require('bullmq');
const { getRedisConnection } = require('../config/redis');
const Job = require('../models/Job');
const { sendJobUpdate } = require('../services/sse');

/**
 * BullMQ Worker
 * Processes queued jobs by calling n8n webhooks.
 * n8n handles the actual AI processing and calls back via internal API.
 */

const N8N_BASE = process.env.N8N_WEBHOOK_BASE_URL || 'http://localhost:5678';

const processJob = async (bullJob) => {
  const { type, data } = { type: bullJob.name, data: bullJob.data };
  console.log(`[Worker] Processing ${type}: ${bullJob.id}`);

  // Update job status to processing
  await Job.findByIdAndUpdate(data.jobId, {
    $set: { status: 'processing', progress: 10 },
  });

  // Send SSE update
  sendJobUpdate(data.userId, data.jobId, 'processing', 10);

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
    // Call n8n webhook
    const response = await fetch(`${N8N_BASE}${webhookPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': process.env.INTERNAL_API_KEY,
      },
      body: JSON.stringify({
        ...data,
        callbackBaseUrl: `http://localhost:${process.env.PORT || 4000}/api/internal`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`n8n webhook failed (${response.status}): ${errorText}`);
    }

    console.log(`[Worker] ${type} dispatched to n8n successfully`);

    // n8n will call back to /api/internal when done
    // The job will be marked as complete by the callback
  } catch (error) {
    console.error(`[Worker] ${type} failed:`, error.message);

    // If n8n is down, simulate processing for development
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      console.log(`[Worker] n8n unavailable — running in demo mode for ${type}`);
      await simulateDemoProcessing(type, data);
      return;
    }

    // Update job status to failed
    await Job.findByIdAndUpdate(data.jobId, {
      $set: { status: 'failed', error: error.message },
    });
    sendJobUpdate(data.userId, data.jobId, 'failed', 0, { error: error.message });
    throw error;
  }
};

/**
 * Demo mode: simulates AI processing when n8n is not available
 * This allows frontend development without the full AI stack
 */
const simulateDemoProcessing = async (type, data) => {
  const Role = require('../models/Role');
  const Candidate = require('../models/Candidate');

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

module.exports = { startWorker };
