import { Sess } from '@sess.si/sdk';
const sess = new Sess({ apiKey: process.env.SESS_API_KEY });
const check = await sess.ask({
  question: 'End of class check',
  fields: [
    {
      name: 'understood',
      label: 'Did today’s lesson make sense?',
      type: 'choice',
      options: ['Yes', 'Mostly', 'No'],
    },
  ],
  respondents: { max: 20 },
});
console.log(`Share this link with the class: ${check.link}`);
const { counts, respondents } = await check.read(); // each answer verified and typed
const no = respondents.filter((r) => r.answer?.understood === 'No').length;
console.log(`${counts.answered} of ${check.max} answered. ${no} said no.`);
