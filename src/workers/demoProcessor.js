/**
 * Demo Processor — processes AI jobs inline when Redis/n8n are unavailable.
 * Generates realistic demo data so the full app flow works without infrastructure.
 */

const Role = require('../models/Role');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const { sendJobUpdate } = require('../services/sse');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const processDemoJob = async (type, data) => {
  console.log(`[Demo] Processing ${type} for job ${data.jobId}`);

  // Update job status
  if (data.jobId) {
    await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'processing', progress: 30 } }).catch(() => {});
  }

  switch (type) {
    case 'role-setup': {
      await delay(2000);

      await Role.findByIdAndUpdate(data.roleId, {
        $set: {
          improvedJobDescription: data.jobDescription + '\n\n[AI Enhanced: Clarified key responsibilities, success metrics, and team dynamics. Aligned with employer priorities for accountability, communication, and financial awareness.]',
          scoringCategories: [
            { name: 'Communication', description: 'Ability to clearly convey ideas, actively listen, and adapt communication style to different audiences.', weight: 1, isCustom: false, keyIndicators: ['Clear articulation', 'Active listening', 'Written clarity'], redFlags: ['Vague responses', 'Interrupts frequently', 'Cannot simplify complex ideas'] },
            { name: 'Accountability', description: 'Takes ownership of outcomes, both positive and negative. Follows through on commitments.', weight: 1, isCustom: false, keyIndicators: ['Owns mistakes', 'Follows through', 'Sets clear expectations'], redFlags: ['Blames others', 'Avoids responsibility', 'Makes excuses'] },
            { name: 'Financial Awareness', description: 'Understands business metrics, margins, and the financial impact of decisions.', weight: 1, isCustom: false, keyIndicators: ['Uses numbers', 'Understands P&L', 'ROI-driven decisions'], redFlags: ['No financial context', 'Ignores costs', 'Cannot quantify impact'] },
            { name: 'Proactiveness', description: 'Takes initiative without being asked. Anticipates problems and creates solutions.', weight: 1, isCustom: false, keyIndicators: ['Self-starter', 'Anticipates needs', 'Suggests improvements'], redFlags: ['Waits for direction', 'Reactive only', 'No initiative examples'] },
            { name: 'Problem Solving', description: 'Approaches challenges methodically and creates effective, scalable solutions.', weight: 1, isCustom: false, keyIndicators: ['Structured approach', 'Creative solutions', 'Data-driven'], redFlags: ['Panics under pressure', 'No clear methodology', 'Copy-paste solutions'] },
          ],
          marketFeedback: {
            salaryRange: { min: 70000, max: 130000 },
            warnings: [
              'Pay range appears competitive for this market.',
              'Consider adding specific success metrics to the JD to attract A-players.',
              'The role description could benefit from clearer growth path information.',
            ],
          },
          'processingStatus.jobPostImprovement': 'done',
          'processingStatus.categoryGeneration': 'done',
          status: 'active',
        },
      });

      if (data.jobId) {
        await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } }).catch(() => {});
      }
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }

    case 'resume-parse': {
      await delay(1500);

      const names = ['Alex Johnson', 'Sarah Chen', 'Michael Park', 'Emily Rodriguez', 'David Kim', 'Jessica Liu', 'Robert Singh', 'Amanda Torres'];
      const randomName = names[Math.floor(Math.random() * names.length)];

      await Candidate.findByIdAndUpdate(data.candidateId, {
        $set: {
          name: randomName,
          email: `${randomName.toLowerCase().replace(' ', '.')}@email.com`,
          'resume.extractedText': 'Full resume content extracted from PDF...',
          'resume.summary': `${randomName} has 6+ years of experience in client management and business development. Previously at two mid-size firms with increasing responsibility. Shows progression from account coordinator to senior account manager. Strong track record of client retention and revenue growth.`,
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

      if (data.jobId) {
        await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } }).catch(() => {});
      }
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }

    case 'generate-questions': {
      await delay(2000);

      const candidateIds = data.candidateIds || [];
      for (const candidateId of candidateIds) {
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

      if (data.jobId) {
        await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } }).catch(() => {});
      }
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }

    case 'transcribe-interview': {
      await delay(2000);

      await Candidate.findByIdAndUpdate(data.candidateId, {
        $set: {
          'interview.transcriptRaw': data.transcript || 'Demo transcript — full text would appear here.',
          'interview.transcriptStructured': [
            { question: 'Tell me about a time you had to take ownership of a failing project.', answer: 'At my last company, we had a major client deliverable that was 3 weeks behind schedule. I stepped in and reorganized the team\'s workflow, set up daily standups, and personally took over the client communication. We delivered 1 week late but the client appreciated the transparency.', timestamp: '2:15' },
            { question: 'How do you handle financial trade-offs in your role?', answer: 'I always look at the margin impact. In my last role, I had to decide between two vendors — one was cheaper but had quality issues. I built a simple cost-benefit analysis showing the cheaper option would cost more in returns and reputation damage. We went with the pricier vendor and saw 15% fewer returns.', timestamp: '8:30' },
            { question: 'Tell me about a time a project failed and it was partially your fault.', answer: 'Honestly, that was more of a team issue. The project manager didn\'t set clear expectations and the timeline was unrealistic from the start. I did my part but the overall coordination was poor.', timestamp: '15:45' },
          ],
          'interview.processingStatus': 'done',
          'interview.processedAt': new Date(),
        },
      });

      if (data.jobId) {
        await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } }).catch(() => {});
      }
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }

    case 'score-candidates': {
      await delay(3000);

      const scoreIds = data.candidateIds || [];
      for (const candidateId of scoreIds) {
        const candidate = await Candidate.findById(candidateId);
        const hasInterview = candidate?.interview?.processingStatus === 'done';

        const scores = [
          { categoryName: 'Communication', score: 7 + Math.floor(Math.random() * 3), explanation: 'Candidate communicates clearly with specific examples. Demonstrates ability to explain complex situations to different stakeholders.', signals: { strengths: ['Clear articulation of complex situations', 'Adapts communication style effectively'], risks: ['Occasionally verbose in explanations'], quotes: hasInterview ? ['"I personally took over the client communication"'] : [] } },
          { categoryName: 'Accountability', score: 3 + Math.floor(Math.random() * 5), explanation: hasInterview ? 'Mixed signals — showed ownership in project turnaround scenario but deflected responsibility in failure discussion.' : 'Resume shows progressive responsibility but no specific examples of owning failures.', signals: { strengths: ['Took ownership of delayed project'], risks: ['Deflected blame in failure scenario', 'Used "team issue" framing'], quotes: hasInterview ? ['"That was more of a team issue"'] : [] } },
          { categoryName: 'Financial Awareness', score: 6 + Math.floor(Math.random() * 3), explanation: 'Demonstrated understanding of margins and cost-benefit analysis. Built independent financial models for vendor decisions.', signals: { strengths: ['Built cost-benefit analysis independently', 'Understands margin impact'], risks: ['Limited forecasting experience mentioned'], quotes: hasInterview ? ['"I always look at the margin impact"'] : [] } },
          { categoryName: 'Proactiveness', score: 5 + Math.floor(Math.random() * 4), explanation: 'Shows initiative in crisis situations but less evidence of proactive problem prevention or continuous improvement.', signals: { strengths: ['Stepped in during project crisis', 'Reorganized team workflow'], risks: ['Examples are reactive rather than proactive', 'No mentions of process improvements'], quotes: [] } },
          { categoryName: 'Problem Solving', score: 6 + Math.floor(Math.random() * 3), explanation: 'Structured approach to vendor selection demonstrates analytical capability. Could show more creative problem-solving.', signals: { strengths: ['Systematic vendor evaluation', 'Data-driven decision making'], risks: ['Limited examples of creative solutions', 'Prefers structured over ambiguous problems'], quotes: [] } },
        ];

        const overall = +(scores.reduce((a, b) => a + b.score, 0) / scores.length).toFixed(1);
        const label = overall >= 7.5 ? 'Strong Hire' : overall >= 5.5 ? 'Consider' : 'Risky';

        await Candidate.findByIdAndUpdate(candidateId, {
          $set: {
            'scores.categories': scores,
            'scores.overallScore': overall,
            'scores.label': label,
            'scores.executiveSummary': `${candidate?.name || 'Candidate'} shows ${label === 'Strong Hire' ? 'strong' : label === 'Consider' ? 'moderate' : 'concerning'} alignment with role requirements. ${hasInterview ? 'Interview revealed mixed signals on accountability — showed ownership in one scenario but deflected in another. Strong financial awareness and communication skills.' : 'Note: Scores are preliminary — no interview data available. Resume analysis only.'}`,
            'scores.topStrengths': ['Clear communication with specific examples', 'Strong financial and analytical capability', 'Track record of stepping up during crises'],
            'scores.topConcerns': ['Accountability patterns need further exploration', 'Limited proactive (vs reactive) examples', 'Employment gap unexplained'],
            'scores.pastProblemMatch': {
              detected: scores[1].score < 6,
              details: scores[1].score < 6 ? 'Employer flagged "past hires lacked ownership." This candidate showed a similar deflection pattern when discussing project failures — used "team issue" framing instead of owning their part.' : 'No concerning patterns detected matching employer\'s stated past hiring issues.',
            },
            'scores.interviewerFeedback': hasInterview ? [
              { issue: 'Candidate deflected on the failure question. Should probe deeper.', suggestion: 'Ask: "Setting aside the team dynamics, what could YOU have done differently?"' },
              { issue: 'Revenue numbers were not specific.', suggestion: 'Request exact figures: "What was the total ACV of your book of business?"' },
            ] : [],
            'scores.processingStatus': 'done',
            'scores.scoredAt': new Date(),
          },
        });
      }

      if (data.jobId) {
        await Job.findByIdAndUpdate(data.jobId, { $set: { status: 'done', progress: 100 } }).catch(() => {});
      }
      sendJobUpdate(data.userId, data.jobId, 'done', 100);
      break;
    }

    default:
      console.warn(`[Demo] Unknown job type: ${type}`);
  }

  console.log(`[Demo] Completed ${type}`);
};

module.exports = { processDemoJob };
